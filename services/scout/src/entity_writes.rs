//! Dedicated incremental writes for normalized user product entities.
//!
//! The daily-workspace save stays a full destructive sync for backward
//! compatibility, but these entry points let clients mutate one saved job, one
//! application, or one batch of notifications without touching sibling rows.
//! Every statement is scoped by `user_id`, so cross-tenant access degrades to
//! a no-op rather than an information leak.

use anyhow::Result;
use chrono::{DateTime, NaiveDate, Utc};
use serde_json::{Value, json};
use sqlx::{Pool, Postgres, Row};
use uuid::Uuid;

pub const MAX_JOB_REF_LEN: usize = 512;
pub const MAX_CONTACTS_PER_REQUEST: usize = 20;
pub const MAX_ACTIVITIES_PER_REQUEST: usize = 50;

pub const STAGES: &[&str] = &[
    "Interested",
    "Saved",
    "Preparing",
    "Ready to apply",
    "Applied",
    "Recruiter screen",
    "Assessment",
    "Technical interview",
    "Final interview",
    "Offer",
    "Rejected",
    "Withdrawn",
    "Closed before application",
    "Archived",
];

const SOURCE_JOB_STATUSES: &[&str] = &["active", "possibly_closed", "closed", "unknown"];

const ACTIVITY_TYPES: &[&str] = &[
    "created",
    "stage_changed",
    "note",
    "follow_up",
    "artifact",
    "contact",
];

/// A job reference must be non-empty, short enough for the schema CHECK
/// constraint, and free of control characters that would poison URLs or logs.
pub fn validate_job_ref(job_ref: &str) -> Result<(), String> {
    if job_ref.is_empty() {
        return Err("jobRef must not be empty".into());
    }
    if job_ref.len() > MAX_JOB_REF_LEN {
        return Err("jobRef exceeds 512 characters".into());
    }
    if job_ref.chars().any(char::is_control) {
        return Err("jobRef must not contain control characters".into());
    }
    Ok(())
}

pub fn validate_stage(stage: &str) -> Result<&'static str, String> {
    STAGES
        .iter()
        .copied()
        .find(|candidate| *candidate == stage)
        .ok_or_else(|| format!("unknown stage {stage:?}; expected one of {STAGES:?}"))
}

pub fn validate_source_job_status(status: &str) -> Result<&'static str, String> {
    SOURCE_JOB_STATUSES
        .iter()
        .copied()
        .find(|candidate| *candidate == status)
        .ok_or_else(|| format!("unknown sourceJobStatus {status:?}; expected active, possibly_closed, closed, or unknown"))
}

pub fn validate_activity_type(activity_type: &str) -> Result<&'static str, String> {
    ACTIVITY_TYPES
        .iter()
        .copied()
        .find(|candidate| *candidate == activity_type)
        .ok_or_else(|| {
            format!("unknown activity type {activity_type:?}; expected created, stage_changed, note, follow_up, artifact, or contact")
        })
}

fn parse_rfc3339(value: Option<&str>) -> Result<Option<DateTime<Utc>>, String> {
    let Some(value) = value else {
        return Ok(None);
    };
    DateTime::parse_from_rfc3339(value)
        .map(|parsed| Some(parsed.with_timezone(&Utc)))
        .map_err(|_| format!("timestamps must be RFC 3339, got {value:?}"))
}

fn parse_date_field(source: &Value, key: &str) -> Result<Option<NaiveDate>, String> {
    match source.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(text)) => NaiveDate::parse_from_str(text, "%Y-%m-%d")
            .map(Some)
            .map_err(|_| format!("{key} must be YYYY-MM-DD, got {text:?}")),
        Some(_) => Err(format!("{key} must be a YYYY-MM-DD string")),
    }
}

fn optional_text<'a>(
    source: &'a Value,
    key: &str,
    max_len: usize,
) -> Result<Option<&'a str>, String> {
    match source.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(text)) => {
            if text.chars().count() > max_len {
                return Err(format!("{key} exceeds {max_len} characters"));
            }
            if text.chars().any(char::is_control) {
                return Err(format!("{key} must not contain control characters"));
            }
            Ok(Some(text.as_str()))
        }
        Some(_) => Err(format!("{key} must be a string")),
    }
}

pub fn parse_saved_at(value: Option<&str>) -> Result<Option<DateTime<Utc>>, String> {
    parse_rfc3339(value)
}

/// Validate a save-request body without touching the database so HTTP
/// handlers can turn schema violations into client-error responses.
pub fn validate_save_request(
    job_ref: &str,
    snapshot: Option<&Value>,
    saved_at: Option<&str>,
) -> Result<(), String> {
    validate_job_ref(job_ref)?;
    if snapshot.is_some_and(|value| !value.is_object()) {
        return Err("snapshot must be an object".into());
    }
    parse_saved_at(saved_at).map(|_| ())
}

/// Validate an application payload up front; the write path re-parses it
/// inside its transaction.
pub fn validate_application_payload(body: &Value) -> Result<(), String> {
    ApplicationPatch::from_request(body).map(|_| ())
}

/// Resolve the canonical job id exactly like user_workspace::sync does: a
/// job_ref matching a known jobs.id keeps its link; unknown refs stay valid
/// but unlinked so saving before indexing never loses user intent.
async fn canonical_job_id(
    tx: &mut sqlx::Transaction<'_, Postgres>,
    job_ref: &str,
) -> Result<Option<Uuid>> {
    Ok(
        sqlx::query_scalar("SELECT id FROM jobs WHERE id::text = $1")
            .bind(job_ref)
            .fetch_optional(&mut **tx)
            .await?,
    )
}

#[derive(Debug)]
pub struct SaveResult {
    pub job_id: String,
    pub saved_at: DateTime<Utc>,
}

/// Upsert one saved job. An explicit savedAt replaces the stored timestamp;
/// otherwise re-saving preserves the original so sort order stays stable.
/// Unarchiving on conflict keeps a re-save meaningful after lifecycle churn.
pub async fn upsert_save(
    pool: &Pool<Postgres>,
    user_id: Uuid,
    job_ref: &str,
    snapshot: Option<Value>,
    saved_at: Option<DateTime<Utc>>,
) -> Result<SaveResult> {
    validate_job_ref(job_ref).map_err(anyhow::Error::msg)?;
    if snapshot.as_ref().is_some_and(|value| !value.is_object()) {
        return Err(anyhow::Error::msg("snapshot must be an object"));
    }
    let snapshot = snapshot.unwrap_or_else(|| json!({}));
    let mut tx = pool.begin().await?;
    let canonical = canonical_job_id(&mut tx, job_ref).await?;
    let row = sqlx::query(
        "INSERT INTO saved_jobs (user_id, job_ref, canonical_job_id, saved_at, snapshot, updated_at) \
         VALUES ($1,$2,$3,COALESCE($4,NOW()),$5,NOW()) \
         ON CONFLICT (user_id, job_ref) DO UPDATE SET \
           snapshot = EXCLUDED.snapshot, archived_at = NULL, updated_at = NOW(), \
           saved_at = COALESCE($4, saved_jobs.saved_at), \
           canonical_job_id = COALESCE(saved_jobs.canonical_job_id, EXCLUDED.canonical_job_id) \
         RETURNING saved_at",
    )
    .bind(user_id)
    .bind(job_ref)
    .bind(canonical)
    .bind(saved_at)
    .bind(snapshot)
    .fetch_one(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(SaveResult {
        job_id: job_ref.to_owned(),
        saved_at: row.get("saved_at"),
    })
}

/// Delete one owned saved job. Deleting another user's ref (or an unknown ref)
/// reports `removed: false` instead of erroring, so retries stay idempotent.
pub async fn delete_save(pool: &Pool<Postgres>, user_id: Uuid, job_ref: &str) -> Result<bool> {
    validate_job_ref(job_ref).map_err(anyhow::Error::msg)?;
    let result = sqlx::query("DELETE FROM saved_jobs WHERE user_id = $1 AND job_ref = $2")
        .bind(user_id)
        .bind(job_ref)
        .execute(pool)
        .await?;
    Ok(result.rows_affected() > 0)
}

#[derive(Debug)]
struct NewActivity {
    id: String,
    activity_type: String,
    summary: String,
}

#[derive(Debug, Default)]
pub struct ApplicationPatch {
    stage: Option<String>,
    application_date: Option<NaiveDate>,
    next_action: Option<String>,
    follow_up_date: Option<NaiveDate>,
    notes: Option<String>,
    tailored_resume_reference: Option<String>,
    cover_letter_reference: Option<String>,
    interview_preparation: Option<String>,
    source_job_status: Option<String>,
    contacts: Option<Vec<(String, String)>>,
    new_activities: Vec<NewActivity>,
}

impl ApplicationPatch {
    /// Absent fields mean "leave the stored value untouched"; there is no way
    /// to clear a scalar back to empty except sending the empty string.
    fn from_request(body: &Value) -> Result<Self, String> {
        if !body.is_object() {
            return Err("application payload must be an object".into());
        }
        let mut patch = Self::default();
        if let Some(stage) = optional_text(body, "stage", 64)? {
            patch.stage = Some(validate_stage(stage)?.to_owned());
        }
        patch.application_date = parse_date_field(body, "applicationDate")?;
        patch.follow_up_date = parse_date_field(body, "followUpDate")?;
        patch.next_action = optional_text(body, "nextAction", 2000)?.map(str::to_owned);
        patch.notes = optional_text(body, "notes", 20_000)?.map(str::to_owned);
        patch.tailored_resume_reference =
            optional_text(body, "tailoredResumeReference", 512)?.map(str::to_owned);
        patch.cover_letter_reference =
            optional_text(body, "coverLetterReference", 512)?.map(str::to_owned);
        patch.interview_preparation =
            optional_text(body, "interviewPreparation", 20_000)?.map(str::to_owned);
        if let Some(status) = optional_text(body, "sourceJobStatus", 32)? {
            patch.source_job_status = Some(validate_source_job_status(status)?.to_owned());
        }
        if let Some(contacts_value) = body.get("contacts") {
            let list = contacts_value
                .as_array()
                .ok_or_else(|| "contacts must be an array".to_string())?;
            if list.len() > MAX_CONTACTS_PER_REQUEST {
                return Err(format!(
                    "contacts exceed {MAX_CONTACTS_PER_REQUEST} entries per request"
                ));
            }
            let mut contacts = Vec::with_capacity(list.len());
            for contact in list {
                let name = optional_text(contact, "name", 256)?
                    .filter(|value| !value.is_empty())
                    .ok_or_else(|| "each contact needs a non-empty name".to_string())?;
                let detail = optional_text(contact, "detail", 512)?.unwrap_or("");
                contacts.push((name.to_owned(), detail.to_owned()));
            }
            patch.contacts = Some(contacts);
        }
        if let Some(activities_value) = body.get("newActivities") {
            let list = activities_value
                .as_array()
                .ok_or_else(|| "newActivities must be an array".to_string())?;
            if list.len() > MAX_ACTIVITIES_PER_REQUEST {
                return Err(format!(
                    "newActivities exceed {MAX_ACTIVITIES_PER_REQUEST} entries per request"
                ));
            }
            for activity in list {
                let id = optional_text(activity, "id", 128)?
                    .filter(|value| !value.is_empty())
                    .ok_or_else(|| "each activity needs a non-empty id".to_string())?;
                let activity_type = validate_activity_type(
                    optional_text(activity, "type", 32)?
                        .ok_or_else(|| "each activity needs a type".to_string())?,
                )?
                .to_owned();
                let summary = optional_text(activity, "summary", 4000)?.unwrap_or("");
                patch.new_activities.push(NewActivity {
                    id: id.to_owned(),
                    activity_type,
                    summary: summary.to_owned(),
                });
            }
        }
        Ok(patch)
    }

    fn is_noop(&self) -> bool {
        self.stage.is_none()
            && self.application_date.is_none()
            && self.next_action.is_none()
            && self.follow_up_date.is_none()
            && self.notes.is_none()
            && self.tailored_resume_reference.is_none()
            && self.cover_letter_reference.is_none()
            && self.interview_preparation.is_none()
            && self.source_job_status.is_none()
            && self.contacts.is_none()
            && self.new_activities.is_empty()
    }
}

#[derive(Debug)]
pub struct ApplicationRecord {
    pub record: Value,
    pub inserted: bool,
}

/// Read one owned application in exactly the camelCase shape (including
/// rfc3339 timestamps and DESC activity ordering) that user_workspace::load
/// produces, so clients can treat both read paths interchangeably.
async fn load_application(
    tx: &mut sqlx::Transaction<'_, Postgres>,
    user_id: Uuid,
    job_ref: &str,
) -> Result<Option<Value>> {
    let Some(row) = sqlx::query(
        "SELECT id,stage,application_date,next_action,follow_up_date,notes,tailored_resume_reference,cover_letter_reference,interview_preparation,source_job_status,updated_at \
         FROM applications WHERE user_id = $1 AND job_ref = $2",
    )
    .bind(user_id)
    .bind(job_ref)
    .fetch_optional(&mut **tx)
    .await?
    else {
        return Ok(None);
    };
    let application_id: Uuid = row.get("id");
    let activity = sqlx::query(
        "SELECT id,occurred_at,activity_type,summary FROM application_activities WHERE application_id = $1 AND user_id = $2 ORDER BY occurred_at DESC",
    )
    .bind(application_id)
    .bind(user_id)
    .fetch_all(&mut **tx)
    .await?
    .into_iter()
    .map(|item| {
        json!({
            "id": item.get::<String, _>("id"),
            "at": item.get::<DateTime<Utc>, _>("occurred_at").to_rfc3339(),
            "type": item.get::<String, _>("activity_type"),
            "summary": item.get::<String, _>("summary"),
        })
    })
    .collect::<Vec<_>>();
    let contacts = sqlx::query(
        "SELECT name,detail FROM application_contacts WHERE application_id = $1 AND user_id = $2 ORDER BY position",
    )
    .bind(application_id)
    .bind(user_id)
    .fetch_all(&mut **tx)
    .await?
    .into_iter()
    .map(|item| json!({ "name": item.get::<String, _>("name"), "detail": item.get::<String, _>("detail") }))
    .collect::<Vec<_>>();
    Ok(Some(json!({
        "jobId": job_ref,
        "stage": row.get::<String, _>("stage"),
        "applicationDate": row.get::<Option<NaiveDate>, _>("application_date").map(|date| date.to_string()),
        "nextAction": row.get::<String, _>("next_action"),
        "followUpDate": row.get::<Option<NaiveDate>, _>("follow_up_date").map(|date| date.to_string()),
        "notes": row.get::<String, _>("notes"),
        "contacts": contacts,
        "tailoredResumeReference": row.get::<String, _>("tailored_resume_reference"),
        "coverLetterReference": row.get::<String, _>("cover_letter_reference"),
        "interviewPreparation": row.get::<String, _>("interview_preparation"),
        "sourceJobStatus": row.get::<String, _>("source_job_status"),
        "activity": activity,
        "updatedAt": row.get::<DateTime<Utc>, _>("updated_at").to_rfc3339(),
    })))
}

/// Insert or update one application plus its child collections in a single
/// transaction. A stage change detected on UPDATE auto-appends exactly one
/// deterministic `stage_changed` activity; inserts seed a `created` marker
/// unless the caller supplied activities of their own.
pub async fn upsert_application(
    pool: &Pool<Postgres>,
    user_id: Uuid,
    job_ref: &str,
    body: &Value,
) -> Result<ApplicationRecord> {
    validate_job_ref(job_ref).map_err(anyhow::Error::msg)?;
    let patch = ApplicationPatch::from_request(body).map_err(anyhow::Error::msg)?;
    if patch.is_noop() {
        return Err(anyhow::Error::msg(
            "provide at least one application field, contact, or activity",
        ));
    }

    let mut tx = pool.begin().await?;
    let canonical = canonical_job_id(&mut tx, job_ref).await?;

    let existing_stage: Option<String> =
        sqlx::query_scalar("SELECT stage FROM applications WHERE user_id = $1 AND job_ref = $2")
            .bind(user_id)
            .bind(job_ref)
            .fetch_optional(&mut *tx)
            .await?;
    let inserted = existing_stage.is_none();

    // Absent scalars bind as NULL so the conflict branch keeps stored values;
    // the insert branch coalesces them to the schema defaults instead.
    let next_stage = patch
        .stage
        .clone()
        .or_else(|| existing_stage.clone())
        .unwrap_or_else(|| "Saved".into());
    let stage_transition = existing_stage
        .as_deref()
        .is_some_and(|current| current != next_stage);

    sqlx::query(
        "INSERT INTO applications (user_id,job_ref,canonical_job_id,stage,application_date,next_action,follow_up_date,notes,\
         tailored_resume_reference,cover_letter_reference,interview_preparation,source_job_status,created_at,updated_at) \
         VALUES ($1,$2,$3,$4,$5,COALESCE($6,''),$7,COALESCE($8,''),COALESCE($9,''),COALESCE($10,''),COALESCE($11,''),\
         COALESCE($12,'unknown'),NOW(),NOW()) \
         ON CONFLICT (user_id, job_ref) DO UPDATE SET \
           stage = EXCLUDED.stage, \
           application_date = COALESCE($5, applications.application_date), \
           next_action = COALESCE($6, applications.next_action), \
           follow_up_date = COALESCE($7, applications.follow_up_date), \
           notes = COALESCE($8, applications.notes), \
           tailored_resume_reference = COALESCE($9, applications.tailored_resume_reference), \
           cover_letter_reference = COALESCE($10, applications.cover_letter_reference), \
           interview_preparation = COALESCE($11, applications.interview_preparation), \
           source_job_status = COALESCE($12, applications.source_job_status), \
           updated_at = NOW(), \
           canonical_job_id = COALESCE(applications.canonical_job_id, EXCLUDED.canonical_job_id)",
    )
    .bind(user_id)
    .bind(job_ref)
    .bind(canonical)
    .bind(&next_stage)
    .bind(patch.application_date)
    .bind(&patch.next_action)
    .bind(patch.follow_up_date)
    .bind(&patch.notes)
    .bind(&patch.tailored_resume_reference)
    .bind(&patch.cover_letter_reference)
    .bind(&patch.interview_preparation)
    .bind(&patch.source_job_status)
    .execute(&mut *tx)
    .await?;

    let application_id: Uuid =
        sqlx::query_scalar("SELECT id FROM applications WHERE user_id = $1 AND job_ref = $2")
            .bind(user_id)
            .bind(job_ref)
            .fetch_one(&mut *tx)
            .await?;

    if stage_transition {
        // The id derives from the transition itself, so replaying the same
        // old-to-new move cannot stack duplicate markers.
        let previous = existing_stage.as_deref().unwrap_or_default();
        sqlx::query(
            "INSERT INTO application_activities (application_id,id,user_id,occurred_at,activity_type,summary) \
             VALUES ($1,$2,$3,NOW(),'stage_changed',$4) ON CONFLICT (application_id, id) DO NOTHING",
        )
        .bind(application_id)
        .bind(format!(
            "stage-{}-{}",
            slug(previous),
            slug(&next_stage)
        ))
        .bind(user_id)
        .bind(format!("{previous} moved to {next_stage}."))
        .execute(&mut *tx)
        .await?;
    }

    if inserted && patch.new_activities.is_empty() {
        sqlx::query(
            "INSERT INTO application_activities (application_id,id,user_id,occurred_at,activity_type,summary) \
             VALUES ($1,'created',$2,NOW(),'created',$3) ON CONFLICT (application_id, id) DO NOTHING",
        )
        .bind(application_id)
        .bind(user_id)
        .bind(format!("Application tracked at stage {next_stage}."))
        .execute(&mut *tx)
        .await?;
    }

    if let Some(contacts) = &patch.contacts {
        // Contacts replace wholesale: the payload is the authoritative list.
        sqlx::query("DELETE FROM application_contacts WHERE application_id = $1 AND user_id = $2")
            .bind(application_id)
            .bind(user_id)
            .execute(&mut *tx)
            .await?;
        for (position, (name, detail)) in contacts.iter().enumerate() {
            sqlx::query(
                "INSERT INTO application_contacts (application_id,position,user_id,name,detail) VALUES ($1,$2,$3,$4,$5)",
            )
            .bind(application_id)
            .bind(position as i32)
            .bind(user_id)
            .bind(name)
            .bind(detail)
            .execute(&mut *tx)
            .await?;
        }
    }

    for activity in &patch.new_activities {
        sqlx::query(
            "INSERT INTO application_activities (application_id,id,user_id,occurred_at,activity_type,summary) \
             VALUES ($1,$2,$3,NOW(),$4,$5) ON CONFLICT (application_id, id) DO NOTHING",
        )
        .bind(application_id)
        .bind(&activity.id)
        .bind(user_id)
        .bind(&activity.activity_type)
        .bind(&activity.summary)
        .execute(&mut *tx)
        .await?;
    }

    let record = load_application(&mut tx, user_id, job_ref)
        .await?
        .ok_or_else(|| anyhow::Error::msg("application row vanished during upsert"))?;
    tx.commit().await?;
    Ok(ApplicationRecord { record, inserted })
}

/// Read one owned application in the shared camelCase shape.
pub async fn get_application(
    pool: &Pool<Postgres>,
    user_id: Uuid,
    job_ref: &str,
) -> Result<Option<Value>> {
    validate_job_ref(job_ref).map_err(anyhow::Error::msg)?;
    // The row plus its child collections read consistently inside one
    // transaction, matching what upsert_application returns.
    let mut tx = pool.begin().await?;
    let record = load_application(&mut tx, user_id, job_ref).await?;
    tx.commit().await?;
    Ok(record)
}

/// Acknowledge notifications by id. The id list is bounded because it binds as
/// a single array parameter and acks are interactive, never bulk imports.
pub async fn ack_notifications(
    pool: &Pool<Postgres>,
    user_id: Uuid,
    ids: &[String],
    action: &str,
) -> Result<u64> {
    if !(1..=100).contains(&ids.len()) {
        return Err(anyhow::Error::msg(
            "ids must contain between 1 and 100 entries",
        ));
    }
    if ids
        .iter()
        .any(|id| id.is_empty() || id.chars().count() > 256)
    {
        return Err(anyhow::Error::msg(
            "each notification id must be 1..=256 characters",
        ));
    }
    let statement = match action {
        "read" => {
            "UPDATE user_notifications SET read_at = NOW() WHERE user_id = $1 AND id = ANY($2)"
        }
        "dismiss" => {
            "UPDATE user_notifications SET dismissed_at = NOW() WHERE user_id = $1 AND id = ANY($2)"
        }
        _ => {
            return Err(anyhow::Error::msg("action must be \"read\" or \"dismiss\""));
        }
    };
    let result = sqlx::query(statement)
        .bind(user_id)
        .bind(ids)
        .execute(pool)
        .await?;
    Ok(result.rows_affected())
}

/// Lowercase-and-dash helper for deterministic activity ids; input that strips
/// to nothing still yields a usable token so the id is never dangling.
fn slug(value: &str) -> String {
    let cleaned: String = value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect();
    let trimmed = cleaned.trim_matches('-');
    if trimmed.is_empty() {
        "unknown".into()
    } else {
        trimmed.into()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn job_ref_rejects_empty_oversized_and_control_characters() {
        assert!(validate_job_ref("").is_err());
        assert!(validate_job_ref(&"a".repeat(513)).is_err());
        assert!(validate_job_ref("bad\u{0007}ref").is_err());
        assert_eq!(validate_job_ref("fixture-job"), Ok(()));
        assert_eq!(validate_job_ref(&"a".repeat(512)), Ok(()));
    }

    #[test]
    fn stages_statuses_and_activity_types_are_closed_sets() {
        assert_eq!(validate_stage("Applied"), Ok("Applied"));
        assert!(validate_stage("applied").is_err());
        assert!(validate_stage("Ghosted").is_err());
        assert_eq!(
            validate_source_job_status("possibly_closed"),
            Ok("possibly_closed")
        );
        assert!(validate_source_job_status("open").is_err());
        assert_eq!(validate_activity_type("follow_up"), Ok("follow_up"));
        assert!(validate_activity_type("reminder").is_err());
    }

    #[test]
    fn application_patch_parses_fields_rejects_bad_values() {
        let patch = ApplicationPatch::from_request(&json!({
            "stage": "Applied",
            "applicationDate": "2026-08-25",
            "nextAction": "Follow up Monday",
            "sourceJobStatus": "active",
            "contacts": [{ "name": "Recruiter", "detail": "" }],
            "newActivities": [{ "id": "act-1", "type": "note", "summary": "Sent." }]
        }))
        .unwrap();
        assert_eq!(patch.stage.as_deref(), Some("Applied"));
        assert_eq!(
            patch.application_date.map(|date| date.to_string()),
            Some("2026-08-25".into())
        );
        assert_eq!(patch.source_job_status.as_deref(), Some("active"));
        assert_eq!(patch.contacts.as_ref().map(Vec::len), Some(1));
        assert_eq!(patch.new_activities.len(), 1);
        assert!(!patch.is_noop());

        assert!(
            ApplicationPatch::from_request(&json!({}))
                .unwrap()
                .is_noop()
        );
        assert!(ApplicationPatch::from_request(&json!({ "stage": "applied" })).is_err());
        assert!(
            ApplicationPatch::from_request(&json!({ "applicationDate": "08/25/2026" })).is_err()
        );
        assert!(ApplicationPatch::from_request(&json!({ "sourceJobStatus": "open" })).is_err());
        assert!(
            ApplicationPatch::from_request(
                &json!({ "newActivities": [{ "id": "a", "type": "reminder" }] })
            )
            .is_err()
        );
        assert!(
            ApplicationPatch::from_request(&json!({ "contacts": [{ "detail": "x" }] })).is_err()
        );
        assert!(ApplicationPatch::from_request(&json!("applied")).is_err());
    }

    #[test]
    fn application_patch_enforces_collection_bounds() {
        let too_many_contacts: Vec<_> = (0..=MAX_CONTACTS_PER_REQUEST)
            .map(|index| json!({ "name": format!("c{index}") }))
            .collect();
        assert!(ApplicationPatch::from_request(&json!({ "contacts": too_many_contacts })).is_err());

        let too_many_activities: Vec<_> = (0..=MAX_ACTIVITIES_PER_REQUEST)
            .map(|index| json!({ "id": format!("a{index}"), "type": "note" }))
            .collect();
        assert!(
            ApplicationPatch::from_request(&json!({ "newActivities": too_many_activities }))
                .is_err()
        );

        assert!(ApplicationPatch::from_request(&json!({ "contacts": [] })).is_ok());
        assert!(ApplicationPatch::from_request(&json!({ "newActivities": [] })).is_ok());
    }

    #[test]
    fn saved_at_and_notification_bounds_are_enforced() {
        assert_eq!(parse_saved_at(None), Ok(None));
        assert!(parse_saved_at(Some("08/25/2026")).is_err());
        assert_eq!(
            parse_saved_at(Some("2026-08-25T10:30:00Z"))
                .unwrap()
                .map(|at| at.to_rfc3339()),
            Some("2026-08-25T10:30:00+00:00".into())
        );

        let single = ["notice-1".to_owned()];
        let oversized: Vec<String> = (0..101).map(|index| format!("notice-{index}")).collect();
        assert!(single.len() <= 100);
        assert!(oversized.len() > 100);
    }

    #[test]
    fn slug_produces_stable_activity_ids() {
        assert_eq!(slug("Ready to apply"), "ready-to-apply");
        assert_eq!(slug(""), "unknown");
        assert_eq!(slug("--"), "unknown");
    }
}
