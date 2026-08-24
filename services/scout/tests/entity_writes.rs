use firstrung_scout::{connect_database, entity_writes};
use serde_json::json;
use uuid::Uuid;

async fn fixture_pool() -> sqlx::Pool<sqlx::Postgres> {
    let database_url = std::env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgres://firstrung:firstrung@127.0.0.1:5432/firstrung".into());
    connect_database(&database_url).await.unwrap()
}

/// Seed two disposable tenant rows so cross-user assertions never collide with
/// the shared integration fixtures.
async fn create_users(pool: &sqlx::Pool<sqlx::Postgres>) -> (Uuid, Uuid) {
    let user_a = Uuid::new_v4();
    let user_b = Uuid::new_v4();
    for id in [user_a, user_b] {
        sqlx::query(
            "INSERT INTO roleatlas_users (id,name,email,email_verified,role) VALUES ($1,'Entity write fixture',$2,TRUE,'user')",
        )
        .bind(id)
        .bind(format!("entity-writes-{id}@tenant.invalid"))
        .execute(pool)
        .await
        .unwrap();
    }
    (user_a, user_b)
}

#[tokio::test]
#[ignore = "requires a disposable PostgreSQL integration database"]
async fn saves_delete_and_re_save_preserve_sibling_rows_and_original_timestamps() {
    let pool = fixture_pool().await;
    let (user_a, user_b) = create_users(&pool).await;

    // (a) saving job A then deleting it leaves previously-saved job B untouched.
    entity_writes::upsert_save(
        &pool,
        user_a,
        "fixture-job-a",
        Some(json!({ "title": "Role A" })),
        None,
    )
    .await
    .unwrap();
    let saved_b = entity_writes::upsert_save(&pool, user_a, "fixture-job-b", None, None)
        .await
        .unwrap();
    assert!(
        entity_writes::delete_save(&pool, user_a, "fixture-job-a")
            .await
            .unwrap()
    );
    let remaining: Vec<String> =
        sqlx::query_scalar("SELECT job_ref FROM saved_jobs WHERE user_id = $1 ORDER BY job_ref")
            .bind(user_a)
            .fetch_all(&pool)
            .await
            .unwrap();
    assert_eq!(remaining, vec!["fixture-job-b".to_owned()]);

    // (e) deleting another user's save ref reports removed:false.
    entity_writes::upsert_save(&pool, user_b, "fixture-job-shared", None, None)
        .await
        .unwrap();
    assert!(
        !entity_writes::delete_save(&pool, user_a, "fixture-job-shared")
            .await
            .unwrap()
    );
    let user_b_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM saved_jobs WHERE user_id = $1 AND job_ref = 'fixture-job-shared'",
    )
    .bind(user_b)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(user_b_count, 1);

    // (b) re-save without savedAt preserves the original saved_at.
    std::thread::sleep(std::time::Duration::from_millis(1100));
    let re_saved = entity_writes::upsert_save(
        &pool,
        user_a,
        "fixture-job-b",
        Some(json!({ "title": "Role B v2" })),
        None,
    )
    .await
    .unwrap();
    assert_eq!(
        re_saved.saved_at.to_rfc3339(),
        saved_b.saved_at.to_rfc3339()
    );
    let stored_snapshot: serde_json::Value = sqlx::query_scalar(
        "SELECT snapshot FROM saved_jobs WHERE user_id = $1 AND job_ref = 'fixture-job-b'",
    )
    .bind(user_a)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(stored_snapshot["title"], "Role B v2");

    // (f) empty and oversized refs are rejected before touching the table.
    assert!(
        entity_writes::upsert_save(&pool, user_a, "", None, None)
            .await
            .is_err()
    );
    let oversized = "x".repeat(513);
    assert!(
        entity_writes::upsert_save(&pool, user_a, &oversized, None, None)
            .await
            .is_err()
    );
    assert!(
        entity_writes::upsert_save(&pool, user_a, "control\u{0007}char", None, None)
            .await
            .is_err()
    );

    sqlx::query("DELETE FROM roleatlas_users WHERE id = ANY($1::UUID[])")
        .bind([user_a, user_b])
        .execute(&pool)
        .await
        .unwrap();
}

#[tokio::test]
#[ignore = "requires a disposable PostgreSQL integration database"]
async fn application_upsert_updates_stages_contacts_and_activities_without_duplicates() {
    let pool = fixture_pool().await;
    let (user_a, _user_b) = create_users(&pool).await;

    // Insert with explicit activities: no automatic 'created' marker is added.
    let created = entity_writes::upsert_application(
        &pool,
        user_a,
        "fixture-app-job",
        &json!({
            "stage": "Interested",
            "notes": "First pass",
            "contacts": [{ "name": "Recruiter One", "detail": "one@fixture.invalid" }],
            "newActivities": [{ "id": "act-1", "type": "note", "summary": "Found via search." }]
        }),
    )
    .await
    .unwrap();
    assert!(created.inserted);
    assert_eq!(created.record["jobId"], "fixture-app-job");
    assert_eq!(created.record["stage"], "Interested");
    assert_eq!(created.record["applicationDate"], serde_json::Value::Null);
    assert_eq!(created.record["activity"].as_array().unwrap().len(), 1);

    // Update without duplicating anything; absent fields keep stored values.
    let updated = entity_writes::upsert_application(
        &pool,
        user_a,
        "fixture-app-job",
        &json!({ "notes": "Second pass" }),
    )
    .await
    .unwrap();
    assert!(!updated.inserted);
    assert_eq!(updated.record["notes"], "Second pass");
    assert_eq!(updated.record["stage"], "Interested");
    assert_eq!(updated.record["activity"].as_array().unwrap().len(), 1);

    // Auto-append exactly one stage_changed activity on transition.
    let transitioned = entity_writes::upsert_application(
        &pool,
        user_a,
        "fixture-app-job",
        &json!({ "stage": "Applied", "applicationDate": "2026-08-25" }),
    )
    .await
    .unwrap();
    let activity = transitioned.record["activity"].as_array().unwrap();
    assert_eq!(activity.len(), 2);
    assert_eq!(activity[0]["type"], "stage_changed");
    assert!(
        activity[0]["id"]
            .as_str()
            .unwrap()
            .starts_with("stage-interested-applied")
    );
    assert_eq!(transitioned.record["applicationDate"], "2026-08-25");

    // Replaying the same transition does not stack duplicate markers.
    let replayed = entity_writes::upsert_application(
        &pool,
        user_a,
        "fixture-app-job",
        &json!({ "stage": "Applied" }),
    )
    .await
    .unwrap();
    assert_eq!(replayed.record["activity"].as_array().unwrap().len(), 2);

    // Contacts replace wholesale.
    let replaced = entity_writes::upsert_application(
        &pool,
        user_a,
        "fixture-app-job",
        &json!({ "contacts": [
            { "name": "Recruiter Two", "detail": "two@fixture.invalid" },
            { "name": "Hiring Manager", "detail": "" }
        ] }),
    )
    .await
    .unwrap();
    let contacts = replaced.record["contacts"].as_array().unwrap();
    assert_eq!(contacts.len(), 2);
    assert_eq!(contacts[0]["name"], "Recruiter Two");
    assert_eq!(contacts[1]["detail"], "");

    // Appending new activities is additive and ON CONFLICT DO NOTHING.
    let appended = entity_writes::upsert_application(
        &pool,
        user_a,
        "fixture-app-job",
        &json!({ "newActivities": [
            { "id": "act-1", "type": "note", "summary": "Duplicate id must be ignored." },
            { "id": "act-2", "type": "follow_up", "summary": "Send status email." }
        ] }),
    )
    .await
    .unwrap();
    assert_eq!(appended.record["activity"].as_array().unwrap().len(), 3);

    // Invalid values are rejected outright.
    assert!(
        entity_writes::upsert_application(
            &pool,
            user_a,
            "fixture-app-job",
            &json!({ "stage": "applied" })
        )
        .await
        .is_err()
    );
    assert!(
        entity_writes::upsert_application(
            &pool,
            user_a,
            "fixture-app-job",
            &json!({ "sourceJobStatus": "open" })
        )
        .await
        .is_err()
    );
    assert!(
        entity_writes::upsert_application(
            &pool,
            user_a,
            "fixture-app-job",
            &json!({ "newActivities": [{ "id": "x", "type": "reminder" }] })
        )
        .await
        .is_err()
    );
    assert!(
        entity_writes::upsert_application(&pool, user_a, "fixture-app-job", &json!({}))
            .await
            .is_err()
    );

    // get_application returns exactly what upsert returned last.
    let fetched = entity_writes::get_application(&pool, user_a, "fixture-app-job")
        .await
        .unwrap()
        .unwrap();
    assert_eq!(fetched, appended.record);
    assert!(
        entity_writes::get_application(&pool, user_a, "fixture-app-missing")
            .await
            .unwrap()
            .is_none()
    );

    // An explicit null clears a stored date; a later patch without the key
    // leaves it cleared rather than resurrecting it.
    let cleared = entity_writes::upsert_application(
        &pool,
        user_a,
        "fixture-app-job",
        &json!({ "applicationDate": null }),
    )
    .await
    .unwrap();
    assert_eq!(cleared.record["applicationDate"], serde_json::Value::Null);
    let kept = entity_writes::upsert_application(
        &pool,
        user_a,
        "fixture-app-job",
        &json!({ "notes": "Date stays cleared." }),
    )
    .await
    .unwrap();
    assert_eq!(kept.record["applicationDate"], serde_json::Value::Null);

    sqlx::query("DELETE FROM roleatlas_users WHERE id = $1")
        .bind(user_a)
        .execute(&pool)
        .await
        .unwrap();
}

#[tokio::test]
#[ignore = "requires a disposable PostgreSQL integration database"]
async fn notification_ack_is_scoped_to_the_requesting_user() {
    let pool = fixture_pool().await;
    let (user_a, user_b) = create_users(&pool).await;

    // (d) both users hold a notification with the SAME client-supplied id;
    // only the requesting user's row may change.
    for user_id in [user_a, user_b] {
        sqlx::query(
            "INSERT INTO user_notifications (user_id,id,dedupe_key,notification_type,title,detail,target_view) \
             VALUES ($1,'shared-notice',$2,'follow_up_due','Follow up','Fixture detail','applications')",
        )
        .bind(user_id)
        .bind(format!("dedupe-{user_id}"))
        .execute(&pool)
        .await
        .unwrap();
    }

    let updated =
        entity_writes::ack_notifications(&pool, user_a, &["shared-notice".to_owned()], "read")
            .await
            .unwrap();
    assert_eq!(updated, 1);
    let read_state: (Option<chrono::DateTime<chrono::Utc>>, Option<chrono::DateTime<chrono::Utc>>) =
        sqlx::query_as(
            "SELECT read_at, dismissed_at FROM user_notifications WHERE user_id = $1 AND id = 'shared-notice'",
        )
        .bind(user_a)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert!(read_state.0.is_some());
    assert!(read_state.1.is_none());
    let untouched: Option<chrono::DateTime<chrono::Utc>> = sqlx::query_scalar(
        "SELECT read_at FROM user_notifications WHERE user_id = $1 AND id = 'shared-notice'",
    )
    .bind(user_b)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(untouched.is_none());

    let dismissed =
        entity_writes::ack_notifications(&pool, user_a, &["shared-notice".to_owned()], "dismiss")
            .await
            .unwrap();
    assert_eq!(dismissed, 1);

    // Bounds: empty and oversized id lists are rejected.
    assert!(
        entity_writes::ack_notifications(&pool, user_a, &[], "read")
            .await
            .is_err()
    );
    let oversized: Vec<String> = (0..101).map(|index| format!("notice-{index}")).collect();
    assert!(
        entity_writes::ack_notifications(&pool, user_a, &oversized, "read")
            .await
            .is_err()
    );
    assert!(
        entity_writes::ack_notifications(&pool, user_a, &["shared-notice".to_owned()], "archive")
            .await
            .is_err()
    );

    sqlx::query("DELETE FROM roleatlas_users WHERE id = ANY($1::UUID[])")
        .bind([user_a, user_b])
        .execute(&pool)
        .await
        .unwrap();
}
