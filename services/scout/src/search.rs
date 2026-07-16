use crate::eligibility::{
    CandidateEligibility, CandidateMobility, RemotePolicy, evaluate_candidate, parse_remote_policy,
};
use crate::geography::normalize_location;
use anyhow::{Context, Result};
use chrono::Utc;
use serde_json::{Value, json};
use sqlx::{Pool, Postgres, Row};
use std::time::Instant;
use uuid::Uuid;

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

async fn resolve_plan(
    pool: &Pool<Postgres>,
    request: &Value,
) -> Result<(Option<Uuid>, Option<Uuid>, Value)> {
    if let Some(plan) = request.get("search_plan").filter(|value| value.is_object()) {
        return Ok((
            uuid_at(request, "profile_id"),
            uuid_at(request, "plan_id"),
            plan.clone(),
        ));
    }
    let row = if let Some(plan_id) = uuid_at(request, "plan_id") {
        sqlx::query(
            "SELECT profile_id, id, plan FROM search_plans WHERE id = $1 AND is_active = TRUE",
        )
        .bind(plan_id)
        .fetch_optional(pool)
        .await?
    } else if let Some(profile_id) = uuid_at(request, "profile_id") {
        sqlx::query("SELECT profile_id, id, plan FROM search_plans WHERE profile_id = $1 AND is_active = TRUE ORDER BY updated_at DESC LIMIT 1").bind(profile_id).fetch_optional(pool).await?
    } else {
        sqlx::query("SELECT profile_id, id, plan FROM search_plans WHERE is_active = TRUE ORDER BY updated_at DESC LIMIT 1").fetch_optional(pool).await?
    };
    let row = row.context("no confirmed active search plan exists")?;
    Ok((
        Some(row.get("profile_id")),
        Some(row.get("id")),
        row.get("plan"),
    ))
}

async fn run_session(pool: &Pool<Postgres>, session_id: Uuid, plan: Value) -> Result<Value> {
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
    let mobility = mobility_from_plan(&plan);

    for query_text in &role_queries {
        let started = Instant::now();
        let query_id = Uuid::new_v4();
        let terms = query_terms(query_text);
        if terms.is_empty() {
            continue;
        }
        let rows = sqlx::query(
             "SELECT id, title, location, description, remote, remote_policy FROM jobs WHERE lifecycle_status IN ('active','possibly_closed') \
             AND EXISTS (SELECT 1 FROM UNNEST($1::TEXT[]) term WHERE title ILIKE '%' || term || '%' OR description ILIKE '%' || term || '%' OR company ILIKE '%' || term || '%') \
             AND (CARDINALITY($2::TEXT[]) = 0 OR EXISTS (SELECT 1 FROM UNNEST($2::TEXT[]) kind WHERE employment_type ILIKE '%' || kind || '%' OR title ILIKE '%' || kind || '%' OR opportunity_classification->>'jobType' ILIKE '%' || kind || '%')) \
             AND ($3::SMALLINT IS NULL OR experience_years IS NULL OR experience_years <= $3) \
             AND ($4::BOOLEAN = FALSE OR degree_required IS DISTINCT FROM TRUE) \
             ORDER BY date_posted DESC NULLS LAST, last_verified_at DESC NULLS LAST LIMIT 5000",
        ).bind(&terms).bind(&job_types).bind(max_experience).bind(no_degree).fetch_all(pool).await?;
        let constraints = json!({ "locations": locations, "jobTypes": job_types, "maxExperience": max_experience, "noDegreeRequired": no_degree, "mobility": &mobility });
        sqlx::query("INSERT INTO search_session_queries (id, session_id, query_text, constraints, match_count, execution_ms) VALUES ($1,$2,$3,$4,$5,$6)")
            .bind(query_id).bind(session_id).bind(query_text).bind(constraints).bind(rows.len() as i32).bind(started.elapsed().as_millis() as i64).execute(pool).await?;
        for row in rows {
            let job_id: Uuid = row.get("id");
            let title: String = row.get("title");
            let location: Option<String> = row.get("location");
            let description: String = row.get("description");
            let remote: bool = row.get("remote");
            let stored_policy: Value = row.get("remote_policy");
            let policy = serde_json::from_value::<RemotePolicy>(stored_policy)
                .unwrap_or_else(|_| parse_remote_policy(location.as_deref(), &description, remote));
            let eligibility = evaluate_candidate(&mobility, &policy);
            if matches!(
                eligibility.status,
                CandidateEligibility::Excluded | CandidateEligibility::TimezoneMismatch
            ) {
                continue;
            }
            let title_lower = title.to_lowercase();
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
            sqlx::query("INSERT INTO search_session_results (session_id, job_id, score, eligibility_status, eligibility) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (session_id, job_id) DO UPDATE SET score = GREATEST(search_session_results.score, EXCLUDED.score), eligibility_status = EXCLUDED.eligibility_status, eligibility = EXCLUDED.eligibility")
                .bind(session_id).bind(job_id).bind(score).bind(eligibility_status).bind(&eligibility_value).execute(pool).await?;
            sqlx::query("INSERT INTO search_result_matches (session_id, job_id, query_id, reason) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING")
                .bind(session_id).bind(job_id).bind(query_id).bind(json!({ "query": query_text, "title_term_hits": hits, "matched_index": "postgresql_jobs", "eligibility": eligibility })).execute(pool).await?;
        }
    }

    sqlx::query("WITH ranked AS (SELECT job_id, ROW_NUMBER() OVER (ORDER BY score DESC, created_at) rank FROM search_session_results WHERE session_id = $1) UPDATE search_session_results r SET rank = ranked.rank FROM ranked WHERE r.session_id = $1 AND r.job_id = ranked.job_id")
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
    get(pool, session_id).await
}

pub async fn execute(pool: &Pool<Postgres>, request: Value) -> Result<Value> {
    let (profile_id, plan_id, plan) = resolve_plan(pool, &request).await?;
    let session_id = Uuid::new_v4();
    sqlx::query("INSERT INTO search_sessions (id, profile_id, plan_id, status, stage, plan_snapshot) VALUES ($1,$2,$3,'running','searching_index',$4)")
        .bind(session_id)
        .bind(profile_id)
        .bind(plan_id)
        .bind(&plan)
        .execute(pool)
        .await?;
    run_session(pool, session_id, plan).await
}

pub async fn rerun(pool: &Pool<Postgres>, session_id: Uuid) -> Result<Value> {
    let plan: Value = sqlx::query_scalar("SELECT plan_snapshot FROM search_sessions WHERE id = $1")
        .bind(session_id)
        .fetch_one(pool)
        .await?;
    let mut transaction = pool.begin().await?;
    sqlx::query("UPDATE search_sessions SET status = 'running', stage = 'reranking', completed_at = NULL, updated_at = NOW() WHERE id = $1")
        .bind(session_id)
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
    run_session(pool, session_id, plan).await
}

pub async fn get(pool: &Pool<Postgres>, session_id: Uuid) -> Result<Value> {
    let session = sqlx::query("SELECT id, profile_id, plan_id, status, stage, plan_snapshot, coverage, query_count, result_count, started_at, completed_at, updated_at, error FROM search_sessions WHERE id = $1")
        .bind(session_id).fetch_one(pool).await?;
    let rows = sqlx::query(
        "SELECT j.id, j.source_url, j.source_name, j.title, j.company, j.location, j.country, j.remote, j.employment_type, j.experience_years, j.degree_required, \
         j.salary_min, j.salary_max, j.salary_currency, j.date_posted, j.description, j.skills, j.lifecycle_status, j.last_verified_at, j.geographic_locations, j.remote_policy, j.opportunity_classification, r.score, r.rank, r.eligibility_status, r.eligibility, \
         COALESCE((SELECT JSONB_AGG(m.reason ORDER BY q.created_at) FROM search_result_matches m JOIN search_session_queries q ON q.id = m.query_id WHERE m.session_id = r.session_id AND m.job_id = r.job_id), '[]'::jsonb) provenance \
         FROM search_session_results r JOIN jobs j ON j.id = r.job_id WHERE r.session_id = $1 ORDER BY r.rank LIMIT 1000",
    ).bind(session_id).fetch_all(pool).await?;
    let jobs = rows.into_iter().map(|row| json!({
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

pub async fn list(pool: &Pool<Postgres>) -> Result<Value> {
    let rows = sqlx::query("SELECT id, profile_id, plan_id, status, stage, plan_snapshot, query_count, result_count, coverage, started_at, completed_at, updated_at FROM search_sessions ORDER BY started_at DESC LIMIT 30").fetch_all(pool).await?;
    Ok(
        json!({ "sessions": rows.into_iter().map(|row| json!({ "id": row.get::<Uuid,_>("id"), "profile_id": row.get::<Option<Uuid>,_>("profile_id"), "plan_id": row.get::<Option<Uuid>,_>("plan_id"), "status": row.get::<String,_>("status"), "stage": row.get::<String,_>("stage"), "plan": row.get::<Value,_>("plan_snapshot"), "query_count": row.get::<i32,_>("query_count"),
        "result_count": row.get::<i32,_>("result_count"), "coverage": row.get::<Value,_>("coverage"), "started_at": row.get::<chrono::DateTime<Utc>,_>("started_at"), "completed_at": row.get::<Option<chrono::DateTime<Utc>>,_>("completed_at"), "updated_at": row.get::<chrono::DateTime<Utc>,_>("updated_at") })).collect::<Vec<_>>() }),
    )
}

pub async fn feedback(pool: &Pool<Postgres>, request: Value) -> Result<Value> {
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
    sqlx::query("INSERT INTO search_feedback (session_id, job_id, action) VALUES ($1,$2,$3)")
        .bind(session_id)
        .bind(job_id)
        .bind(action)
        .execute(pool)
        .await?;
    Ok(json!({ "saved": true }))
}
