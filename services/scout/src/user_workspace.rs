use anyhow::{Context, Result};
use chrono::{DateTime, NaiveDate, Utc};
use serde_json::{Map, Value, json};
use sqlx::{Pool, Postgres, Row, Transaction};
use uuid::Uuid;

#[derive(Debug)]
pub enum SaveOutcome {
    Saved {
        revision: i64,
        updated_at: DateTime<Utc>,
    },
    Conflict {
        current_revision: i64,
    },
}

fn array(value: Option<&Value>) -> &[Value] {
    value
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[])
}

fn text<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    value
        .get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
}

fn timestamp(value: Option<&str>) -> Option<DateTime<Utc>> {
    value
        .and_then(|value| DateTime::parse_from_rfc3339(value).ok())
        .map(|value| value.with_timezone(&Utc))
}

async fn canonical_job_id(
    tx: &mut Transaction<'_, Postgres>,
    job_ref: &str,
) -> Result<Option<Uuid>> {
    Ok(
        sqlx::query_scalar("SELECT id FROM jobs WHERE id::text = $1")
            .bind(job_ref)
            .fetch_optional(&mut **tx)
            .await?,
    )
}

async fn owned_session_id(
    tx: &mut Transaction<'_, Postgres>,
    user_id: Uuid,
    value: Option<&str>,
) -> Result<Option<Uuid>> {
    let Some(id) = value.and_then(|value| Uuid::parse_str(value).ok()) else {
        return Ok(None);
    };
    Ok(
        sqlx::query_scalar("SELECT id FROM search_sessions WHERE id = $1 AND user_id = $2")
            .bind(id)
            .bind(user_id)
            .fetch_optional(&mut **tx)
            .await?,
    )
}

/// Sync only the collections this endpoint owns: search strategies (with
/// revisions), free-form job feedback, and the recent-view trail. Saved jobs,
/// applications, and notifications moved to the dedicated entity writers in
/// [`crate::entity_writes`] because deleting and re-inserting them here gave
/// applications fresh UUIDs on every save — cascading generated artifacts
/// away — and let one tab's stale snapshot clobber another tab's writes.
async fn sync_entities(
    tx: &mut Transaction<'_, Postgres>,
    user_id: Uuid,
    state: &Value,
) -> Result<()> {
    for table in [
        "search_strategies",
        "user_job_feedback",
        "recently_viewed_jobs",
    ] {
        sqlx::query(&format!("DELETE FROM {table} WHERE user_id = $1"))
            .bind(user_id)
            .execute(&mut **tx)
            .await?;
    }

    for strategy in array(state.get("strategies")) {
        let Some(strategy_id) = text(strategy, "id") else {
            continue;
        };
        if strategy_id.len() > 512 {
            continue;
        }
        let name = text(strategy, "name").unwrap_or("My search");
        // The database CHECK constraint is the authority; an unknown status
        // simply falls back to the default here.
        #[allow(clippy::manual_unwrap_or)] // enum-guarded fallback, not a plain default
        let status = match text(strategy, "status") {
            Some(value @ ("draft" | "active" | "paused" | "archived")) => value,
            _ => "draft",
        };

        let active_revision_id = text(strategy, "activeRevisionId").unwrap_or("legacy");
        let profile_id = text(strategy, "profileId").and_then(|value| Uuid::parse_str(value).ok());
        let owned_profile_id: Option<Uuid> = if let Some(profile_id) = profile_id {
            sqlx::query_scalar("SELECT id FROM candidate_profiles WHERE id = $1 AND user_id = $2")
                .bind(profile_id)
                .bind(user_id)
                .fetch_optional(&mut **tx)
                .await?
        } else {
            None
        };
        let last_session_id =
            owned_session_id(tx, user_id, text(strategy, "lastSessionId")).await?;
        sqlx::query(
            "INSERT INTO search_strategies (user_id,id,profile_id,name,status,active_revision_id,last_run_at,last_session_id,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
        )
        .bind(user_id)
        .bind(strategy_id)
        .bind(owned_profile_id)
        .bind(name)
        .bind(status)
        .bind(active_revision_id)
        .bind(timestamp(text(strategy, "lastRunAt")))
        .bind(last_session_id)
        .bind(timestamp(text(strategy, "createdAt")).unwrap_or_else(Utc::now))
        .bind(timestamp(text(strategy, "updatedAt")).unwrap_or_else(Utc::now))
        .execute(&mut **tx)
        .await?;

        for revision in array(strategy.get("revisions")) {
            let Some(revision_id) = text(revision, "id") else {
                continue;
            };
            let version = revision
                .get("version")
                .and_then(Value::as_i64)
                .unwrap_or(1)
                .clamp(1, i64::from(i32::MAX)) as i32;
            // The database CHECK constraint is the authority; an unknown
            // reason simply falls back to the default here.
            #[allow(clippy::manual_unwrap_or)] // enum-guarded fallback, not a plain default
            let reason = match text(revision, "reason") {
                Some(value @ ("created" | "edited" | "regenerated" | "duplicated")) => value,
                _ => "created",
            };
            let plan = revision
                .get("plan")
                .filter(|value| value.is_object())
                .cloned()
                .unwrap_or_else(|| json!({}));
            sqlx::query(
                "INSERT INTO search_strategy_revisions (user_id,strategy_id,id,version,reason,plan,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)",
            )
            .bind(user_id)
            .bind(strategy_id)
            .bind(revision_id)
            .bind(version)
            .bind(reason)
            .bind(plan)
            .bind(timestamp(text(revision, "createdAt")).unwrap_or_else(Utc::now))
            .execute(&mut **tx)
            .await?;
        }
    }

    for feedback in array(state.get("feedback")) {
        let (Some(id), Some(job_ref), Some(reason)) = (
            text(feedback, "id"),
            text(feedback, "jobId"),
            text(feedback, "reason"),
        ) else {
            continue;
        };
        if job_ref.len() > 512
            || !matches!(
                reason,
                "relevant"
                    | "not_relevant"
                    | "wrong_role"
                    | "wrong_seniority"
                    | "wrong_location"
                    | "not_eligible"
                    | "compensation_too_low"
                    | "not_interested_in_company"
                    | "duplicate"
                    | "already_applied"
                    | "closed"
                    | "show_fewer_like_this"
            )
        {
            continue;
        }
        let canonical_id = canonical_job_id(tx, job_ref).await?;
        let session_id = owned_session_id(tx, user_id, text(feedback, "sessionId")).await?;
        sqlx::query(
            "INSERT INTO user_job_feedback (user_id,id,job_ref,canonical_job_id,session_id,reason,suggested_strategy_change,created_at,undone_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        )
        .bind(user_id).bind(id).bind(job_ref).bind(canonical_id).bind(session_id).bind(reason)
        .bind(text(feedback, "suggestedStrategyChange"))
        .bind(timestamp(text(feedback, "createdAt")).unwrap_or_else(Utc::now))
        .bind(timestamp(text(feedback, "undoneAt")))
        .execute(&mut **tx).await?;
    }

    for recent in array(state.get("recentViews")) {
        let Some(job_ref) = text(recent, "jobId") else {
            continue;
        };
        if job_ref.len() > 512 {
            continue;
        }
        let canonical_id = canonical_job_id(tx, job_ref).await?;
        sqlx::query("INSERT INTO recently_viewed_jobs (user_id,job_ref,canonical_job_id,viewed_at) VALUES ($1,$2,$3,$4)")
            .bind(user_id).bind(job_ref).bind(canonical_id)
            .bind(timestamp(text(recent, "viewedAt")).unwrap_or_else(Utc::now))
            .execute(&mut **tx).await?;
    }
    Ok(())
}

pub async fn save(
    pool: &Pool<Postgres>,
    user_id: Uuid,
    profile_id: Option<Uuid>,
    state: Value,
    expected_revision: Option<i64>,
) -> Result<SaveOutcome> {
    let mut tx = pool.begin().await?;
    let current_revision: Option<i64> = sqlx::query_scalar(
        "SELECT revision FROM daily_workspaces WHERE user_id = $1 AND workspace_key = 'local' FOR UPDATE",
    )
    .bind(user_id)
    .fetch_optional(&mut *tx)
    .await?;
    let current_revision = current_revision.unwrap_or(0);
    if expected_revision.is_some_and(|expected| expected != current_revision) {
        tx.rollback().await?;
        return Ok(SaveOutcome::Conflict { current_revision });
    }

    sync_entities(&mut tx, user_id, &state).await?;
    let row = sqlx::query(
        "INSERT INTO daily_workspaces (user_id,workspace_key,profile_id,state,revision) VALUES ($1,'local',$2,$3,1) \
         ON CONFLICT (user_id,workspace_key) DO UPDATE SET profile_id=EXCLUDED.profile_id,state=EXCLUDED.state,revision=daily_workspaces.revision+1,updated_at=NOW() \
         RETURNING revision,updated_at",
    )
    .bind(user_id)
    .bind(profile_id)
    .bind(state)
    .fetch_one(&mut *tx)
    .await?;
    let revision = row.get::<i64, _>("revision");
    let updated_at = row.get::<DateTime<Utc>, _>("updated_at");
    tx.commit().await?;
    Ok(SaveOutcome::Saved {
        revision,
        updated_at,
    })
}

pub async fn load(
    pool: &Pool<Postgres>,
    user_id: Uuid,
) -> Result<Option<(Value, i64, Option<Uuid>, DateTime<Utc>, DateTime<Utc>)>> {
    let row = sqlx::query(
        "SELECT profile_id,state,revision,created_at,updated_at FROM daily_workspaces WHERE user_id=$1 AND workspace_key='local'",
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await?;
    let Some(row) = row else { return Ok(None) };
    let mut state = row.get::<Value, _>("state");
    let root = state
        .as_object_mut()
        .context("persisted workspace state is not an object")?;

    let saved_rows = sqlx::query(
        "SELECT job_ref,saved_at,snapshot FROM saved_jobs WHERE user_id=$1 ORDER BY saved_at DESC",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?;
    let mut saved = Map::new();
    for row in saved_rows {
        let job_ref = row.get::<String, _>("job_ref");
        saved.insert(job_ref.clone(), json!({ "jobId": job_ref, "savedAt": row.get::<DateTime<Utc>,_>("saved_at").to_rfc3339(), "snapshot": row.get::<Value,_>("snapshot") }));
    }
    root.insert("savedJobs".into(), Value::Object(saved));

    let strategy_rows = sqlx::query("SELECT id,profile_id,name,status,active_revision_id,last_run_at,last_session_id,created_at,updated_at FROM search_strategies WHERE user_id=$1 ORDER BY updated_at DESC")
        .bind(user_id).fetch_all(pool).await?;
    let mut strategies = Vec::new();
    for row in strategy_rows {
        let strategy_id = row.get::<String, _>("id");
        let revisions = sqlx::query("SELECT id,version,reason,plan,created_at FROM search_strategy_revisions WHERE user_id=$1 AND strategy_id=$2 ORDER BY version")
            .bind(user_id).bind(&strategy_id).fetch_all(pool).await?
            .into_iter().map(|revision| json!({ "id": revision.get::<String,_>("id"), "version": revision.get::<i32,_>("version"), "reason": revision.get::<String,_>("reason"), "plan": revision.get::<Value,_>("plan"), "createdAt": revision.get::<DateTime<Utc>,_>("created_at").to_rfc3339() })).collect::<Vec<_>>();
        strategies.push(json!({
            "id": strategy_id, "name": row.get::<String,_>("name"), "status": row.get::<String,_>("status"),
            "profileId": row.get::<Option<Uuid>,_>("profile_id").map(|id| id.to_string()),
            "activeRevisionId": row.get::<String,_>("active_revision_id"), "revisions": revisions,
            "lastRunAt": row.get::<Option<DateTime<Utc>>,_>("last_run_at").map(|at| at.to_rfc3339()),
            "lastSessionId": row.get::<Option<Uuid>,_>("last_session_id").map(|id| id.to_string()),
            "createdAt": row.get::<DateTime<Utc>,_>("created_at").to_rfc3339(), "updatedAt": row.get::<DateTime<Utc>,_>("updated_at").to_rfc3339()
        }));
    }
    root.insert("strategies".into(), Value::Array(strategies));

    let feedback = sqlx::query("SELECT id,job_ref,session_id,reason,suggested_strategy_change,created_at,undone_at FROM user_job_feedback WHERE user_id=$1 ORDER BY created_at DESC")
        .bind(user_id).fetch_all(pool).await?.into_iter().map(|row| json!({
            "id": row.get::<String,_>("id"), "jobId": row.get::<String,_>("job_ref"),
            "sessionId": row.get::<Option<Uuid>,_>("session_id").map(|id| id.to_string()), "reason": row.get::<String,_>("reason"),
            "suggestedStrategyChange": row.get::<Option<String>,_>("suggested_strategy_change"),
            "createdAt": row.get::<DateTime<Utc>,_>("created_at").to_rfc3339(), "undoneAt": row.get::<Option<DateTime<Utc>>,_>("undone_at").map(|at| at.to_rfc3339())
        })).collect::<Vec<_>>();
    let dismissed = feedback
        .iter()
        .filter(|item| {
            item["undoneAt"].is_null()
                && !matches!(
                    item["reason"].as_str(),
                    Some("relevant" | "already_applied")
                )
        })
        .filter_map(|item| item["jobId"].as_str().map(str::to_owned))
        .collect::<Vec<_>>();
    root.insert("feedback".into(), Value::Array(feedback));
    root.insert("dismissedJobIds".into(), json!(dismissed));

    let application_rows = sqlx::query("SELECT id,job_ref,stage,application_date,next_action,follow_up_date,notes,tailored_resume_reference,cover_letter_reference,interview_preparation,source_job_status,updated_at FROM applications WHERE user_id=$1 ORDER BY updated_at DESC")
        .bind(user_id).fetch_all(pool).await?;
    let mut applications = Map::new();
    for row in application_rows {
        let application_id = row.get::<Uuid, _>("id");
        let job_ref = row.get::<String, _>("job_ref");
        let activity = sqlx::query("SELECT id,occurred_at,activity_type,summary FROM application_activities WHERE application_id=$1 AND user_id=$2 ORDER BY occurred_at DESC")
            .bind(application_id).bind(user_id).fetch_all(pool).await?.into_iter().map(|item| json!({ "id": item.get::<String,_>("id"), "at": item.get::<DateTime<Utc>,_>("occurred_at").to_rfc3339(), "type": item.get::<String,_>("activity_type"), "summary": item.get::<String,_>("summary") })).collect::<Vec<_>>();
        let contacts = sqlx::query("SELECT name,detail FROM application_contacts WHERE application_id=$1 AND user_id=$2 ORDER BY position")
            .bind(application_id).bind(user_id).fetch_all(pool).await?.into_iter().map(|item| json!({ "name": item.get::<String,_>("name"), "detail": item.get::<String,_>("detail") })).collect::<Vec<_>>();
        applications.insert(job_ref.clone(), json!({
            "jobId": job_ref, "stage": row.get::<String,_>("stage"),
            "applicationDate": row.get::<Option<NaiveDate>,_>("application_date").map(|date| date.to_string()),
            "nextAction": row.get::<String,_>("next_action"), "followUpDate": row.get::<Option<NaiveDate>,_>("follow_up_date").map(|date| date.to_string()),
            "notes": row.get::<String,_>("notes"), "contacts": contacts,
            "tailoredResumeReference": row.get::<String,_>("tailored_resume_reference"), "coverLetterReference": row.get::<String,_>("cover_letter_reference"),
            "interviewPreparation": row.get::<String,_>("interview_preparation"), "sourceJobStatus": row.get::<String,_>("source_job_status"),
            "activity": activity, "updatedAt": row.get::<DateTime<Utc>,_>("updated_at").to_rfc3339()
        }));
    }
    root.insert("applications".into(), Value::Object(applications));

    // Hydration is also the notification tick: generation is idempotent and
    // preference-gated, so every product read leaves alerts current without a
    // separate scheduler being required.
    crate::notifications::generate_for_user(pool, user_id).await?;

    let notifications = sqlx::query("SELECT id,dedupe_key,notification_type,title,detail,target_view,created_at,read_at,dismissed_at FROM user_notifications WHERE user_id=$1 ORDER BY created_at DESC")
        .bind(user_id).fetch_all(pool).await?.into_iter().map(|row| json!({
            "id": row.get::<String,_>("id"), "dedupeKey": row.get::<String,_>("dedupe_key"), "type": row.get::<String,_>("notification_type"),
            "title": row.get::<String,_>("title"), "detail": row.get::<String,_>("detail"), "targetView": row.get::<String,_>("target_view"),
            "createdAt": row.get::<DateTime<Utc>,_>("created_at").to_rfc3339(), "readAt": row.get::<Option<DateTime<Utc>>,_>("read_at").map(|at| at.to_rfc3339()),
            "dismissedAt": row.get::<Option<DateTime<Utc>>,_>("dismissed_at").map(|at| at.to_rfc3339())
        })).collect::<Vec<_>>();
    root.insert("notifications".into(), Value::Array(notifications));

    let recent = sqlx::query("SELECT job_ref,viewed_at FROM recently_viewed_jobs WHERE user_id=$1 ORDER BY viewed_at DESC LIMIT 20")
        .bind(user_id).fetch_all(pool).await?.into_iter().map(|row| json!({ "jobId": row.get::<String,_>("job_ref"), "viewedAt": row.get::<DateTime<Utc>,_>("viewed_at").to_rfc3339() })).collect::<Vec<_>>();
    root.insert("recentViews".into(), Value::Array(recent));

    Ok(Some((
        state,
        row.get::<i64, _>("revision"),
        row.get::<Option<Uuid>, _>("profile_id"),
        row.get::<DateTime<Utc>, _>("created_at"),
        row.get::<DateTime<Utc>, _>("updated_at"),
    )))
}
