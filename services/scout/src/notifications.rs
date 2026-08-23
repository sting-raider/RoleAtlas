//! Deterministic notification generation.
//!
//! Every generator is idempotent: dedupe keys pin one notification per
//! subject per state (per day for follow-ups), inserts use ON CONFLICT DO
//! NOTHING, and each generator honors the user's stored preferences with an
//! enabled-by-default fallback. Generation runs on hydration and can be run
//! from a scheduler without coordination.

use anyhow::Result;
use sqlx::Pool;
use sqlx::Postgres;
use uuid::Uuid;

pub async fn generate_for_user(pool: &Pool<Postgres>, user_id: Uuid) -> Result<u64> {
    ensure_preferences(pool, user_id).await?;
    let mut inserted = 0u64;
    inserted += generate_follow_ups(pool, user_id).await?;
    inserted += generate_saved_job_closures(pool, user_id).await?;
    inserted += generate_new_strong_matches(pool, user_id).await?;
    Ok(inserted)
}

pub async fn ensure_preferences(pool: &Pool<Postgres>, user_id: Uuid) -> Result<()> {
    sqlx::query("INSERT INTO user_notification_preferences (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING")
        .bind(user_id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn set_preferences(
    pool: &Pool<Postgres>,
    user_id: Uuid,
    enabled_types: serde_json::Value,
    weekly_digest: bool,
) -> Result<()> {
    ensure_preferences(pool, user_id).await?;
    sqlx::query(
        "UPDATE user_notification_preferences \
         SET enabled_types = $2, weekly_digest = $3, revision = revision + 1, updated_at = NOW() \
         WHERE user_id = $1",
    )
    .bind(user_id)
    .bind(enabled_types)
    .bind(weekly_digest)
    .execute(pool)
    .await?;
    Ok(())
}

/// Applications whose follow-up date has arrived stay visible until the stage
/// becomes terminal; one reminder per application per day.
async fn generate_follow_ups(pool: &Pool<Postgres>, user_id: Uuid) -> Result<u64> {
    let result = sqlx::query(
        "INSERT INTO user_notifications (user_id, id, dedupe_key, notification_type, title, detail, target_view) \
         SELECT a.user_id, \
                'follow-up-' || a.id::text || '-' || to_char(CURRENT_DATE, 'YYYY-MM-DD'), \
                'follow_up_due:' || a.id::text || ':' || CURRENT_DATE::text, \
                'follow_up_due', \
                'Follow up: ' || COALESCE(j.title, a.job_ref), \
                COALESCE(NULLIF(a.next_action, ''), 'Check the current status and send a short update.'), \
                'applications' \
         FROM applications a \
         LEFT JOIN jobs j ON j.id = a.canonical_job_id \
         LEFT JOIN user_notification_preferences p ON p.user_id = a.user_id \
         WHERE a.user_id = $1 \
           AND a.follow_up_date IS NOT NULL AND a.follow_up_date <= CURRENT_DATE \
           AND a.stage NOT IN ('Rejected', 'Withdrawn', 'Closed before application', 'Archived') \
           AND COALESCE((p.enabled_types ->> 'follow_up_due')::boolean, TRUE) \
         ON CONFLICT (user_id, dedupe_key) DO NOTHING",
    )
    .bind(user_id)
    .execute(pool)
    .await?;
    Ok(result.rows_affected())
}

/// Saved roles whose canonical lifecycle moved to possibly_closed or closed.
/// One notification per job per lifecycle state, ever.
async fn generate_saved_job_closures(pool: &Pool<Postgres>, user_id: Uuid) -> Result<u64> {
    let result = sqlx::query(
        "INSERT INTO user_notifications (user_id, id, dedupe_key, notification_type, title, detail, target_view) \
         SELECT s.user_id, \
                'saved-status-' || s.canonical_job_id::text || '-' || j.lifecycle_status, \
                'saved_job_status:' || s.canonical_job_id::text || ':' || j.lifecycle_status, \
                CASE j.lifecycle_status WHEN 'closed' THEN 'saved_job_closed' ELSE 'saved_job_possibly_closing' END, \
                COALESCE(j.title, s.job_ref) || CASE WHEN j.lifecycle_status = 'closed' THEN ' has closed' ELSE ' may have closed' END, \
                CASE WHEN j.lifecycle_status = 'closed' \
                     THEN 'This saved role is no longer active in the canonical index.' \
                     ELSE 'The employer may have filled this role; verify before investing more time.' END, \
                'saved' \
         FROM saved_jobs s \
         JOIN jobs j ON j.id = s.canonical_job_id \
         LEFT JOIN user_notification_preferences p ON p.user_id = s.user_id \
         WHERE s.user_id = $1 \
           AND s.archived_at IS NULL \
           AND j.lifecycle_status IN ('possibly_closed', 'closed') \
           AND COALESCE((p.enabled_types ->> 'saved_job_closed')::boolean, TRUE) \
         ON CONFLICT (user_id, dedupe_key) DO NOTHING",
    )
    .bind(user_id)
    .execute(pool)
    .await?;
    Ok(result.rows_affected())
}

/// Recent successful sessions surface once when at least one of their top-3
/// ranked roles has not been viewed yet. One alert per session, ever.
async fn generate_new_strong_matches(pool: &Pool<Postgres>, user_id: Uuid) -> Result<u64> {
    let result = sqlx::query(
        "WITH recent AS ( \
           SELECT ss.id AS session_id, ss.user_id, \
                  COUNT(r.job_id) FILTER (WHERE v.canonical_job_id IS NULL) AS unseen_top_roles, \
                  COALESCE((p.enabled_types ->> 'new_strong_matches')::boolean, TRUE) AS enabled \
           FROM search_sessions ss \
           JOIN search_session_results r ON r.session_id = ss.id AND r.rank <= 3 \
           LEFT JOIN recently_viewed_jobs v ON v.user_id = ss.user_id AND v.canonical_job_id = r.job_id \
           LEFT JOIN user_notification_preferences p ON p.user_id = ss.user_id \
           WHERE ss.user_id = $1 \
             AND ss.status = 'success' \
             AND ss.completed_at > NOW() - INTERVAL '7 days' \
           GROUP BY ss.id, ss.user_id, p.enabled_types \
         ) \
         INSERT INTO user_notifications (user_id, id, dedupe_key, notification_type, title, detail, target_view) \
         SELECT user_id, \
                'strong-matches-' || session_id::text, \
                'new_strong_matches:' || session_id::text, \
                'new_strong_matches', \
                'New strong matches are waiting', \
                unseen_top_roles::text || ' highly ranked role(s) from a recent search have not been reviewed yet.', \
                'home' \
         FROM recent \
         WHERE unseen_top_roles > 0 AND enabled \
         ON CONFLICT (user_id, dedupe_key) DO NOTHING",
    )
    .bind(user_id)
    .execute(pool)
    .await?;
    Ok(result.rows_affected())
}
