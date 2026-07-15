use anyhow::{Context, Result};
use axum::{
    Json, Router,
    extract::{Query, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
};
use chrono::{NaiveDate, Utc};
use firstrung_scout::{
    PENDING_SUBJECT,
    config::ScoutConfig,
    connect_database, ensure_stream,
    frontier::{enqueue_seed_for_recrawl, frontier_stats, insert_frontier},
    init_tracing,
    models::CrawlTask,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::{Pool, Postgres, Row};
use std::sync::Arc;
use tower_http::{
    cors::{Any, CorsLayer},
    trace::TraceLayer,
};
use tracing::info;
use uuid::Uuid;

#[derive(Clone)]
struct AppState {
    pool: Pool<Postgres>,
    jetstream: async_nats::jetstream::Context,
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
    employment_type: Option<String>,
    experience_years: Option<i16>,
    degree_required: Option<bool>,
    salary_min: Option<f64>,
    salary_max: Option<f64>,
    salary_currency: Option<String>,
    date_posted: Option<NaiveDate>,
    description: String,
    skills: Value,
}

#[derive(Debug, Deserialize)]
struct SeedRequest {
    url: String,
}

async fn health(State(state): State<Arc<AppState>>) -> Result<impl IntoResponse, ApiError> {
    sqlx::query("SELECT 1").execute(&state.pool).await?;
    Ok(Json(
        json!({ "status": "ok", "service": "roleatlas-scout" }),
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

async fn list_jobs(
    State(state): State<Arc<AppState>>,
    Query(query): Query<JobQuery>,
) -> Result<impl IntoResponse, ApiError> {
    let rows = sqlx::query(
        "SELECT id, source_url, source_name, title, company, location, country, remote, employment_type, \
         experience_years, degree_required, salary_min, salary_max, salary_currency, date_posted, description, skills \
         FROM jobs WHERE is_active = TRUE AND (valid_through IS NULL OR valid_through >= CURRENT_DATE) \
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
            employment_type: row.get("employment_type"),
            experience_years: row.get("experience_years"),
            degree_required: row.get("degree_required"),
            salary_min: row.get("salary_min"),
            salary_max: row.get("salary_max"),
            salary_currency: row.get("salary_currency"),
            date_posted: row.get("date_posted"),
            description: row.get("description"),
            skills: row.get("skills"),
        })
        .collect::<Vec<_>>();
    Ok(Json(json!({ "jobs": jobs, "count": jobs.len() })))
}

async fn add_seed(
    State(state): State<Arc<AppState>>,
    Json(request): Json<SeedRequest>,
) -> Result<impl IntoResponse, ApiError> {
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
    let task = CrawlTask {
        url: canonical.clone(),
        depth: 0,
        discovered_from: None,
        queued_at: Utc::now(),
    };
    let publish = state
        .jetstream
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
    let client = async_nats::connect(&config.nats_url)
        .await
        .context("connect to NATS")?;
    let jetstream = async_nats::jetstream::new(client);
    ensure_stream(&jetstream).await?;
    let state = Arc::new(AppState { pool, jetstream });

    let app = Router::new()
        .route("/health", get(health))
        .route("/api/jobs", get(list_jobs))
        .route("/api/stats", get(stats))
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
