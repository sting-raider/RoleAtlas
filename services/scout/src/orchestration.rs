use crate::{PENDING_SUBJECT, eligibility::CandidateMobility, geography, registry};
use anyhow::{Context, Result};
use chrono::{Duration, Utc};
use serde_json::{Map, Value, json};
use sqlx::{Pool, Postgres, Row};
use std::collections::BTreeSet;
use uuid::Uuid;

const FRESH_FOR_HOURS: i64 = 6;
const MAX_SELECTED_SOURCES: usize = 12;

#[derive(Debug, Clone, PartialEq, Eq)]
struct SelectionContext {
    countries: Vec<String>,
    regions: Vec<String>,
    early_career: bool,
    remote: bool,
}

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

fn selection_context(plan: &Value) -> SelectionContext {
    let mobility = plan
        .get("mobility")
        .and_then(|value| serde_json::from_value::<CandidateMobility>(value.clone()).ok())
        .unwrap_or_default();
    let mut countries = mobility
        .preferred_country_codes
        .into_iter()
        .map(|code| code.to_uppercase())
        .collect::<BTreeSet<_>>();
    let mut regions = BTreeSet::new();
    for location in strings(plan, "locations") {
        let normalized = geography::normalize_location(&location);
        if let Some(country) = normalized.country_code {
            countries.insert(country);
        } else {
            regions.extend(normalized.region_codes);
        }
    }
    if countries.is_empty() && regions.is_empty() {
        countries.extend(
            mobility
                .residence_country_code
                .map(|code| code.to_uppercase()),
        );
    }
    let job_types = strings(plan, "jobTypes")
        .into_iter()
        .map(|value| value.to_lowercase())
        .collect::<Vec<_>>();
    let work_modes = strings(plan, "workModes")
        .into_iter()
        .map(|value| value.to_lowercase())
        .collect::<Vec<_>>();
    SelectionContext {
        countries: countries.into_iter().collect(),
        regions: regions.into_iter().collect(),
        early_career: job_types.iter().any(|value| {
            [
                "internship",
                "entry-level",
                "apprenticeship",
                "graduate",
                "fellowship",
                "trainee",
                "working student",
            ]
            .contains(&value.as_str())
        }),
        remote: work_modes.iter().any(|value| value == "remote"),
    }
}

fn ranked_sources(plan: &Value) -> Vec<(&'static registry::RegistrySource, Value)> {
    let context = selection_context(plan);
    let mut candidates = registry::enabled_sources()
        .filter(|source| registry::supports_geography(source, &context.countries, &context.regions))
        .map(|source| {
            let geography_score = if context.countries.is_empty() && context.regions.is_empty() {
                0
            } else {
                100
            };
            let early_score = if context.early_career {
                source.opportunity_history.observed_count.min(20) as i32 * 3
            } else {
                0
            };
            let remote_score = if context.remote {
                source.remote_history.observed_count.min(50) as i32
            } else {
                0
            };
            let score = geography_score + early_score + remote_score;
            (
                source,
                score,
                json!({
                    "countryCodes": context.countries,
                    "regionCodes": context.regions,
                    "geographyMatched": geography_score > 0,
                    "earlyCareerRequested": context.early_career,
                    "earlyCareerListingsObserved": source.opportunity_history.observed_count,
                    "remoteRequested": context.remote,
                    "remoteListingsObserved": source.remote_history.observed_count,
                    "selectionScore": score,
                    "registryVerification": source.verification.method,
                    "registryLastVerified": source.last_verified
                }),
            )
        })
        .collect::<Vec<_>>();
    candidates.sort_by(|left, right| {
        right
            .1
            .cmp(&left.1)
            .then_with(|| left.0.id.cmp(&right.0.id))
    });
    candidates
        .into_iter()
        .take(MAX_SELECTED_SOURCES)
        .map(|(source, _, reason)| (source, reason))
        .collect()
}

pub async fn select_sources(pool: &Pool<Postgres>, session_id: Uuid) -> Result<usize> {
    let plan: Value = sqlx::query_scalar("SELECT plan_snapshot FROM search_sessions WHERE id = $1")
        .bind(session_id)
        .fetch_one(pool)
        .await?;
    let selected = ranked_sources(&plan);
    let fresh_after = Utc::now() - Duration::hours(FRESH_FOR_HOURS);
    let mut transaction = pool.begin().await?;
    sqlx::query("DELETE FROM search_session_sources WHERE session_id = $1")
        .bind(session_id)
        .execute(&mut *transaction)
        .await?;
    for (source, reason) in &selected {
        let health = sqlx::query(
            "SELECT s.last_success_at, r.id run_id, r.status run_status FROM sources s \
             LEFT JOIN LATERAL (SELECT id, status FROM source_runs WHERE source_id = s.id ORDER BY started_at DESC LIMIT 1) r ON TRUE \
             WHERE s.id = $1",
        )
        .bind(&source.id)
        .fetch_optional(&mut *transaction)
        .await?;
        let (state, run_id) = health.map_or(("unscanned", None), |row| {
            let last_success = row.get::<Option<chrono::DateTime<Utc>>, _>("last_success_at");
            let run_id = row.get::<Option<Uuid>, _>("run_id");
            let run_status = row.get::<Option<String>, _>("run_status");
            if run_status.as_deref() == Some("running") {
                ("scanning", run_id)
            } else if last_success.is_some_and(|timestamp| timestamp >= fresh_after) {
                ("fresh", None)
            } else if last_success.is_some() {
                ("stale", None)
            } else {
                ("unscanned", None)
            }
        });
        sqlx::query(
            "INSERT INTO search_session_sources (session_id, source_id, endpoint_url, state, selected_reason, source_run_id) VALUES ($1,$2,$3,$4,$5,$6)",
        )
        .bind(session_id)
        .bind(&source.id)
        .bind(&source.endpoint_url)
        .bind(state)
        .bind(reason)
        .bind(run_id)
        .execute(&mut *transaction)
        .await?;
    }
    transaction.commit().await?;
    refresh_session(pool, session_id).await?;
    Ok(selected.len())
}

pub async fn queue_selected_sources(
    pool: &Pool<Postgres>,
    jetstream: Option<&async_nats::jetstream::Context>,
    session_id: Uuid,
) -> Result<()> {
    let rows = sqlx::query(
        "SELECT source_id, endpoint_url, state FROM search_session_sources WHERE session_id = $1 AND state IN ('stale','unscanned') ORDER BY source_id",
    )
    .bind(session_id)
    .fetch_all(pool)
    .await?;
    let Some(jetstream) = jetstream else {
        sqlx::query(
            "UPDATE search_session_sources SET state = 'deferred', error = 'Crawler queue unavailable; indexed results remain available.' WHERE session_id = $1 AND state IN ('stale','unscanned')",
        )
        .bind(session_id)
        .execute(pool)
        .await?;
        refresh_session(pool, session_id).await?;
        return Ok(());
    };

    for row in rows {
        let source_id: String = row.get("source_id");
        let endpoint_url: String = row.get("endpoint_url");
        // The URL came from the compiled, validated registry. Runtime source
        // expansion never accepts a model-proposed URL into this path.
        let _ = crate::frontier::enqueue_seed_for_recrawl(pool, &endpoint_url, 0).await?;
        let task = crate::frontier::begin_source_run(pool, &endpoint_url).await?;
        let run_id = task
            .run_id
            .context("source crawl task did not create a run")?;
        let published = async {
            jetstream
                .publish(PENDING_SUBJECT, serde_json::to_vec(&task)?.into())
                .await?
                .await?;
            Ok::<_, anyhow::Error>(())
        }
        .await;
        match published {
            Ok(()) => {
                sqlx::query(
                    "UPDATE search_session_sources SET state = 'queued', queued_at = NOW(), source_run_id = $3, error = NULL WHERE session_id = $1 AND source_id = $2",
                )
                .bind(session_id)
                .bind(&source_id)
                .bind(run_id)
                .execute(pool)
                .await?;
            }
            Err(error) => {
                let message = format!("Crawler queue unavailable: {error}");
                sqlx::query(
                    "UPDATE source_runs SET status = 'failed', completed_at = NOW(), error = $2 WHERE id = $1",
                )
                .bind(run_id)
                .bind(&message)
                .execute(pool)
                .await?;
                sqlx::query(
                    "UPDATE search_session_sources SET state = 'deferred', source_run_id = $3, error = $4 WHERE session_id = $1 AND source_id = $2",
                )
                .bind(session_id)
                .bind(&source_id)
                .bind(run_id)
                .bind(message)
                .execute(pool)
                .await?;
            }
        }
    }
    refresh_session(pool, session_id).await?;
    Ok(())
}

pub async fn refresh_session(pool: &Pool<Postgres>, session_id: Uuid) -> Result<()> {
    sqlx::query(
        "UPDATE search_session_sources ss SET \
         state = CASE r.status WHEN 'running' THEN 'scanning' WHEN 'success' THEN 'success' WHEN 'partial' THEN 'failed' WHEN 'failed' THEN 'failed' ELSE ss.state END, \
         completed_at = CASE WHEN r.status IN ('success','partial','failed') THEN r.completed_at ELSE ss.completed_at END, \
         observed_jobs = r.observed_jobs, error = COALESCE(r.error, CASE WHEN r.status = 'partial' THEN 'Source scan was incomplete.' ELSE ss.error END) \
         FROM source_runs r WHERE ss.session_id = $1 AND ss.source_run_id = r.id",
    )
    .bind(session_id)
    .execute(pool)
    .await?;
    let rows = sqlx::query(
        "SELECT state, COUNT(*) count, COALESCE(SUM(observed_jobs), 0) observed_jobs FROM search_session_sources WHERE session_id = $1 GROUP BY state",
    )
    .bind(session_id)
    .fetch_all(pool)
    .await?;
    let mut counts = Map::new();
    let mut observed_jobs = 0i64;
    let mut selected = 0i64;
    for row in rows {
        let state: String = row.get("state");
        let count: i64 = row.get("count");
        selected += count;
        observed_jobs += row.get::<i64, _>("observed_jobs");
        counts.insert(state, json!(count));
    }
    let count = |state: &str| counts.get(state).and_then(Value::as_i64).unwrap_or(0);
    let active = count("queued") + count("scanning");
    let gaps = count("stale") + count("unscanned");
    let incomplete = count("failed") + count("deferred") + gaps + i64::from(selected == 0);
    let stage = if active > 0 {
        "scanning_sources"
    } else if gaps > 0 {
        "identifying_source_gaps"
    } else if incomplete > 0 {
        "partial"
    } else {
        "completed"
    };
    let existing: Value = sqlx::query_scalar("SELECT coverage FROM search_sessions WHERE id = $1")
        .bind(session_id)
        .fetch_one(pool)
        .await?;
    let mut coverage = existing.as_object().cloned().unwrap_or_default();
    coverage.insert(
        "source_selection".into(),
        json!({
            "selected_sources": selected,
            "states": counts,
            "observed_jobs_in_completed_runs": observed_jobs,
            "freshness_hours": FRESH_FOR_HOURS,
            "selection_limit": MAX_SELECTED_SOURCES,
            "claim": "Coverage includes only selected registry sources that were successfully checked; it is not full market coverage."
        }),
    );
    coverage.insert(
        "configured_sources".into(),
        json!(registry::enabled_sources().count()),
    );
    coverage.insert("selected_sources".into(), json!(selected));
    coverage.insert(
        "successful_sources".into(),
        json!(count("fresh") + count("success")),
    );
    coverage.insert("incomplete_sources".into(), json!(incomplete + active));
    coverage.insert(
        "state".into(),
        json!(if active > 0 {
            "expanding"
        } else if incomplete > 0 {
            "partial"
        } else {
            "checked"
        }),
    );
    sqlx::query(
        "UPDATE search_sessions SET stage = $2, coverage = $3, updated_at = NOW() WHERE id = $1",
    )
    .bind(session_id)
    .bind(stage)
    .bind(Value::Object(coverage))
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn sessions_for_completed_run(pool: &Pool<Postgres>, run_id: Uuid) -> Result<Vec<Uuid>> {
    let sessions = sqlx::query_scalar::<_, Uuid>(
        "SELECT session_id FROM search_session_sources WHERE source_run_id = $1",
    )
    .bind(run_id)
    .fetch_all(pool)
    .await?;
    for session_id in &sessions {
        refresh_session(pool, *session_id).await?;
    }
    Ok(sessions)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn selects_registry_sources_from_global_plan_without_country_special_cases() {
        let india = ranked_sources(&json!({
            "locations": ["India"], "jobTypes": ["Internship"], "workModes": []
        }));
        assert!(
            india
                .iter()
                .any(|(source, _)| source.id == "greenhouse:groww")
        );
        assert!(india.iter().all(|(source, _)| registry::supports_geography(
            source,
            &["IN".into()],
            &[]
        )));

        let latam = ranked_sources(&json!({
            "locations": ["LATAM"], "jobTypes": [], "workModes": ["Remote"]
        }));
        assert!(!latam.is_empty());
        assert!(latam.iter().all(|(source, _)| registry::supports_geography(
            source,
            &[],
            &["LATAM".into()]
        )));
    }

    #[test]
    fn early_career_and_remote_evidence_affect_order_but_not_trust() {
        let selected = ranked_sources(&json!({
            "locations": ["APAC"], "jobTypes": ["Internship"], "workModes": ["Remote"]
        }));
        assert!(selected.len() <= MAX_SELECTED_SOURCES);
        assert!(
            selected
                .iter()
                .all(|(source, _)| source.status == "verified")
        );
        let first_score = selected[0].1["selectionScore"].as_i64().unwrap();
        let last_score = selected.last().unwrap().1["selectionScore"]
            .as_i64()
            .unwrap();
        assert!(first_score >= last_score);
    }
}
