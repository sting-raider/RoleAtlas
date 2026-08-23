use firstrung_scout::{connect_database, notifications};
use serde_json::json;
use sqlx::Row;
use uuid::Uuid;

#[tokio::test]
#[ignore = "requires a disposable PostgreSQL integration database"]
async fn notification_generation_is_idempotent_preference_gated_and_tenant_scoped() {
    let database_url = std::env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgres://firstrung:firstrung@127.0.0.1:5432/firstrung".into());
    let pool = connect_database(&database_url).await.unwrap();
    let user_a = Uuid::new_v4();
    let user_b = Uuid::new_v4();
    for user in [user_a, user_b] {
        sqlx::query("INSERT INTO roleatlas_users (id, name, email) VALUES ($1,'fixture','fixture-'||$1::text||'@example.test') \
                     ON CONFLICT (id) DO NOTHING")
            .bind(user)
            .execute(&pool)
            .await
            .unwrap();
    }

    // User A: a due follow-up, a saved job that closed, and an unseen top-ranked session result.
    let closed_job: Uuid = Uuid::new_v4();
    sqlx::query("INSERT INTO jobs (id, source_url, source_name, title, company, description, raw, \
                 source_id, source_type, canonical_url, apply_url, identity_key, identity_strategy, lifecycle_status) \
                 VALUES ($1, 'https://fixture.example/jobs/closed-1', 'Fixture', 'Closed Analyst Role', 'Fixture Co', 'fixture description', '{}'::jsonb, \
                         'fixture:notifications-closed-1', 'company_site', 'https://fixture.example/jobs/closed-1', \
                         'https://fixture.example/jobs/closed-1', 'url:https://fixture.example/jobs/closed-1', 'canonical_url', 'closed')")
        .bind(closed_job)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO applications (id, user_id, job_ref, canonical_job_id, stage, next_action, follow_up_date) \
                 VALUES ($1, $2, 'scout-closed-1', $3, 'Applied', 'Email the recruiter for a status update.', CURRENT_DATE)")
        .bind(Uuid::new_v4())
        .bind(user_a)
        .bind(closed_job)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO saved_jobs (user_id, job_ref, canonical_job_id) VALUES ($1, 'scout-closed-1', $2)")
        .bind(user_a)
        .bind(closed_job)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query(
        "INSERT INTO search_sessions (id, user_id, status, plan_snapshot, completed_at) \
                 VALUES ($1, $2, 'success', '{}', NOW() - INTERVAL '1 day')",
    )
    .bind(Uuid::new_v4())
    .bind(user_a)
    .execute(&pool)
    .await
    .unwrap();
    // (session id reused below via join by user; results attach through the same fixture session)
    let session_id: Uuid =
        sqlx::query_scalar("SELECT id FROM search_sessions WHERE user_id = $1 LIMIT 1")
            .bind(user_a)
            .fetch_one(&pool)
            .await
            .unwrap();
    sqlx::query("INSERT INTO search_session_results (session_id, job_id, score, rank) VALUES ($1, $2, 0.9, 1)")
        .bind(session_id)
        .bind(closed_job)
        .execute(&pool)
        .await
        .unwrap();

    let first = notifications::generate_for_user(&pool, user_a)
        .await
        .unwrap();
    assert!(
        first >= 3,
        "expected follow-up, closure, and strong-match alerts, got {first}"
    );

    // Second run is a no-op: dedupe keys pin every generated row.
    let second = notifications::generate_for_user(&pool, user_b)
        .await
        .unwrap();
    assert_eq!(second, 0, "another tenant must never inherit fixtures");
    let third = notifications::generate_for_user(&pool, user_a)
        .await
        .unwrap();
    assert_eq!(third, 0, "generation must be idempotent within a day");

    let types: Vec<String> = sqlx::query("SELECT notification_type FROM user_notifications WHERE user_id = $1 ORDER BY notification_type")
        .bind(user_a)
        .fetch_all(&pool)
        .await
        .unwrap()
        .into_iter()
        .map(|row| row.get("notification_type"))
        .collect();
    assert!(types.contains(&"follow_up_due".to_string()));
    assert!(types.contains(&"saved_job_closed".to_string()));
    assert!(types.contains(&"new_strong_matches".to_string()));

    // Disabling follow_up_due stops future generations (a new day produces a
    // new dedupe key, so gating must come from preferences).
    notifications::set_preferences(&pool, user_a, json!({"follow_up_due": false}), false)
        .await
        .unwrap();
    sqlx::query(
        "DELETE FROM user_notifications WHERE user_id = $1 AND notification_type = 'follow_up_due'",
    )
    .bind(user_a)
    .execute(&pool)
    .await
    .unwrap();
    notifications::generate_for_user(&pool, user_a)
        .await
        .unwrap();
    let follow_ups: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM user_notifications WHERE user_id = $1 AND notification_type = 'follow_up_due'",
    )
    .bind(user_a)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        follow_ups, 0,
        "disabled preference must suppress generation"
    );

    // Preferences exist and are readable after generation.
    let digest: bool = sqlx::query_scalar(
        "SELECT weekly_digest FROM user_notification_preferences WHERE user_id = $1",
    )
    .bind(user_a)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(!digest);

    for user in [user_a, user_b] {
        sqlx::query("DELETE FROM roleatlas_users WHERE id = $1")
            .bind(user)
            .execute(&pool)
            .await
            .unwrap()
            .rows_affected();
    }
    sqlx::query("DELETE FROM jobs WHERE id = $1")
        .bind(closed_job)
        .execute(&pool)
        .await
        .unwrap();
}
