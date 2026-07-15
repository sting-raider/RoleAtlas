use crate::identity::identify_job;
use crate::models::{CrawlResult, CrawlStatus, CrawlTask, NormalizedJob};
use anyhow::Result;
use chrono::Utc;
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
        upsert_job(&mut transaction, job).await?;
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
                });
            }
        }
    }

    transaction.commit().await?;
    Ok(new_tasks)
}

async fn upsert_job(
    transaction: &mut Transaction<'_, Postgres>,
    job: &NormalizedJob,
) -> Result<()> {
    let identity = identify_job(job);
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
         date_posted, valid_through, description, skills, raw) \
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27) \
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
         raw = EXCLUDED.raw, last_seen_at = NOW(), is_active = TRUE",
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
    .execute(&mut **transaction)
    .await?;

    sqlx::query(
        "INSERT INTO job_source_references (job_id, source_id, source_job_id, source_url, canonical_url) \
         VALUES ($1,$2,$3,$4,$5) ON CONFLICT (source_id, source_url) DO UPDATE SET \
         job_id = EXCLUDED.job_id, source_job_id = EXCLUDED.source_job_id, canonical_url = EXCLUDED.canonical_url, last_seen_at = NOW()",
    )
    .bind(kept_id)
    .bind(&identity.source_id)
    .bind(&identity.source_job_id)
    .bind(&job.source_url)
    .bind(&identity.canonical_url)
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
