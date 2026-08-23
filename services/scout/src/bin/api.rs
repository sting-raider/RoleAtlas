use anyhow::{Context, Result};
use axum::{
    Json, Router,
    extract::{FromRequestParts, Path, Query, State},
    http::{HeaderMap, StatusCode, request::Parts},
    response::IntoResponse,
    routing::{get, post},
};
use chrono::{DateTime, Utc};
use firstrung_scout::{
    PENDING_SUBJECT,
    config::ScoutConfig,
    connect_database, ensure_stream,
    frontier::{
        begin_source_run, begin_source_run_with_id, enqueue_seed_for_recrawl, frontier_stats,
        insert_frontier,
    },
    init_tracing, orchestration, registry, search,
    search_index::{self, JobSearchQuery},
    user_workspace,
};
use hmac::{Hmac, Mac};
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::Sha256;
use sqlx::{Pool, Postgres, Row};
use std::{
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};
use tower_http::trace::TraceLayer;
use tracing::{info, warn};
use uuid::Uuid;

#[derive(Clone)]
struct AppState {
    pool: Pool<Postgres>,
    jetstream: Option<async_nats::jetstream::Context>,
    internal_secret: Arc<[u8]>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ApiRole {
    User,
    Admin,
}

#[derive(Clone, Copy, Debug)]
struct AuthenticatedUser {
    id: Uuid,
    role: ApiRole,
}

impl FromRequestParts<Arc<AppState>> for AuthenticatedUser {
    type Rejection = ApiError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &Arc<AppState>,
    ) -> Result<Self, Self::Rejection> {
        let header = |name: &str| {
            parts
                .headers
                .get(name)
                .and_then(|value| value.to_str().ok())
        };
        let user_id = header("x-roleatlas-user-id")
            .and_then(|value| Uuid::parse_str(value).ok())
            .ok_or_else(ApiError::unauthorized)?;
        let role_text = header("x-roleatlas-user-role").ok_or_else(ApiError::unauthorized)?;
        let role = match role_text {
            "user" => ApiRole::User,
            "admin" => ApiRole::Admin,
            _ => return Err(ApiError::unauthorized()),
        };
        let timestamp_text =
            header("x-roleatlas-auth-timestamp").ok_or_else(ApiError::unauthorized)?;
        let timestamp = timestamp_text
            .parse::<u64>()
            .map_err(|_| ApiError::unauthorized())?;
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| ApiError::unauthorized())?
            .as_secs();
        if now.abs_diff(timestamp) > 60 {
            return Err(ApiError::unauthorized());
        }
        let signature = header("x-roleatlas-auth-signature")
            .and_then(|value| hex::decode(value).ok())
            .ok_or_else(ApiError::unauthorized)?;
        let path = parts
            .uri
            .path_and_query()
            .map(|value| value.as_str())
            .unwrap_or(parts.uri.path());
        let message = format!(
            "{}\n{}\n{}\n{}\n{}",
            timestamp_text, parts.method, path, user_id, role_text
        );
        let mut mac = Hmac::<Sha256>::new_from_slice(&state.internal_secret)
            .map_err(|_| ApiError::unauthorized())?;
        mac.update(message.as_bytes());
        mac.verify_slice(&signature)
            .map_err(|_| ApiError::unauthorized())?;
        Ok(Self { id: user_id, role })
    }
}

impl AuthenticatedUser {
    fn require_admin(self) -> Result<Self, ApiError> {
        if self.role == ApiRole::Admin {
            Ok(self)
        } else {
            Err(ApiError::forbidden())
        }
    }
}

#[derive(Debug, Deserialize)]
struct RegistryQuery {
    country: Option<String>,
    region: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
struct SearchSessionResultsQuery {
    cursor: Option<i32>,
    limit: Option<i64>,
}

#[derive(Debug, Deserialize)]
struct SeedRequest {
    url: String,
}

#[derive(Debug, Deserialize)]
struct SourceScanRequest {
    source_id: String,
}

#[derive(Debug, Deserialize)]
struct CandidateProfileRequest {
    profile_id: Option<Uuid>,
    plan_id: Option<Uuid>,
    source_file: String,
    profile: Value,
    search_plan: Value,
}

#[derive(Debug, Deserialize)]
struct DailyWorkspaceRequest {
    profile_id: Option<Uuid>,
    state: Value,
    expected_revision: Option<i64>,
}

async fn health(State(state): State<Arc<AppState>>) -> Result<impl IntoResponse, ApiError> {
    sqlx::query("SELECT 1").execute(&state.pool).await?;
    Ok(Json(
        json!({ "status": "ok", "service": "roleatlas-scout", "crawler_queue": if state.jetstream.is_some() { "available" } else { "unavailable" } }),
    ))
}

async fn stats(
    State(state): State<Arc<AppState>>,
    user: AuthenticatedUser,
) -> Result<impl IntoResponse, ApiError> {
    user.require_admin()?;
    let (queued, fetched, failed) = frontier_stats(&state.pool).await?;
    let jobs: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM jobs WHERE is_active = TRUE")
        .fetch_one(&state.pool)
        .await?;
    Ok(Json(
        json!({ "queued": queued, "fetched": fetched, "failed": failed, "jobs": jobs }),
    ))
}

async fn metrics(
    State(state): State<Arc<AppState>>,
    user: AuthenticatedUser,
) -> Result<impl IntoResponse, ApiError> {
    user.require_admin()?;
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

async fn source_health(
    State(state): State<Arc<AppState>>,
    _user: AuthenticatedUser,
) -> Result<impl IntoResponse, ApiError> {
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
    user: AuthenticatedUser,
) -> Result<impl IntoResponse, ApiError> {
    let row = sqlx::query(
        "SELECT p.id profile_id, p.source_file, p.profile, p.updated_at, s.id plan_id, s.plan, s.confirmed_at \
         FROM candidate_profiles p LEFT JOIN search_plans s ON s.profile_id = p.id AND s.user_id = $1 AND s.is_active = TRUE \
         WHERE p.user_id = $1 ORDER BY p.updated_at DESC LIMIT 1",
    ).bind(user.id).fetch_optional(&state.pool).await?;
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
    user: AuthenticatedUser,
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
        "INSERT INTO candidate_profiles (id, user_id, profile, source_file) VALUES ($1,$2,$3,$4) \
         ON CONFLICT (id) DO UPDATE SET profile = EXCLUDED.profile, source_file = EXCLUDED.source_file, updated_at = NOW() \
         WHERE candidate_profiles.user_id = EXCLUDED.user_id",
    ).bind(profile_id).bind(user.id).bind(&request.profile).bind(&request.source_file).execute(&mut *tx).await?;
    let owns_profile: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM candidate_profiles WHERE id = $1 AND user_id = $2)",
    )
    .bind(profile_id)
    .bind(user.id)
    .fetch_one(&mut *tx)
    .await?;
    if !owns_profile {
        return Err(ApiError::not_found());
    }
    sqlx::query("UPDATE search_plans SET is_active = FALSE, updated_at = NOW() WHERE profile_id = $1 AND user_id = $2 AND id <> $3")
        .bind(profile_id).bind(user.id).bind(plan_id).execute(&mut *tx).await?;
    sqlx::query(
        "INSERT INTO search_plans (id, user_id, profile_id, plan, confirmed_at) VALUES ($1,$2,$3,$4,CASE WHEN $5 THEN NOW() ELSE NULL END) \
         ON CONFLICT (id) DO UPDATE SET plan = EXCLUDED.plan, confirmed_at = EXCLUDED.confirmed_at, is_active = TRUE, updated_at = NOW() \
         WHERE search_plans.user_id = EXCLUDED.user_id AND search_plans.profile_id = EXCLUDED.profile_id",
    ).bind(plan_id).bind(user.id).bind(profile_id).bind(&request.search_plan).bind(confirmed).execute(&mut *tx).await?;
    let owns_plan: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM search_plans WHERE id = $1 AND user_id = $2 AND profile_id = $3)")
        .bind(plan_id).bind(user.id).bind(profile_id).fetch_one(&mut *tx).await?;
    if !owns_plan {
        return Err(ApiError::not_found());
    }
    tx.commit().await?;
    Ok(Json(
        json!({ "profile_id": profile_id, "plan_id": plan_id, "saved": true }),
    ))
}

async fn get_daily_workspace(
    State(state): State<Arc<AppState>>,
    user: AuthenticatedUser,
) -> Result<impl IntoResponse, ApiError> {
    let Some((workspace, revision, profile_id, created_at, updated_at)) =
        user_workspace::load(&state.pool, user.id).await?
    else {
        return Ok(Json(json!({ "workspace": null, "revision": 0 })));
    };
    Ok(Json(json!({
        "workspace": workspace,
        "profile_id": profile_id,
        "revision": revision,
        "created_at": created_at,
        "updated_at": updated_at
    })))
}

async fn save_daily_workspace(
    State(state): State<Arc<AppState>>,
    user: AuthenticatedUser,
    Json(request): Json<DailyWorkspaceRequest>,
) -> Result<impl IntoResponse, ApiError> {
    if !request.state.is_object() {
        return Err(ApiError::bad_request("workspace state must be an object"));
    }
    let serialized = serde_json::to_vec(&request.state)?;
    if serialized.len() > 2_000_000 {
        return Err(ApiError::bad_request("workspace state exceeds 2 MB"));
    }
    if let Some(profile_id) = request.profile_id {
        let owns_profile: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM candidate_profiles WHERE id = $1 AND user_id = $2)",
        )
        .bind(profile_id)
        .bind(user.id)
        .fetch_one(&state.pool)
        .await?;
        if !owns_profile {
            return Err(ApiError::not_found());
        }
    }
    match user_workspace::save(
        &state.pool,
        user.id,
        request.profile_id,
        request.state,
        request.expected_revision,
    )
    .await?
    {
        user_workspace::SaveOutcome::Saved {
            revision,
            updated_at,
        } => Ok(Json(json!({
            "saved": true,
            "revision": revision,
            "updated_at": updated_at
        }))),
        user_workspace::SaveOutcome::Conflict { current_revision } => {
            Err(ApiError::conflict(format!(
                "Workspace changed in another session. Current revision is {current_revision}."
            )))
        }
    }
}

async fn create_search_session(
    State(state): State<Arc<AppState>>,
    user: AuthenticatedUser,
    Json(request): Json<Value>,
) -> Result<impl IntoResponse, ApiError> {
    let initial = search::execute(&state.pool, user.id, request).await?;
    let session_id = initial["session"]["id"]
        .as_str()
        .and_then(|value| Uuid::parse_str(value).ok())
        .ok_or_else(|| ApiError::internal("search session id missing".into()))?;
    orchestration::select_sources(&state.pool, session_id).await?;
    orchestration::queue_selected_sources(&state.pool, state.jetstream.as_ref(), session_id)
        .await?;
    Ok(Json(search::get(&state.pool, user.id, session_id).await?))
}

async fn list_search_sessions(
    State(state): State<Arc<AppState>>,
    user: AuthenticatedUser,
) -> Result<impl IntoResponse, ApiError> {
    Ok(Json(search::list(&state.pool, user.id).await?))
}

async fn get_search_session(
    State(state): State<Arc<AppState>>,
    user: AuthenticatedUser,
    Path(id): Path<Uuid>,
    Query(query): Query<SearchSessionResultsQuery>,
) -> Result<impl IntoResponse, ApiError> {
    if query.cursor.is_some_and(|cursor| cursor < 0) {
        return Err(ApiError::bad_request("cursor must be non-negative"));
    }
    if !search::is_owned(&state.pool, user.id, id).await? {
        return Err(ApiError::not_found());
    }
    orchestration::refresh_session(&state.pool, id).await?;
    Ok(Json(
        search::get_page(
            &state.pool,
            user.id,
            id,
            query.cursor,
            query.limit.unwrap_or(100),
        )
        .await?,
    ))
}

async fn rerun_search_session(
    State(state): State<Arc<AppState>>,
    user: AuthenticatedUser,
    Path(id): Path<Uuid>,
) -> Result<impl IntoResponse, ApiError> {
    if !search::is_owned(&state.pool, user.id, id).await? {
        return Err(ApiError::not_found());
    }
    let result = search::rerun(&state.pool, user.id, id).await?;
    orchestration::select_sources(&state.pool, id).await?;
    orchestration::queue_selected_sources(&state.pool, state.jetstream.as_ref(), id).await?;
    let _ = result;
    Ok(Json(search::get(&state.pool, user.id, id).await?))
}

async fn save_search_feedback(
    State(state): State<Arc<AppState>>,
    user: AuthenticatedUser,
    Json(request): Json<Value>,
) -> Result<impl IntoResponse, ApiError> {
    let session_id = request
        .get("session_id")
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok())
        .ok_or_else(|| ApiError::bad_request("invalid session_id"))?;
    if !search::is_owned(&state.pool, user.id, session_id).await? {
        return Err(ApiError::not_found());
    }
    Ok(Json(search::feedback(&state.pool, user.id, request).await?))
}

async fn list_jobs(
    State(state): State<Arc<AppState>>,
    Query(query): Query<JobSearchQuery>,
) -> Result<impl IntoResponse, ApiError> {
    let validated =
        search_index::validate_query(query).map_err(|message| ApiError::bad_request(&message))?;
    let query_text = validated.query().map(ToOwned::to_owned);
    let location = validated.location().map(ToOwned::to_owned);
    let page = search_index::search(&state.pool, &validated).await?;
    let registry_source_ids = registry::enabled_sources()
        .map(|source| source.id.clone())
        .collect::<Vec<_>>();
    let coverage = sqlx::query(
        "SELECT COUNT(*) total_sources, COUNT(*) FILTER (WHERE last_success_at IS NOT NULL) successful_sources, \
         MAX(last_success_at) freshest_success FROM sources WHERE enabled = TRUE AND id = ANY($1)",
    )
    .bind(&registry_source_ids)
    .fetch_one(&state.pool)
    .await?;
    Ok(Json(
        json!({ "jobs": page.jobs, "count": page.count, "returned": page.returned,
        "has_more": page.has_more, "next_cursor": page.next_cursor, "limit": page.limit, "coverage": {
        "sources_searched": coverage.get::<i64,_>("total_sources"), "sources_successful": coverage.get::<i64,_>("successful_sources"),
        "freshest_success": coverage.get::<Option<DateTime<Utc>>,_>("freshest_success"), "query": query_text, "location": location,
        "complete": coverage.get::<i64,_>("total_sources") > 0 && coverage.get::<i64,_>("total_sources") == coverage.get::<i64,_>("successful_sources")
    } }),
    ))
}

async fn get_job(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> Result<impl IntoResponse, ApiError> {
    let job = search_index::get_job(&state.pool, id)
        .await?
        .ok_or_else(ApiError::not_found)?;
    Ok(Json(json!({ "job": job })))
}

async fn add_seed(
    State(state): State<Arc<AppState>>,
    user: AuthenticatedUser,
    Json(request): Json<SeedRequest>,
) -> Result<impl IntoResponse, ApiError> {
    user.require_admin()?;
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

async fn request_source_scan(
    State(state): State<Arc<AppState>>,
    user: AuthenticatedUser,
    headers: HeaderMap,
    Json(request): Json<SourceScanRequest>,
) -> Result<impl IntoResponse, ApiError> {
    let source =
        registry::enabled_source_by_id(&request.source_id).ok_or_else(ApiError::not_found)?;
    let database_enabled: Option<bool> =
        sqlx::query_scalar("SELECT enabled FROM sources WHERE id = $1")
            .bind(&source.id)
            .fetch_optional(&state.pool)
            .await?;
    if database_enabled == Some(false) {
        return Err(ApiError::forbidden());
    }

    let idempotency_key = headers
        .get("idempotency-key")
        .and_then(|value| value.to_str().ok())
        .filter(|value| {
            (8..=200).contains(&value.len()) && value.bytes().all(|byte| byte.is_ascii_graphic())
        })
        .ok_or_else(|| ApiError::bad_request("a valid idempotency key is required"))?;
    let run_id = Uuid::new_v5(
        &Uuid::NAMESPACE_URL,
        format!(
            "roleatlas:approved-source-scan:{}:{}:{}",
            user.id, source.id, idempotency_key
        )
        .as_bytes(),
    );
    let existing_status: Option<String> =
        sqlx::query_scalar("SELECT status FROM source_runs WHERE id = $1")
            .bind(run_id)
            .fetch_optional(&state.pool)
            .await?;
    if let Some(status) = existing_status.as_deref() {
        if status != "running" {
            return Ok((
                StatusCode::ACCEPTED,
                Json(json!({
                    "requestId": run_id,
                    "sourceId": source.id,
                    "status": status,
                    "reused": true
                })),
            ));
        }
    }

    let jetstream = state.jetstream.as_ref().ok_or_else(|| {
        ApiError::service_unavailable(
            "Crawler queue is unavailable. Existing indexed jobs and search remain available.",
        )
    })?;
    let _ = enqueue_seed_for_recrawl(&state.pool, &source.endpoint_url, 0).await?;
    let task = begin_source_run_with_id(&state.pool, &source.endpoint_url, run_id).await?;
    let mut message_headers = async_nats::HeaderMap::new();
    message_headers.append("Nats-Msg-Id", run_id.to_string());
    let publish = jetstream
        .publish_with_headers(
            PENDING_SUBJECT,
            message_headers,
            serde_json::to_vec(&task)?.into(),
        )
        .await
        .map_err(|error| ApiError::internal(error.to_string()))?;
    if let Err(error) = publish.await {
        if existing_status.is_none() {
            sqlx::query(
                "UPDATE source_runs SET status = 'failed', completed_at = NOW(), error = $2 WHERE id = $1",
            )
            .bind(run_id)
            .bind("Crawler queue did not acknowledge the approved source scan.")
            .execute(&state.pool)
            .await?;
        }
        return Err(ApiError::internal(error.to_string()));
    }
    Ok((
        StatusCode::ACCEPTED,
        Json(json!({
            "requestId": run_id,
            "sourceId": source.id,
            "status": "queued",
            "reused": existing_status.is_some()
        })),
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
        warn!(error = %message, "scout API request failed");
        Self {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            message: "The request could not be completed.".into(),
        }
    }
    fn unauthorized() -> Self {
        Self {
            status: StatusCode::UNAUTHORIZED,
            message: "Authentication is required.".into(),
        }
    }
    fn forbidden() -> Self {
        Self {
            status: StatusCode::FORBIDDEN,
            message: "This action is not permitted.".into(),
        }
    }
    fn not_found() -> Self {
        Self {
            status: StatusCode::NOT_FOUND,
            message: "The requested resource was not found.".into(),
        }
    }
    fn conflict(message: String) -> Self {
        Self {
            status: StatusCode::CONFLICT,
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
    let internal_secret =
        std::env::var("SCOUT_INTERNAL_SECRET").context("SCOUT_INTERNAL_SECRET is required")?;
    anyhow::ensure!(
        internal_secret.len() >= 32,
        "SCOUT_INTERNAL_SECRET must contain at least 32 bytes"
    );
    let state = Arc::new(AppState {
        pool,
        jetstream,
        internal_secret: Arc::from(internal_secret.into_bytes()),
    });

    let app = Router::new()
        .route("/health", get(health))
        .route("/api/jobs", get(list_jobs))
        .route("/api/jobs/{id}", get(get_job))
        .route("/api/stats", get(stats))
        .route("/api/metrics", get(metrics))
        .route("/api/source-health", get(source_health))
        .route("/api/registry", get(registry_stats))
        .route(
            "/api/candidate-profile",
            get(get_candidate_profile).post(save_candidate_profile),
        )
        .route(
            "/api/workspace",
            get(get_daily_workspace).put(save_daily_workspace),
        )
        .route(
            "/api/search-sessions",
            get(list_search_sessions).post(create_search_session),
        )
        .route("/api/search-sessions/{id}", get(get_search_session))
        .route(
            "/api/search-sessions/{id}/rerun",
            post(rerun_search_session),
        )
        .route("/api/search-feedback", post(save_search_feedback))
        .route("/api/source-scans", post(request_source_scan))
        .route("/api/seeds", post(add_seed))
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    // Deployment-configurable so host port collisions never require a rebuild.
    let port: u16 = std::env::var("SCOUT_API_PORT")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(8080);
    let address = format!("0.0.0.0:{port}");
    let listener = tokio::net::TcpListener::bind(&address).await?;
    info!(address, "scout API ready");
    axum::serve(listener, app).await?;
    Ok(())
}
