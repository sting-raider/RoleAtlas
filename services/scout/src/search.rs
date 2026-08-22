use crate::eligibility::{
    CandidateEligibility, CandidateMobility, RemotePolicy, evaluate_candidate, parse_remote_policy,
};
use crate::geography::normalize_location;
use crate::search_index::{self, JobSearchQuery, SearchJob};
use anyhow::{Context, Result};
use chrono::Utc;
use serde_json::{Value, json};
use sqlx::{Pool, Postgres, Row};
use std::time::Instant;
use uuid::Uuid;

const SEARCH_PAGE_SIZE: i64 = 100;
const MAX_SESSION_CANDIDATES_PER_QUERY: usize = 1_000;

fn strings(value: &Value, key: &str) -> Vec<String> {
    value
        .get(key)
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .collect()
}

fn uuid_at(value: &Value, key: &str) -> Option<Uuid> {
    value
        .get(key)
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok())
}

fn query_terms(query: &str) -> Vec<String> {
    const STOP: &[&str] = &[
        "and",
        "the",
        "for",
        "with",
        "entry",
        "level",
        "opportunities",
    ];
    query
        .split(|character: char| {
            !character.is_alphanumeric() && character != '+' && character != '#'
        })
        .map(str::to_lowercase)
        .filter(|term| term.len() >= 3 && !STOP.contains(&term.as_str()))
        .collect()
}

fn mobility_from_plan(plan: &Value) -> CandidateMobility {
    if let Some(mobility) = plan
        .get("mobility")
        .and_then(|value| serde_json::from_value(value.clone()).ok())
    {
        return mobility;
    }
    // Older plans predate structured mobility. Residence may be inferred from
    // an explicit plan location, but authorization/citizenship remain empty.
    let normalized = strings(plan, "locations")
        .first()
        .map(|location| normalize_location(location));
    CandidateMobility {
        residence_country_code: normalized
            .as_ref()
            .and_then(|location| location.country_code.clone()),
        preferred_country_codes: normalized
            .as_ref()
            .and_then(|location| location.country_code.clone())
            .into_iter()
            .collect(),
        preferred_cities: normalized.into_iter().collect(),
        inferred_fields: vec!["residenceCountryCode".into()],
        ..CandidateMobility::default()
    }
}

fn eligibility_adjustment(status: &CandidateEligibility) -> f64 {
    match status {
        CandidateEligibility::Confirmed => 12.0,
        CandidateEligibility::Likely => 6.0,
        CandidateEligibility::Unclear => -5.0,
        CandidateEligibility::RequiresSponsorship
        | CandidateEligibility::RequiresRelocation
        | CandidateEligibility::RequiresOfficeAttendance => -10.0,
        CandidateEligibility::Excluded | CandidateEligibility::TimezoneMismatch => -100.0,
    }
}

fn matches_job_types(job: &SearchJob, job_types: &[String]) -> bool {
    if job_types.is_empty() {
        return true;
    }
    let searchable = format!(
        "{} {} {}",
        job.title,
        job.employment_type.as_deref().unwrap_or_default(),
        job.opportunity_classification
            .get("jobType")
            .and_then(Value::as_str)
            .unwrap_or_default()
    )
    .to_lowercase();
    job_types
        .iter()
        .any(|job_type| searchable.contains(&job_type.to_lowercase()))
}

async fn indexed_candidates(
    pool: &Pool<Postgres>,
    query_text: &str,
    max_experience: Option<i16>,
    no_degree: bool,
    freshness_days: Option<i32>,
) -> Result<Vec<SearchJob>> {
    let mut cursor = None;
    let mut jobs = Vec::new();
    while jobs.len() < MAX_SESSION_CANDIDATES_PER_QUERY {
        let remaining = MAX_SESSION_CANDIDATES_PER_QUERY - jobs.len();
        let query = search_index::validate_query(JobSearchQuery {
            q: Some(query_text.to_owned()),
            max_experience,
            no_degree: Some(no_degree),
            posted_days: freshness_days.map(i64::from),
            cursor: cursor.clone(),
            limit: Some(SEARCH_PAGE_SIZE.min(remaining as i64)),
            ..JobSearchQuery::default()
        })
        .map_err(anyhow::Error::msg)?;
        let page = search_index::search(pool, &query).await?;
        jobs.extend(page.jobs);
        cursor = page.next_cursor;
        if !page.has_more || cursor.is_none() {
            break;
        }
    }
    Ok(jobs)
}

async fn resolve_plan(
    pool: &Pool<Postgres>,
    user_id: Uuid,
    request: &Value,
) -> Result<(Option<Uuid>, Option<Uuid>, Value)> {
    if let Some(plan) = request.get("search_plan").filter(|value| value.is_object()) {
        if let Some(profile_id) = uuid_at(request, "profile_id") {
            let owns_profile: bool = sqlx::query_scalar(
                "SELECT EXISTS(SELECT 1 FROM candidate_profiles WHERE id = $1 AND user_id = $2)",
            )
            .bind(profile_id)
            .bind(user_id)
            .fetch_one(pool)
            .await?;
            anyhow::ensure!(owns_profile, "candidate profile does not belong to user");
        }
        if let Some(plan_id) = uuid_at(request, "plan_id") {
            let owns_plan: bool = sqlx::query_scalar(
                "SELECT EXISTS(SELECT 1 FROM search_plans WHERE id = $1 AND user_id = $2)",
            )
            .bind(plan_id)
            .bind(user_id)
            .fetch_one(pool)
            .await?;
            anyhow::ensure!(owns_plan, "search plan does not belong to user");
        }
        return Ok((
            uuid_at(request, "profile_id"),
            uuid_at(request, "plan_id"),
            plan.clone(),
        ));
    }
    let row = if let Some(plan_id) = uuid_at(request, "plan_id") {
        sqlx::query(
            "SELECT profile_id, id, plan FROM search_plans WHERE id = $1 AND user_id = $2 AND is_active = TRUE",
        )
        .bind(plan_id)
        .bind(user_id)
        .fetch_optional(pool)
        .await?
    } else if let Some(profile_id) = uuid_at(request, "profile_id") {
        sqlx::query("SELECT profile_id, id, plan FROM search_plans WHERE profile_id = $1 AND user_id = $2 AND is_active = TRUE ORDER BY updated_at DESC LIMIT 1").bind(profile_id).bind(user_id).fetch_optional(pool).await?
    } else {
        sqlx::query("SELECT profile_id, id, plan FROM search_plans WHERE user_id = $1 AND is_active = TRUE ORDER BY updated_at DESC LIMIT 1").bind(user_id).fetch_optional(pool).await?
    };
    let row = row.context("no confirmed active search plan exists")?;
    Ok((
        Some(row.get("profile_id")),
        Some(row.get("id")),
        row.get("plan"),
    ))
}

async fn run_session(
    pool: &Pool<Postgres>,
    user_id: Uuid,
    session_id: Uuid,
    plan: Value,
) -> Result<Value> {
    let role_queries = strings(&plan, "roleQueries");
    anyhow::ensure!(!role_queries.is_empty(), "search plan has no role queries");
    let locations = strings(&plan, "locations");
    let job_types = strings(&plan, "jobTypes");
    let max_experience = plan
        .get("maxExperience")
        .and_then(Value::as_i64)
        .map(|value| value as i16);
    let no_degree = plan
        .get("noDegreeRequired")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let freshness_days = plan
        .get("freshnessDays")
        .and_then(Value::as_i64)
        .filter(|value| *value > 0)
        .map(|value| value.min(3650) as i32);
    let excluded_terms = strings(&plan, "excludedTerms");
    let excluded_companies = strings(&plan, "excludedCompanies");
    let mobility = mobility_from_plan(&plan);

    for query_text in &role_queries {
        let started = Instant::now();
        let query_id = Uuid::new_v4();
        let terms = query_terms(query_text);
        if terms.is_empty() {
            continue;
        }
        let query_lower = query_text.to_lowercase();
        let candidates =
            indexed_candidates(pool, query_text, max_experience, no_degree, freshness_days)
                .await?
                .into_iter()
                .filter(|job| {
                    let title = job.title.to_lowercase();
                    terms.iter().any(|term| title.contains(term))
                        || job
                            .description_preview
                            .to_lowercase()
                            .contains(&query_lower)
                })
                .filter(|job| matches_job_types(job, &job_types))
                .filter(|job| {
                    let title = job.title.to_lowercase();
                    !excluded_terms
                        .iter()
                        .any(|excluded| title.contains(&excluded.to_lowercase()))
                })
                .filter(|job| {
                    let company = job.company.to_lowercase();
                    !excluded_companies
                        .iter()
                        .any(|excluded| company.contains(&excluded.to_lowercase()))
                })
                .collect::<Vec<_>>();
        let inspected_count = candidates.len();
        let constraints = json!({ "locations": locations, "jobTypes": job_types, "maxExperience": max_experience, "noDegreeRequired": no_degree, "freshnessDays": freshness_days, "excludedTerms": excluded_terms, "excludedCompanies": excluded_companies, "mobility": &mobility });
        let mut job_ids = Vec::new();
        let mut scores = Vec::new();
        let mut eligibility_statuses = Vec::new();
        let mut eligibility_values = Vec::new();
        let mut match_reasons = Vec::new();
        for job in candidates {
            let policy = serde_json::from_value::<RemotePolicy>(job.remote_policy.clone())
                .unwrap_or_else(|_| {
                    parse_remote_policy(
                        job.location.as_deref(),
                        &job.description_preview,
                        job.remote,
                    )
                });
            let eligibility = evaluate_candidate(&mobility, &policy);
            if matches!(
                eligibility.status,
                CandidateEligibility::Excluded | CandidateEligibility::TimezoneMismatch
            ) {
                continue;
            }
            let title_lower = job.title.to_lowercase();
            let hits = terms
                .iter()
                .filter(|term| title_lower.contains(term.as_str()))
                .count() as f64;
            let exact = if title_lower.contains(&query_text.to_lowercase()) {
                30.0
            } else {
                0.0
            };
            let score = 45.0 + exact + hits * 8.0 + eligibility_adjustment(&eligibility.status);
            let eligibility_value = serde_json::to_value(&eligibility)?;
            let eligibility_status = eligibility_value
                .get("status")
                .and_then(Value::as_str)
                .context("serialized eligibility status missing")?;
            job_ids.push(job.id);
            scores.push(score);
            eligibility_statuses.push(eligibility_status.to_owned());
            eligibility_values.push(eligibility_value);
            match_reasons.push(json!({
                "query": query_text,
                "title_term_hits": hits,
                "retrieval_score": job.retrieval_score,
                "matched_index": "postgresql_full_text_trigram_v1",
                "eligibility": eligibility
            }));
        }

        let execution_ms = started.elapsed().as_millis() as i64;
        let mut transaction = pool.begin().await?;
        sqlx::query("INSERT INTO search_session_queries (id, session_id, query_text, constraints, match_count, execution_ms) VALUES ($1,$2,$3,$4,$5,$6)")
            .bind(query_id)
            .bind(session_id)
            .bind(query_text)
            .bind(constraints)
            .bind(inspected_count as i32)
            .bind(execution_ms)
            .execute(&mut *transaction)
            .await?;
        if !job_ids.is_empty() {
            sqlx::query(
                "INSERT INTO search_session_results (session_id,job_id,score,eligibility_status,eligibility) \
                 SELECT $1, batch.job_id, batch.score, batch.eligibility_status, batch.eligibility \
                 FROM UNNEST($2::UUID[],$3::DOUBLE PRECISION[],$4::TEXT[],$5::JSONB[]) \
                      AS batch(job_id,score,eligibility_status,eligibility) \
                 ON CONFLICT (session_id,job_id) DO UPDATE SET \
                   score = GREATEST(search_session_results.score,EXCLUDED.score), \
                   eligibility_status = EXCLUDED.eligibility_status, \
                   eligibility = EXCLUDED.eligibility",
            )
            .bind(session_id)
            .bind(&job_ids)
            .bind(&scores)
            .bind(&eligibility_statuses)
            .bind(&eligibility_values)
            .execute(&mut *transaction)
            .await?;
            sqlx::query(
                "INSERT INTO search_result_matches (session_id,job_id,query_id,reason) \
                 SELECT $1, batch.job_id, $2, batch.reason \
                 FROM UNNEST($3::UUID[],$4::JSONB[]) AS batch(job_id,reason) \
                 ON CONFLICT DO NOTHING",
            )
            .bind(session_id)
            .bind(query_id)
            .bind(&job_ids)
            .bind(&match_reasons)
            .execute(&mut *transaction)
            .await?;
        }
        transaction.commit().await?;
    }

    sqlx::query("WITH ranked AS (SELECT job_id, ROW_NUMBER() OVER (ORDER BY score DESC, job_id) rank FROM search_session_results WHERE session_id = $1) UPDATE search_session_results r SET rank = ranked.rank FROM ranked WHERE r.session_id = $1 AND r.job_id = ranked.job_id")
        .bind(session_id).execute(pool).await?;
    let registry_ids = crate::registry::enabled_sources()
        .map(|source| source.id.clone())
        .collect::<Vec<_>>();
    let coverage_row = sqlx::query("SELECT COUNT(*) FILTER (WHERE last_success_at IS NOT NULL) successful, MAX(last_success_at) freshest FROM sources WHERE id = ANY($1::TEXT[])")
        .bind(&registry_ids)
        .fetch_one(pool)
        .await?;
    let eligibility_rows = sqlx::query(
        "SELECT eligibility_status, COUNT(*) count FROM search_session_results WHERE session_id = $1 GROUP BY eligibility_status",
    )
    .bind(session_id)
    .fetch_all(pool)
    .await?;
    let eligibility_counts = eligibility_rows
        .into_iter()
        .map(|row| {
            (
                row.get::<String, _>("eligibility_status"),
                json!(row.get::<i64, _>("count")),
            )
        })
        .collect::<serde_json::Map<String, Value>>();
    let configured_sources = registry_ids.len() as i64;
    let successful_sources = coverage_row.get::<i64, _>("successful");
    let incomplete_sources = configured_sources.saturating_sub(successful_sources);
    let coverage = json!({
        "state": if incomplete_sources == 0 { "complete" } else { "partial" },
        "configured_sources": configured_sources,
        "successful_sources": successful_sources,
        "incomplete_sources": incomplete_sources,
        "freshest_success": coverage_row.get::<Option<chrono::DateTime<Utc>>,_>("freshest"),
        "index_scope": "persistent_local_index",
        "eligibility_counts": eligibility_counts,
        "eligibility_model": "roleatlas_deterministic_v1"
    });
    let result_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM search_session_results WHERE session_id = $1")
            .bind(session_id)
            .fetch_one(pool)
            .await?;
    sqlx::query("UPDATE search_sessions SET status = 'success', stage = 'completed', coverage = $2, query_count = $3, result_count = $4, completed_at = NOW(), updated_at = NOW() WHERE id = $1")
        .bind(session_id).bind(&coverage).bind(role_queries.len() as i32).bind(result_count as i32).execute(pool).await?;
    get(pool, user_id, session_id).await
}

pub async fn execute(pool: &Pool<Postgres>, user_id: Uuid, request: Value) -> Result<Value> {
    let (profile_id, plan_id, plan) = resolve_plan(pool, user_id, &request).await?;
    let session_id = Uuid::new_v4();
    sqlx::query("INSERT INTO search_sessions (id, user_id, profile_id, plan_id, status, stage, plan_snapshot) VALUES ($1,$2,$3,$4,'running','searching_index',$5)")
        .bind(session_id)
        .bind(user_id)
        .bind(profile_id)
        .bind(plan_id)
        .bind(&plan)
        .execute(pool)
        .await?;
    run_session(pool, user_id, session_id, plan).await
}

pub async fn rerun(pool: &Pool<Postgres>, user_id: Uuid, session_id: Uuid) -> Result<Value> {
    let plan: Value = sqlx::query_scalar(
        "SELECT plan_snapshot FROM search_sessions WHERE id = $1 AND user_id = $2",
    )
    .bind(session_id)
    .bind(user_id)
    .fetch_one(pool)
    .await?;
    let mut transaction = pool.begin().await?;
    sqlx::query("UPDATE search_sessions SET status = 'running', stage = 'reranking', completed_at = NULL, updated_at = NOW() WHERE id = $1 AND user_id = $2")
        .bind(session_id)
        .bind(user_id)
        .execute(&mut *transaction)
        .await?;
    sqlx::query("DELETE FROM search_session_queries WHERE session_id = $1")
        .bind(session_id)
        .execute(&mut *transaction)
        .await?;
    sqlx::query("DELETE FROM search_session_results WHERE session_id = $1")
        .bind(session_id)
        .execute(&mut *transaction)
        .await?;
    transaction.commit().await?;
    run_session(pool, user_id, session_id, plan).await
}

pub async fn rerun_after_source_refresh(pool: &Pool<Postgres>, session_id: Uuid) -> Result<Value> {
    let user_id: Uuid = sqlx::query_scalar("SELECT user_id FROM search_sessions WHERE id = $1")
        .bind(session_id)
        .fetch_one(pool)
        .await?;
    rerun(pool, user_id, session_id).await
}

pub async fn get(pool: &Pool<Postgres>, user_id: Uuid, session_id: Uuid) -> Result<Value> {
    get_page(pool, user_id, session_id, None, 100).await
}

pub async fn get_page(
    pool: &Pool<Postgres>,
    user_id: Uuid,
    session_id: Uuid,
    cursor: Option<i32>,
    limit: i64,
) -> Result<Value> {
    let limit = limit.clamp(1, 100);
    let cursor = cursor.unwrap_or(0).max(0);
    let session = sqlx::query("SELECT id, profile_id, plan_id, status, stage, plan_snapshot, coverage, query_count, result_count, started_at, completed_at, updated_at, error FROM search_sessions WHERE id = $1 AND user_id = $2")
        .bind(session_id).bind(user_id).fetch_one(pool).await?;
    let rows = sqlx::query(
        "SELECT j.id, j.source_url, j.source_name, j.title, j.company, j.location, j.country, j.remote, j.employment_type, j.experience_years, j.degree_required, \
         j.salary_min, j.salary_max, j.salary_currency, j.date_posted, j.description, j.skills, j.lifecycle_status, j.last_verified_at, j.geographic_locations, j.remote_policy, j.opportunity_classification, r.score, r.rank, r.eligibility_status, r.eligibility, \
         COALESCE((SELECT JSONB_AGG(m.reason ORDER BY q.created_at) FROM search_result_matches m JOIN search_session_queries q ON q.id = m.query_id WHERE m.session_id = r.session_id AND m.job_id = r.job_id), '[]'::jsonb) provenance \
         FROM search_session_results r JOIN jobs j ON j.id = r.job_id \
         WHERE r.session_id = $1 AND r.rank > $2 ORDER BY r.rank, r.job_id LIMIT $3",
    )
    .bind(session_id)
    .bind(cursor)
    .bind(limit + 1)
    .fetch_all(pool)
    .await?;
    let has_more = rows.len() > limit as usize;
    let page_rows = rows.into_iter().take(limit as usize).collect::<Vec<_>>();
    let next_cursor = if has_more {
        page_rows
            .last()
            .and_then(|row| row.get::<Option<i32>, _>("rank"))
    } else {
        None
    };
    let jobs = page_rows.into_iter().map(|row| json!({
        "id": row.get::<Uuid,_>("id"), "source_url": row.get::<String,_>("source_url"), "source_name": row.get::<String,_>("source_name"), "title": row.get::<String,_>("title"),
        "company": row.get::<String,_>("company"), "location": row.get::<Option<String>,_>("location"), "country": row.get::<Option<String>,_>("country"), "remote": row.get::<bool,_>("remote"),
        "employment_type": row.get::<Option<String>,_>("employment_type"), "experience_years": row.get::<Option<i16>,_>("experience_years"), "degree_required": row.get::<Option<bool>,_>("degree_required"),
        "salary_min": row.get::<Option<f64>,_>("salary_min"), "salary_max": row.get::<Option<f64>,_>("salary_max"), "salary_currency": row.get::<Option<String>,_>("salary_currency"),
        "date_posted": row.get::<Option<chrono::NaiveDate>,_>("date_posted"), "description": row.get::<String,_>("description"), "skills": row.get::<Value,_>("skills"),
        "lifecycle_status": row.get::<String,_>("lifecycle_status"), "last_verified_at": row.get::<Option<chrono::DateTime<Utc>>,_>("last_verified_at"), "geographic_locations": row.get::<Value,_>("geographic_locations"),
        "remote_policy": row.get::<Value,_>("remote_policy"), "opportunity_classification": row.get::<Value,_>("opportunity_classification"), "eligibility_status": row.get::<String,_>("eligibility_status"), "eligibility": row.get::<Value,_>("eligibility"), "search_score": row.get::<f64,_>("score"),
        "search_rank": row.get::<Option<i32>,_>("rank"), "provenance": row.get::<Value,_>("provenance")
    })).collect::<Vec<_>>();
    let source_rows = sqlx::query(
        "SELECT source_id, endpoint_url, state, selected_reason, selected_at, queued_at, completed_at, source_run_id, observed_jobs, error FROM search_session_sources WHERE session_id = $1 ORDER BY source_id",
    )
    .bind(session_id)
    .fetch_all(pool)
    .await?;
    let query_rows = sqlx::query(
        "SELECT id, query_text, constraints, match_count, execution_ms, created_at FROM search_session_queries WHERE session_id = $1 ORDER BY created_at",
    )
    .bind(session_id)
    .fetch_all(pool)
    .await?;
    let listings_inspected = query_rows
        .iter()
        .map(|row| i64::from(row.get::<i32, _>("match_count")))
        .sum::<i64>();
    let queries = query_rows
        .into_iter()
        .map(|row| {
            json!({
                "id": row.get::<Uuid, _>("id"),
                "query_text": row.get::<String, _>("query_text"),
                "constraints": row.get::<Value, _>("constraints"),
                "match_count": row.get::<i32, _>("match_count"),
                "execution_ms": row.get::<i64, _>("execution_ms"),
                "created_at": row.get::<chrono::DateTime<Utc>, _>("created_at")
            })
        })
        .collect::<Vec<_>>();
    let relevant_sources_selected = source_rows.len() as i64;
    let fresh_sources_reused = source_rows
        .iter()
        .filter(|row| row.get::<String, _>("state") == "fresh")
        .count() as i64;
    let stale_sources_scanned = source_rows
        .iter()
        .filter(|row| {
            row.get::<Option<chrono::DateTime<Utc>>, _>("queued_at")
                .is_some()
        })
        .count() as i64;
    let source_expansion = source_rows
        .into_iter()
        .map(|row| {
            json!({
                "source_id": row.get::<String, _>("source_id"),
                "endpoint_url": row.get::<String, _>("endpoint_url"),
                "state": row.get::<String, _>("state"),
                "selected_reason": row.get::<Value, _>("selected_reason"),
                "selected_at": row.get::<chrono::DateTime<Utc>, _>("selected_at"),
                "queued_at": row.get::<Option<chrono::DateTime<Utc>>, _>("queued_at"),
                "completed_at": row.get::<Option<chrono::DateTime<Utc>>, _>("completed_at"),
                "source_run_id": row.get::<Option<Uuid>, _>("source_run_id"),
                "observed_jobs": row.get::<Option<i32>, _>("observed_jobs"),
                "error": row.get::<Option<String>, _>("error")
            })
        })
        .collect::<Vec<_>>();
    Ok(
        json!({ "session": { "id": session.get::<Uuid,_>("id"), "profile_id": session.get::<Option<Uuid>,_>("profile_id"), "plan_id": session.get::<Option<Uuid>,_>("plan_id"),
        "status": session.get::<String,_>("status"), "stage": session.get::<String,_>("stage"), "plan": session.get::<Value,_>("plan_snapshot"), "coverage": session.get::<Value,_>("coverage"),
        "query_count": session.get::<i32,_>("query_count"), "result_count": session.get::<i32,_>("result_count"), "started_at": session.get::<chrono::DateTime<Utc>,_>("started_at"),
        "completed_at": session.get::<Option<chrono::DateTime<Utc>>,_>("completed_at"), "updated_at": session.get::<chrono::DateTime<Utc>,_>("updated_at"), "error": session.get::<Option<String>,_>("error") }, "jobs": jobs, "queries": queries, "source_expansion": source_expansion,
        "results_page": { "cursor": cursor, "limit": limit, "has_more": has_more, "next_cursor": next_cursor },
        "execution_counts": {
            "existing_index_results": session.get::<i32,_>("result_count"),
            "relevant_sources_selected": relevant_sources_selected,
            "fresh_sources_reused": fresh_sources_reused,
            "stale_sources_scanned": stale_sources_scanned,
            "listings_inspected": listings_inspected,
            "eligibility_evaluated": listings_inspected,
            "listings_ranked": session.get::<i32,_>("result_count"),
            "recommendations_produced": session.get::<i32,_>("result_count")
        } }),
    )
}

pub async fn list(pool: &Pool<Postgres>, user_id: Uuid) -> Result<Value> {
    let rows = sqlx::query("SELECT id, profile_id, plan_id, status, stage, plan_snapshot, query_count, result_count, coverage, started_at, completed_at, updated_at FROM search_sessions WHERE user_id = $1 ORDER BY started_at DESC LIMIT 30").bind(user_id).fetch_all(pool).await?;
    Ok(
        json!({ "sessions": rows.into_iter().map(|row| json!({ "id": row.get::<Uuid,_>("id"), "profile_id": row.get::<Option<Uuid>,_>("profile_id"), "plan_id": row.get::<Option<Uuid>,_>("plan_id"), "status": row.get::<String,_>("status"), "stage": row.get::<String,_>("stage"), "plan": row.get::<Value,_>("plan_snapshot"), "query_count": row.get::<i32,_>("query_count"),
        "result_count": row.get::<i32,_>("result_count"), "coverage": row.get::<Value,_>("coverage"), "started_at": row.get::<chrono::DateTime<Utc>,_>("started_at"), "completed_at": row.get::<Option<chrono::DateTime<Utc>>,_>("completed_at"), "updated_at": row.get::<chrono::DateTime<Utc>,_>("updated_at") })).collect::<Vec<_>>() }),
    )
}

pub async fn is_owned(pool: &Pool<Postgres>, user_id: Uuid, session_id: Uuid) -> Result<bool> {
    Ok(sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM search_sessions WHERE id = $1 AND user_id = $2)",
    )
    .bind(session_id)
    .bind(user_id)
    .fetch_one(pool)
    .await?)
}

pub async fn feedback(pool: &Pool<Postgres>, user_id: Uuid, request: Value) -> Result<Value> {
    let session_id = uuid_at(&request, "session_id").context("invalid session_id")?;
    let job_id = uuid_at(&request, "job_id").context("invalid job_id")?;
    let action = request
        .get("action")
        .and_then(Value::as_str)
        .context("action is required")?;
    anyhow::ensure!(
        ["viewed", "saved", "dismissed", "applied"].contains(&action),
        "unsupported feedback action"
    );
    anyhow::ensure!(
        is_owned(pool, user_id, session_id).await?,
        "search session does not belong to user"
    );
    sqlx::query(
        "INSERT INTO search_feedback (user_id, session_id, job_id, action) VALUES ($1,$2,$3,$4)",
    )
    .bind(user_id)
    .bind(session_id)
    .bind(job_id)
    .bind(action)
    .execute(pool)
    .await?;
    Ok(json!({ "saved": true }))
}
