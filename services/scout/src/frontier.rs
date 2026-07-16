use crate::identity::{canonicalize_url, identify_job, identify_source_url};
use crate::models::{CrawlResult, CrawlStatus, CrawlTask, NormalizedJob};
use crate::{eligibility, opportunity};
use anyhow::Result;
use chrono::Utc;
use futures_util::{StreamExt, TryStreamExt, stream};
use sqlx::{Pool, Postgres, Row, Transaction};

pub async fn insert_frontier(
    pool: &Pool<Postgres>,
    url: &str,
    depth: u16,
    discovered_from: Option<&str>,
) -> Result<bool> {
    let inserted = sqlx::query(
        "INSERT INTO crawl_frontier (url, depth, discovered_from) VALUES ($1, $2, $3) \
         ON CONFLICT (url) DO NOTHING RETURNING url",
    )
    .bind(url)
    .bind(depth as i16)
    .bind(discovered_from)
    .fetch_optional(pool)
    .await?
    .is_some();
    Ok(inserted)
}

pub async fn enqueue_seed_for_recrawl(
    pool: &Pool<Postgres>,
    url: &str,
    minimum_age_seconds: i64,
) -> Result<bool> {
    let queued = sqlx::query(
        "INSERT INTO crawl_frontier (url, depth, discovered_from) VALUES ($1, 0, NULL) \
         ON CONFLICT (url) DO UPDATE SET state = 'queued', depth = 0, discovered_from = NULL, \
         queued_at = NOW(), last_error = NULL \
         WHERE crawl_frontier.state <> 'queued' AND (crawl_frontier.fetched_at IS NULL OR \
         crawl_frontier.fetched_at <= NOW() - ($2 * INTERVAL '1 second')) RETURNING url",
    )
    .bind(url)
    .bind(minimum_age_seconds)
    .fetch_optional(pool)
    .await?
    .is_some();
    Ok(queued)
}

pub async fn begin_source_run(pool: &Pool<Postgres>, url: &str) -> Result<CrawlTask> {
    let source = identify_source_url(url);
    let canonical = canonicalize_url(url);
    sqlx::query(
        "INSERT INTO sources (id, source_type, url, supports_complete_scan) VALUES ($1,$2,$3,$4) \
         ON CONFLICT (id) DO UPDATE SET url = EXCLUDED.url, source_type = EXCLUDED.source_type, \
         supports_complete_scan = EXCLUDED.supports_complete_scan, updated_at = NOW()",
    )
    .bind(&source.id)
    .bind(&source.source_type)
    .bind(&canonical)
    .bind(source.complete_scan)
    .execute(pool)
    .await?;
    let run_id = uuid::Uuid::new_v4();
    sqlx::query(
        "INSERT INTO source_runs (id, source_id, source_url, scan_kind, status) VALUES ($1,$2,$3,$4,'running')",
    )
    .bind(run_id).bind(&source.id).bind(&canonical).bind(if source.complete_scan { "complete" } else { "partial" })
    .execute(pool).await?;
    Ok(CrawlTask {
        url: canonical,
        depth: 0,
        discovered_from: None,
        queued_at: Utc::now(),
        run_id: Some(run_id),
        source_id: Some(source.id),
        complete_source_scan: source.complete_scan,
    })
}

pub async fn save_result(pool: &Pool<Postgres>, result: &CrawlResult) -> Result<Vec<CrawlTask>> {
    let mut transaction = pool.begin().await?;
    let status = status_label(&result.status);

    sqlx::query(
        "INSERT INTO crawled_pages (url, status, content_hash, content_bytes, fetched_at, elapsed_ms) \
         VALUES ($1, $2, $3, $4, $5, $6) \
         ON CONFLICT (url) DO UPDATE SET status = EXCLUDED.status, content_hash = EXCLUDED.content_hash, \
         content_bytes = EXCLUDED.content_bytes, fetched_at = EXCLUDED.fetched_at, elapsed_ms = EXCLUDED.elapsed_ms",
    )
    .bind(&result.canonical_url)
    .bind(status)
    .bind(&result.content_hash)
    .bind(result.content_bytes as i64)
    .bind(result.fetched_at)
    .bind(result.elapsed_ms as i64)
    .execute(&mut *transaction)
    .await?;

    sqlx::query(
        "UPDATE crawl_frontier SET state = $2, fetched_at = $3, attempts = attempts + 1, last_error = $4 WHERE url = $1",
    )
    .bind(&result.task.url)
    .bind(if matches!(result.status, CrawlStatus::Success) { "fetched" } else { "failed" })
    .bind(result.fetched_at)
    .bind(match &result.status { CrawlStatus::FetchError(error) => Some(error.as_str()), _ => None })
    .execute(&mut *transaction)
    .await?;

    for job in &result.jobs {
        let job_id = upsert_job(&mut transaction, job, result.task.run_id).await?;
        if let Some(run_id) = result.task.run_id {
            sqlx::query("INSERT INTO source_run_jobs (run_id, job_id) VALUES ($1,$2) ON CONFLICT DO NOTHING")
                .bind(run_id).bind(job_id).execute(&mut *transaction).await?;
        }
    }

    let mut new_tasks = Vec::new();
    if result.task.depth < 4 {
        for url in result.discovered_urls.iter().take(100) {
            let inserted = sqlx::query(
                "INSERT INTO crawl_frontier (url, depth, discovered_from) VALUES ($1, $2, $3) \
                 ON CONFLICT (url) DO NOTHING RETURNING url",
            )
            .bind(url)
            .bind((result.task.depth + 1) as i16)
            .bind(&result.canonical_url)
            .fetch_optional(&mut *transaction)
            .await?
            .is_some();
            if inserted {
                new_tasks.push(CrawlTask {
                    url: url.clone(),
                    depth: result.task.depth + 1,
                    discovered_from: Some(result.canonical_url.clone()),
                    queued_at: Utc::now(),
                    run_id: None,
                    source_id: None,
                    complete_source_scan: false,
                });
            }
        }
    }

    if let Some(run_id) = result.task.run_id {
        let final_chunk = result.chunk_index + 1 >= result.chunk_count;
        sqlx::query(
            "UPDATE source_runs SET chunks_expected = GREATEST(chunks_expected, $2), chunks_received = chunks_received + 1, \
             observed_jobs = (SELECT COUNT(*) FROM source_run_jobs WHERE run_id = $1) WHERE id = $1",
        ).bind(run_id).bind(result.chunk_count as i32).execute(&mut *transaction).await?;
        if final_chunk {
            finalize_source_run(&mut transaction, result).await?;
        }
    }

    transaction.commit().await?;
    Ok(new_tasks)
}

async fn upsert_job(
    transaction: &mut Transaction<'_, Postgres>,
    job: &NormalizedJob,
    run_id: Option<uuid::Uuid>,
) -> Result<uuid::Uuid> {
    let identity = identify_job(job);
    let geographic_locations = eligibility::normalized_locations(job.location.as_deref());
    let remote_policy =
        eligibility::parse_remote_policy(job.location.as_deref(), &job.description, job.remote);
    let opportunity_classification =
        opportunity::classify(job.employment_type.as_deref(), &job.title, &job.description);
    let existing_id = sqlx::query_scalar::<_, uuid::Uuid>(
        "SELECT id FROM jobs WHERE \
         (source_id = $1 AND $2::TEXT IS NOT NULL AND source_job_id = $2) OR \
         canonical_url = $3 OR identity_key = $4 \
         ORDER BY CASE WHEN source_id = $1 AND $2::TEXT IS NOT NULL AND source_job_id = $2 THEN 0 \
                       WHEN canonical_url = $3 THEN 1 ELSE 2 END, first_seen_at LIMIT 1",
    )
    .bind(&identity.source_id)
    .bind(&identity.source_job_id)
    .bind(&identity.canonical_url)
    .bind(&identity.identity_key)
    .fetch_optional(&mut **transaction)
    .await?;
    let kept_id = existing_id.unwrap_or(job.id);

    sqlx::query(
        "INSERT INTO jobs (id, source_url, source_name, source_id, source_type, source_job_id, canonical_url, apply_url, company_domain, identity_key, identity_strategy, title, company, location, country, remote, \
        employment_type, experience_years, degree_required, salary_min, salary_max, salary_currency, \
         date_posted, valid_through, description, skills, raw, geographic_locations, remote_policy, geography_normalization_version, opportunity_classification, opportunity_normalization_version) \
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,1,$30,$31) \
         ON CONFLICT (id) DO UPDATE SET source_url = EXCLUDED.source_url, source_name = EXCLUDED.source_name, \
         source_id = EXCLUDED.source_id, source_type = EXCLUDED.source_type, source_job_id = COALESCE(EXCLUDED.source_job_id, jobs.source_job_id), \
         canonical_url = EXCLUDED.canonical_url, apply_url = EXCLUDED.apply_url, company_domain = COALESCE(EXCLUDED.company_domain, jobs.company_domain), \
         identity_key = EXCLUDED.identity_key, identity_strategy = EXCLUDED.identity_strategy, title = EXCLUDED.title, \
         company = EXCLUDED.company, location = EXCLUDED.location, country = EXCLUDED.country, \
         remote = EXCLUDED.remote, employment_type = EXCLUDED.employment_type, \
         experience_years = EXCLUDED.experience_years, degree_required = EXCLUDED.degree_required, \
         salary_min = EXCLUDED.salary_min, salary_max = EXCLUDED.salary_max, \
         salary_currency = EXCLUDED.salary_currency, date_posted = EXCLUDED.date_posted, \
         valid_through = EXCLUDED.valid_through, description = EXCLUDED.description, skills = EXCLUDED.skills, \
         raw = EXCLUDED.raw, geographic_locations = EXCLUDED.geographic_locations, remote_policy = EXCLUDED.remote_policy, geography_normalization_version = 1, \
         opportunity_classification = EXCLUDED.opportunity_classification, opportunity_normalization_version = EXCLUDED.opportunity_normalization_version, \
         last_seen_at = NOW(), last_verified_at = NOW(), lifecycle_status = 'active', missing_since_run_id = NULL, closed_at = NULL, is_active = TRUE",
    )
    .bind(kept_id)
    .bind(&job.source_url)
    .bind(&job.source_name)
    .bind(&identity.source_id)
    .bind(&identity.source_type)
    .bind(&identity.source_job_id)
    .bind(&identity.canonical_url)
    .bind(&identity.apply_url)
    .bind(&identity.company_domain)
    .bind(&identity.identity_key)
    .bind(identity.strategy)
    .bind(&job.title)
    .bind(&job.company)
    .bind(&job.location)
    .bind(&job.country)
    .bind(job.remote)
    .bind(&job.employment_type)
    .bind(job.experience_years)
    .bind(job.degree_required)
    .bind(job.salary_min)
    .bind(job.salary_max)
    .bind(&job.salary_currency)
    .bind(job.date_posted)
    .bind(job.valid_through)
    .bind(&job.description)
    .bind(serde_json::to_value(&job.skills)?)
    .bind(&job.raw)
    .bind(serde_json::to_value(&geographic_locations)?)
    .bind(serde_json::to_value(&remote_policy)?)
    .bind(serde_json::to_value(&opportunity_classification)?)
    .bind(opportunity::NORMALIZATION_VERSION)
    .execute(&mut **transaction)
    .await?;

    sqlx::query(
        "INSERT INTO job_source_references (job_id, source_id, source_job_id, source_url, canonical_url, last_seen_run_id) \
         VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (source_id, source_url) DO UPDATE SET \
         job_id = EXCLUDED.job_id, source_job_id = EXCLUDED.source_job_id, canonical_url = EXCLUDED.canonical_url, last_seen_at = NOW(), last_seen_run_id = EXCLUDED.last_seen_run_id",
    )
    .bind(kept_id)
    .bind(&identity.source_id)
    .bind(&identity.source_job_id)
    .bind(&job.source_url)
    .bind(&identity.canonical_url)
    .bind(run_id)
    .execute(&mut **transaction)
    .await?;

    if existing_id.is_some() && kept_id != job.id {
        sqlx::query(
            "INSERT INTO job_merge_audit (kept_job_id, incoming_job_id, matched_by, identity_key, source_url) VALUES ($1,$2,$3,$4,$5)",
        )
        .bind(kept_id)
        .bind(job.id)
        .bind(identity.strategy)
        .bind(&identity.identity_key)
        .bind(&job.source_url)
        .execute(&mut **transaction)
        .await?;
    }
    Ok(kept_id)
}

pub async fn backfill_opportunity_classification(pool: &Pool<Postgres>) -> Result<u64> {
    let mut updated = 0u64;
    loop {
        let rows = sqlx::query(
            "SELECT id, employment_type, title, description FROM jobs WHERE opportunity_normalization_version < $1 ORDER BY first_seen_at LIMIT 250",
        )
        .bind(opportunity::NORMALIZATION_VERSION)
        .fetch_all(pool)
        .await?;
        if rows.is_empty() {
            return Ok(updated);
        }
        let affected = stream::iter(rows.into_iter().map(|row| async move {
            let id: uuid::Uuid = row.get("id");
            let employment_type: Option<String> = row.get("employment_type");
            let title: String = row.get("title");
            let description: String = row.get("description");
            let classification =
                opportunity::classify(employment_type.as_deref(), &title, &description);
            Ok::<u64, anyhow::Error>(
                sqlx::query(
                    "UPDATE jobs SET opportunity_classification = $2, opportunity_normalization_version = $3 WHERE id = $1 AND opportunity_normalization_version < $3",
                )
                .bind(id)
                .bind(serde_json::to_value(classification)?)
                .bind(opportunity::NORMALIZATION_VERSION)
                .execute(pool)
                .await?
                .rows_affected(),
            )
        }))
        .buffer_unordered(8)
        .try_collect::<Vec<_>>()
        .await?;
        updated += affected.into_iter().sum::<u64>();
    }
}

pub async fn backfill_structured_geography(pool: &Pool<Postgres>) -> Result<u64> {
    let mut updated = 0u64;
    loop {
        let rows = sqlx::query(
            "SELECT id, location, description, remote FROM jobs WHERE geography_normalization_version < 1 ORDER BY first_seen_at LIMIT 250",
        )
        .fetch_all(pool)
        .await?;
        if rows.is_empty() {
            return Ok(updated);
        }
        let affected = stream::iter(rows.into_iter().map(|row| async move {
            let id: uuid::Uuid = row.get("id");
            let location: Option<String> = row.get("location");
            let description: String = row.get("description");
            let remote: bool = row.get("remote");
            let locations = eligibility::normalized_locations(location.as_deref());
            let policy =
                eligibility::parse_remote_policy(location.as_deref(), &description, remote);
            Ok::<u64, anyhow::Error>(
                sqlx::query(
                    "UPDATE jobs SET geographic_locations = $2, remote_policy = $3, geography_normalization_version = 1 WHERE id = $1 AND geography_normalization_version < 1",
                )
                .bind(id)
                .bind(serde_json::to_value(locations)?)
                .bind(serde_json::to_value(policy)?)
                .execute(pool)
                .await?
                .rows_affected(),
            )
        }))
        .buffer_unordered(8)
        .try_collect::<Vec<_>>()
        .await?;
        updated += affected.into_iter().sum::<u64>();
    }
}

async fn finalize_source_run(
    transaction: &mut Transaction<'_, Postgres>,
    result: &CrawlResult,
) -> Result<()> {
    let Some(run_id) = result.task.run_id else {
        return Ok(());
    };
    let source_id = result.task.source_id.as_deref().unwrap_or("unknown");
    let success = matches!(result.status, CrawlStatus::Success);
    let complete = success && result.task.complete_source_scan;
    let status = if complete {
        "success"
    } else if success {
        "partial"
    } else {
        "failed"
    };
    let error = match &result.status {
        CrawlStatus::FetchError(value) => Some(value.clone()),
        CrawlStatus::HttpError(code) => Some(format!("HTTP {code}")),
        CrawlStatus::BlockedByRobots => Some("blocked by robots".into()),
        CrawlStatus::UnsupportedContent => Some("unsupported content".into()),
        CrawlStatus::BodyTooLarge => Some("body too large".into()),
        CrawlStatus::Success => None,
    };
    sqlx::query(
        "UPDATE source_runs SET status = $2, completed_at = NOW(), error = $3 WHERE id = $1",
    )
    .bind(run_id)
    .bind(status)
    .bind(error)
    .execute(&mut **transaction)
    .await?;
    sqlx::query("UPDATE sources SET last_run_at = NOW(), last_success_at = CASE WHEN $2 THEN NOW() ELSE last_success_at END, updated_at = NOW() WHERE id = $1")
        .bind(source_id).bind(complete).execute(&mut **transaction).await?;

    if complete {
        sqlx::query(
            "UPDATE jobs SET lifecycle_status = 'active', is_active = TRUE, missing_since_run_id = NULL, closed_at = NULL, last_verified_at = NOW() \
             WHERE id IN (SELECT job_id FROM source_run_jobs WHERE run_id = $1)",
        ).bind(run_id).execute(&mut **transaction).await?;
        sqlx::query(
            "UPDATE jobs SET lifecycle_status = CASE WHEN lifecycle_status = 'possibly_closed' THEN 'closed' ELSE 'possibly_closed' END, \
             is_active = CASE WHEN lifecycle_status = 'possibly_closed' THEN FALSE ELSE TRUE END, \
             closed_at = CASE WHEN lifecycle_status = 'possibly_closed' THEN NOW() ELSE closed_at END, \
             missing_since_run_id = COALESCE(missing_since_run_id, $2) \
             WHERE id IN (SELECT job_id FROM job_source_references WHERE source_id = $1) \
             AND id NOT IN (SELECT job_id FROM source_run_jobs WHERE run_id = $2) AND lifecycle_status <> 'closed'",
        ).bind(source_id).bind(run_id).execute(&mut **transaction).await?;
    }
    Ok(())
}

pub async fn frontier_stats(pool: &Pool<Postgres>) -> Result<(i64, i64, i64)> {
    let row = sqlx::query(
        "SELECT COUNT(*) FILTER (WHERE state = 'queued') AS queued, \
         COUNT(*) FILTER (WHERE state = 'fetched') AS fetched, \
         COUNT(*) FILTER (WHERE state = 'failed') AS failed FROM crawl_frontier",
    )
    .fetch_one(pool)
    .await?;
    Ok((row.get("queued"), row.get("fetched"), row.get("failed")))
}

fn status_label(status: &CrawlStatus) -> &'static str {
    match status {
        CrawlStatus::Success => "success",
        CrawlStatus::BlockedByRobots => "blocked_by_robots",
        CrawlStatus::UnsupportedContent => "unsupported_content",
        CrawlStatus::HttpError(_) => "http_error",
        CrawlStatus::FetchError(_) => "fetch_error",
        CrawlStatus::BodyTooLarge => "body_too_large",
    }
}
