use anyhow::{Context, Result};
use axum::{
    Json, Router,
    extract::{Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
};
use chrono::{DateTime, NaiveDate, Utc};
use firstrung_scout::{
    PENDING_SUBJECT,
    config::ScoutConfig,
    connect_database, ensure_stream,
    frontier::{begin_source_run, enqueue_seed_for_recrawl, frontier_stats, insert_frontier},
    init_tracing, orchestration, registry, search,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::{Pool, Postgres, Row};
use std::sync::Arc;
use tower_http::{
    cors::{Any, CorsLayer},
    trace::TraceLayer,
};
use tracing::{info, warn};
use uuid::Uuid;

#[derive(Clone)]
struct AppState {
    pool: Pool<Postgres>,
    jetstream: Option<async_nats::jetstream::Context>,
}

#[derive(Debug, Deserialize)]
struct JobQuery {
    q: Option<String>,
    location: Option<String>,
    max_experience: Option<i16>,
    remote: Option<bool>,
    no_degree: Option<bool>,
    posted_days: Option<i64>,
    limit: Option<i64>,
}

#[derive(Debug, Deserialize)]
struct RegistryQuery {
    country: Option<String>,
    region: Option<String>,
}

#[derive(Debug, Serialize)]
struct JobResponse {
    id: Uuid,
    source_url: String,
    source_name: String,
    title: String,
    company: String,
    location: Option<String>,
    country: Option<String>,
    remote: bool,
    geographic_locations: Value,
    remote_policy: Value,
    opportunity_classification: Value,
    employment_type: Option<String>,
    experience_years: Option<i16>,
    degree_required: Option<bool>,
    salary_min: Option<f64>,
    salary_max: Option<f64>,
    salary_currency: Option<String>,
    date_posted: Option<NaiveDate>,
    description: String,
    skills: Value,
    lifecycle_status: String,
    last_verified_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Deserialize)]
struct SeedRequest {
    url: String,
}

#[derive(Debug, Deserialize)]
struct CandidateProfileRequest {
    profile_id: Option<Uuid>,
    plan_id: Option<Uuid>,
    source_file: String,
    profile: Value,
    search_plan: Value,
}

async fn health(State(state): State<Arc<AppState>>) -> Result<impl IntoResponse, ApiError> {
    sqlx::query("SELECT 1").execute(&state.pool).await?;
    Ok(Json(
        json!({ "status": "ok", "service": "roleatlas-scout", "crawler_queue": if state.jetstream.is_some() { "available" } else { "unavailable" } }),
    ))
}

async fn stats(State(state): State<Arc<AppState>>) -> Result<impl IntoResponse, ApiError> {
    let (queued, fetched, failed) = frontier_stats(&state.pool).await?;
    let jobs: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM jobs WHERE is_active = TRUE")
        .fetch_one(&state.pool)
        .await?;
    Ok(Json(
        json!({ "queued": queued, "fetched": fetched, "failed": failed, "jobs": jobs }),
    ))
}

async fn metrics(State(state): State<Arc<AppState>>) -> Result<impl IntoResponse, ApiError> {
    let row = sqlx::query(
        "SELECT COUNT(*) FILTER (WHERE lifecycle_status = 'active') active, \
         COUNT(*) FILTER (WHERE lifecycle_status = 'possibly_closed') possibly_closed, \
         COUNT(*) FILTER (WHERE lifecycle_status = 'closed') closed, COUNT(*) total FROM jobs",
    )
    .fetch_one(&state.pool)
    .await?;
    let sources = sqlx::query(
        "SELECT source_type, COUNT(*) count FROM sources WHERE enabled = TRUE GROUP BY source_type ORDER BY source_type",
    ).fetch_all(&state.pool).await?.into_iter().map(|row| json!({ "source_type": row.get::<String,_>("source_type"), "count": row.get::<i64,_>("count") })).collect::<Vec<_>>();
    Ok(Json(
        json!({ "jobs": { "active": row.get::<i64,_>("active"), "possibly_closed": row.get::<i64,_>("possibly_closed"), "closed": row.get::<i64,_>("closed"), "total": row.get::<i64,_>("total") }, "sources": sources }),
    ))
}

async fn source_health(State(state): State<Arc<AppState>>) -> Result<impl IntoResponse, ApiError> {
    let rows = sqlx::query(
        "SELECT s.id, s.source_type, s.url, s.supports_complete_scan, s.last_run_at, s.last_success_at, \
         r.status last_status, r.observed_jobs, r.completed_at, r.error \
         FROM sources s LEFT JOIN LATERAL (SELECT status, observed_jobs, completed_at, error FROM source_runs WHERE source_id = s.id ORDER BY started_at DESC LIMIT 1) r ON TRUE \
         WHERE s.enabled = TRUE ORDER BY s.source_type, s.id",
    ).fetch_all(&state.pool).await?;
    let sources = rows.into_iter().map(|row| json!({
        "id": row.get::<String,_>("id"), "source_type": row.get::<String,_>("source_type"), "url": row.get::<String,_>("url"),
        "supports_complete_scan": row.get::<bool,_>("supports_complete_scan"), "last_run_at": row.get::<Option<DateTime<Utc>>,_>("last_run_at"),
        "last_success_at": row.get::<Option<DateTime<Utc>>,_>("last_success_at"), "last_status": row.get::<Option<String>,_>("last_status"),
        "observed_jobs": row.get::<Option<i32>,_>("observed_jobs").unwrap_or(0), "completed_at": row.get::<Option<DateTime<Utc>>,_>("completed_at"),
        "error": row.get::<Option<String>,_>("error")
    })).collect::<Vec<_>>();
    Ok(Json(json!({ "sources": sources, "count": sources.len() })))
}

async fn registry_stats(
    State(state): State<Arc<AppState>>,
    Query(query): Query<RegistryQuery>,
) -> Result<impl IntoResponse, ApiError> {
    let health_rows = sqlx::query(
        "SELECT s.id, r.status FROM sources s LEFT JOIN LATERAL (SELECT status FROM source_runs WHERE source_id = s.id ORDER BY started_at DESC LIMIT 1) r ON TRUE",
    )
    .fetch_all(&state.pool)
    .await?;
    let health = health_rows
        .into_iter()
        .map(|row| {
            (
                row.get::<String, _>("id"),
                row.get::<Option<String>, _>("status"),
            )
        })
        .collect::<std::collections::HashMap<_, _>>();
    let countries = query.country.into_iter().collect::<Vec<_>>();
    let regions = query.region.into_iter().collect::<Vec<_>>();
    let selected = registry::enabled_sources()
        .filter(|source| registry::supports_geography(source, &countries, &regions))
        .map(|source| json!({
            "id": source.id,
            "company": source.company,
            "adapter": source.adapter,
            "endpointUrl": source.endpoint_url,
            "hiringCountryCodes": source.hiring_country_codes,
            "hiringRegionCodes": source.hiring_region_codes,
            "opportunityHistory": source.opportunity_history,
            "remoteHistory": source.remote_history,
            "lastVerified": source.last_verified,
            "health": health.get(&source.id).cloned().flatten().unwrap_or_else(|| "unscanned".into())
        }))
        .collect::<Vec<_>>();
    let healthy_sources = registry::enabled_sources()
        .filter(|source| {
            health
                .get(&source.id)
                .is_some_and(|status| status.as_deref() == Some("success"))
        })
        .count();
    let failed_sources = registry::enabled_sources()
        .filter(|source| {
            health
                .get(&source.id)
                .is_some_and(|status| status.as_deref() == Some("failed"))
        })
        .count();
    let mut statistics = registry::static_statistics();
    if let Some(object) = statistics.as_object_mut() {
        object.insert("healthySources".into(), json!(healthy_sources));
        object.insert("failedSources".into(), json!(failed_sources));
        object.insert("sourcesSupportingSelection".into(), json!(selected.len()));
    }
    Ok(Json(json!({
        "statistics": statistics,
        "selection": { "countryCodes": countries, "regionCodes": regions, "sources": selected },
        "generatedFrom": "validated_registry_and_latest_source_runs"
    })))
}

async fn get_candidate_profile(
    State(state): State<Arc<AppState>>,
) -> Result<impl IntoResponse, ApiError> {
    let row = sqlx::query(
        "SELECT p.id profile_id, p.source_file, p.profile, p.updated_at, s.id plan_id, s.plan, s.confirmed_at \
         FROM candidate_profiles p LEFT JOIN search_plans s ON s.profile_id = p.id AND s.is_active = TRUE \
         ORDER BY p.updated_at DESC LIMIT 1",
    ).fetch_optional(&state.pool).await?;
    let Some(row) = row else {
        return Ok(Json(json!({ "profile": null, "search_plan": null })));
    };
    Ok(Json(json!({
        "profile_id": row.get::<Uuid,_>("profile_id"), "plan_id": row.get::<Option<Uuid>,_>("plan_id"), "source_file": row.get::<String,_>("source_file"),
        "profile": row.get::<Value,_>("profile"), "search_plan": row.get::<Option<Value>,_>("plan"), "confirmed_at": row.get::<Option<DateTime<Utc>>,_>("confirmed_at"),
        "updated_at": row.get::<DateTime<Utc>,_>("updated_at")
    })))
}

async fn save_candidate_profile(
    State(state): State<Arc<AppState>>,
    Json(request): Json<CandidateProfileRequest>,
) -> Result<impl IntoResponse, ApiError> {
    if request.source_file.trim().is_empty()
        || !request.profile.is_object()
        || !request.search_plan.is_object()
    {
        return Err(ApiError::bad_request(
            "source_file, profile, and search_plan are required",
        ));
    }
    let profile_id = request.profile_id.unwrap_or_else(Uuid::new_v4);
    let plan_id = request.plan_id.unwrap_or_else(Uuid::new_v4);
    let confirmed = request
        .search_plan
        .get("confirmedAt")
        .is_some_and(|value| !value.is_null());
    let mut tx = state.pool.begin().await?;
    sqlx::query(
        "INSERT INTO candidate_profiles (id, profile, source_file) VALUES ($1,$2,$3) ON CONFLICT (id) DO UPDATE SET profile = EXCLUDED.profile, source_file = EXCLUDED.source_file, updated_at = NOW()",
    ).bind(profile_id).bind(&request.profile).bind(&request.source_file).execute(&mut *tx).await?;
    sqlx::query("UPDATE search_plans SET is_active = FALSE, updated_at = NOW() WHERE profile_id = $1 AND id <> $2")
        .bind(profile_id).bind(plan_id).execute(&mut *tx).await?;
    sqlx::query(
        "INSERT INTO search_plans (id, profile_id, plan, confirmed_at) VALUES ($1,$2,$3,CASE WHEN $4 THEN NOW() ELSE NULL END) \
         ON CONFLICT (id) DO UPDATE SET plan = EXCLUDED.plan, confirmed_at = EXCLUDED.confirmed_at, is_active = TRUE, updated_at = NOW()",
    ).bind(plan_id).bind(profile_id).bind(&request.search_plan).bind(confirmed).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(Json(
        json!({ "profile_id": profile_id, "plan_id": plan_id, "saved": true }),
    ))
}

async fn create_search_session(
    State(state): State<Arc<AppState>>,
    Json(request): Json<Value>,
) -> Result<impl IntoResponse, ApiError> {
    let initial = search::execute(&state.pool, request).await?;
    let session_id = initial["session"]["id"]
        .as_str()
        .and_then(|value| Uuid::parse_str(value).ok())
        .ok_or_else(|| ApiError::internal("search session id missing".into()))?;
    orchestration::select_sources(&state.pool, session_id).await?;
    orchestration::queue_selected_sources(&state.pool, state.jetstream.as_ref(), session_id)
        .await?;
    Ok(Json(search::get(&state.pool, session_id).await?))
}

async fn list_search_sessions(
    State(state): State<Arc<AppState>>,
) -> Result<impl IntoResponse, ApiError> {
    Ok(Json(search::list(&state.pool).await?))
}

async fn get_search_session(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> Result<impl IntoResponse, ApiError> {
    orchestration::refresh_session(&state.pool, id).await?;
    Ok(Json(search::get(&state.pool, id).await?))
}

async fn save_search_feedback(
    State(state): State<Arc<AppState>>,
    Json(request): Json<Value>,
) -> Result<impl IntoResponse, ApiError> {
    Ok(Json(search::feedback(&state.pool, request).await?))
}

async fn list_jobs(
    State(state): State<Arc<AppState>>,
    Query(query): Query<JobQuery>,
) -> Result<impl IntoResponse, ApiError> {
    let rows = sqlx::query(
        "SELECT id, source_url, source_name, title, company, location, country, remote, employment_type, \
         experience_years, degree_required, salary_min, salary_max, salary_currency, date_posted, description, skills, geographic_locations, remote_policy, opportunity_classification, lifecycle_status, last_verified_at, COUNT(*) OVER() total_count \
         FROM jobs WHERE lifecycle_status IN ('active','possibly_closed') AND (valid_through IS NULL OR valid_through >= CURRENT_DATE) \
         AND ($1::TEXT IS NULL OR title ILIKE '%' || $1 || '%' OR company ILIKE '%' || $1 || '%' OR description ILIKE '%' || $1 || '%') \
         AND ($2::TEXT IS NULL OR location ILIKE '%' || $2 || '%' OR country ILIKE '%' || $2 || '%') \
         AND ($3::SMALLINT IS NULL OR experience_years IS NULL OR experience_years <= $3) \
         AND ($4::BOOLEAN IS NULL OR remote = $4) \
         AND ($5::BOOLEAN IS NULL OR degree_required IS DISTINCT FROM TRUE) \
         AND ($6::BIGINT IS NULL OR date_posted IS NULL OR date_posted >= CURRENT_DATE - ($6 * INTERVAL '1 day')) \
         ORDER BY date_posted DESC NULLS LAST, first_seen_at DESC LIMIT $7",
    )
    .bind(query.q.as_deref())
    .bind(query.location.as_deref())
    .bind(query.max_experience)
    .bind(query.remote)
    .bind(query.no_degree)
    .bind(query.posted_days)
    .bind(query.limit.unwrap_or(100).clamp(1, 1_000))
    .fetch_all(&state.pool)
    .await?;

    let total_count = rows
        .first()
        .map(|row| row.get::<i64, _>("total_count"))
        .unwrap_or(0);
    let jobs = rows
        .into_iter()
        .map(|row| JobResponse {
            id: row.get("id"),
            source_url: row.get("source_url"),
            source_name: row.get("source_name"),
            title: row.get("title"),
            company: row.get("company"),
            location: row.get("location"),
            country: row.get("country"),
            remote: row.get("remote"),
            geographic_locations: row.get("geographic_locations"),
            remote_policy: row.get("remote_policy"),
            opportunity_classification: row.get("opportunity_classification"),
            employment_type: row.get("employment_type"),
            experience_years: row.get("experience_years"),
            degree_required: row.get("degree_required"),
            salary_min: row.get("salary_min"),
            salary_max: row.get("salary_max"),
            salary_currency: row.get("salary_currency"),
            date_posted: row.get("date_posted"),
            description: row.get("description"),
            skills: row.get("skills"),
            lifecycle_status: row.get("lifecycle_status"),
            last_verified_at: row.get("last_verified_at"),
        })
        .collect::<Vec<_>>();
    let coverage = sqlx::query(
        "SELECT COUNT(*) total_sources, COUNT(*) FILTER (WHERE last_success_at IS NOT NULL) successful_sources, \
         MAX(last_success_at) freshest_success FROM sources WHERE enabled = TRUE",
    ).fetch_one(&state.pool).await?;
    Ok(Json(
        json!({ "jobs": jobs, "count": total_count, "returned": jobs.len(), "coverage": {
        "sources_searched": coverage.get::<i64,_>("total_sources"), "sources_successful": coverage.get::<i64,_>("successful_sources"),
        "freshest_success": coverage.get::<Option<DateTime<Utc>>,_>("freshest_success"), "query": query.q, "location": query.location,
        "complete": coverage.get::<i64,_>("total_sources") > 0 && coverage.get::<i64,_>("total_sources") == coverage.get::<i64,_>("successful_sources")
    } }),
    ))
}

async fn add_seed(
    State(state): State<Arc<AppState>>,
    Json(request): Json<SeedRequest>,
) -> Result<impl IntoResponse, ApiError> {
    let jetstream = state.jetstream.as_ref().ok_or_else(|| {
        ApiError::service_unavailable(
            "Crawler queue is unavailable. Existing indexed jobs and search remain available.",
        )
    })?;
    let url = url::Url::parse(&request.url).map_err(|_| ApiError::bad_request("invalid URL"))?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err(ApiError::bad_request(
            "only http and https URLs are accepted",
        ));
    }
    let canonical = url.to_string();
    let inserted = insert_frontier(&state.pool, &canonical, 0, None).await?;
    let _state_changed = inserted || enqueue_seed_for_recrawl(&state.pool, &canonical, 0).await?;
    // Publishing is intentional even when PostgreSQL already says `queued`.
    // JetStream may have exhausted or lost an earlier delivery, and an explicit
    // queue request must repair that split-brain state instead of becoming a no-op.
    let task = begin_source_run(&state.pool, &canonical).await?;
    let publish = jetstream
        .publish(PENDING_SUBJECT, serde_json::to_vec(&task)?.into())
        .await
        .map_err(|error| ApiError::internal(error.to_string()))?;
    publish
        .await
        .map_err(|error| ApiError::internal(error.to_string()))?;
    Ok((
        StatusCode::ACCEPTED,
        Json(json!({ "queued": true, "url": canonical })),
    ))
}

struct ApiError {
    status: StatusCode,
    message: String,
}

impl ApiError {
    fn bad_request(message: &str) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            message: message.into(),
        }
    }
    fn internal(message: String) -> Self {
        Self {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            message,
        }
    }
    fn service_unavailable(message: &str) -> Self {
        Self {
            status: StatusCode::SERVICE_UNAVAILABLE,
            message: message.into(),
        }
    }
}

impl From<anyhow::Error> for ApiError {
    fn from(error: anyhow::Error) -> Self {
        Self::internal(error.to_string())
    }
}
impl From<sqlx::Error> for ApiError {
    fn from(error: sqlx::Error) -> Self {
        Self::internal(error.to_string())
    }
}
impl From<serde_json::Error> for ApiError {
    fn from(error: serde_json::Error) -> Self {
        Self::internal(error.to_string())
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> axum::response::Response {
        (self.status, Json(json!({ "error": self.message }))).into_response()
    }
}

#[tokio::main]
async fn main() -> Result<()> {
    init_tracing();
    let config = ScoutConfig::from_env();
    let pool = connect_database(&config.database_url)
        .await
        .context("connect to Postgres")?;
    let jetstream = match async_nats::connect(&config.nats_url).await {
        Ok(client) => {
            let context = async_nats::jetstream::new(client);
            match ensure_stream(&context).await {
                Ok(_) => Some(context),
                Err(error) => {
                    warn!(%error, "NATS JetStream unavailable; crawler queue actions are deferred");
                    None
                }
            }
        }
        Err(error) => {
            warn!(%error, "NATS unavailable; indexed search remains online");
            None
        }
    };
    let state = Arc::new(AppState { pool, jetstream });

    let app = Router::new()
        .route("/health", get(health))
        .route("/api/jobs", get(list_jobs))
        .route("/api/stats", get(stats))
        .route("/api/metrics", get(metrics))
        .route("/api/source-health", get(source_health))
        .route("/api/registry", get(registry_stats))
        .route(
            "/api/candidate-profile",
            get(get_candidate_profile).post(save_candidate_profile),
        )
        .route(
            "/api/search-sessions",
            get(list_search_sessions).post(create_search_session),
        )
        .route("/api/search-sessions/{id}", get(get_search_session))
        .route("/api/search-feedback", post(save_search_feedback))
        .route("/api/seeds", post(add_seed))
        .layer(
            CorsLayer::new()
                .allow_origin(Any)
                .allow_headers(Any)
                .allow_methods(Any),
        )
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    let address = "0.0.0.0:8080";
    let listener = tokio::net::TcpListener::bind(address).await?;
    info!(address, "scout API ready");
    axum::serve(listener, app).await?;
    Ok(())
}
