use firstrung_scout::{connect_database, entity_writes, user_workspace};
use serde_json::json;
use uuid::Uuid;

#[tokio::test]
#[ignore = "requires the local PostgreSQL integration service"]
async fn daily_workspace_survives_round_trip_and_revision_updates() {
    let database_url = std::env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgres://firstrung:firstrung@127.0.0.1:5432/firstrung".into());
    let pool = connect_database(&database_url).await.unwrap();
    let user_id = Uuid::parse_str("00000000-0000-4000-8000-000000000001").unwrap();
    let first = json!({
        "schemaVersion": 1,
        "onboarding": { "currentStep": "career-goals" },
        "savedJobs": { "fixture-job": { "jobId": "fixture-job" } },
        "notifications": []
    });
    sqlx::query(
        "INSERT INTO daily_workspaces (user_id, workspace_key, state) VALUES ($1,'integration-test',$2) \
         ON CONFLICT (user_id, workspace_key) DO UPDATE SET state = EXCLUDED.state, revision = daily_workspaces.revision + 1, updated_at = NOW()",
    )
    .bind(user_id)
    .bind(&first)
    .execute(&pool)
    .await
    .unwrap();
    let second = json!({
        "schemaVersion": 1,
        "onboarding": { "currentStep": "run-search", "completedAt": "2026-07-16T00:00:00Z" },
        "savedJobs": { "fixture-job": { "jobId": "fixture-job" } },
        "notifications": [{ "id": "notice-1", "readAt": null }]
    });
    let row: (serde_json::Value, i64) = sqlx::query_as(
        "UPDATE daily_workspaces SET state = $1, revision = revision + 1, updated_at = NOW() WHERE user_id = $2 AND workspace_key = 'integration-test' RETURNING state, revision",
    )
    .bind(&second)
    .bind(user_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(row.0["onboarding"]["currentStep"], "run-search");
    assert_eq!(row.0["savedJobs"]["fixture-job"]["jobId"], "fixture-job");
    assert!(row.1 >= 2);
    sqlx::query(
        "DELETE FROM daily_workspaces WHERE user_id = $1 AND workspace_key = 'integration-test'",
    )
    .bind(user_id)
    .execute(&pool)
    .await
    .unwrap();
}

#[tokio::test]
#[ignore = "requires a disposable PostgreSQL integration database"]
async fn normalized_workspace_entities_are_authoritative_isolated_and_revision_guarded() {
    let database_url = std::env::var("DATABASE_URL")
        .expect("DATABASE_URL must point to a disposable integration database");
    let pool = connect_database(&database_url).await.unwrap();
    let user_a = Uuid::new_v4();
    let user_b = Uuid::new_v4();
    for (id, label) in [(user_a, "workspace-a"), (user_b, "workspace-b")] {
        sqlx::query("INSERT INTO roleatlas_users (id,name,email,email_verified,role) VALUES ($1,'Workspace fixture',$2,TRUE,'user')")
            .bind(id)
            .bind(format!("{label}-{id}@tenant.invalid"))
            .execute(&pool)
            .await
            .unwrap();
    }

    // The workspace PUT owns strategies, feedback, and recent views. Saved
    // jobs and applications are written through the dedicated entity writers,
    // so their state in the PUT payload is ignored rather than synced.
    let workspace = json!({
        "schemaVersion": 1,
        "onboarding": { "currentStep": "run-search" },
        "strategies": [{
            "id": "strategy-a", "name": "Research roles", "status": "active", "profileId": null,
            "activeRevisionId": "revision-a", "lastRunAt": null, "lastSessionId": null,
            "createdAt": "2026-08-20T00:00:00Z", "updatedAt": "2026-08-20T00:00:00Z",
            "revisions": [{ "id": "revision-a", "version": 1, "reason": "created", "createdAt": "2026-08-20T00:00:00Z", "plan": { "roleQueries": ["Research"] } }]
        }],
        "savedJobs": { "ignored-by-put": { "jobId": "ignored-by-put", "snapshot": { "title": "Must not appear" } } },
        "feedback": [{ "id": "feedback-a", "jobId": "fixture-job-a", "sessionId": null, "reason": "wrong_location", "createdAt": "2026-08-20T00:00:00Z", "undoneAt": null, "suggestedStrategyChange": "Review geography." }],
        "dismissedJobIds": ["fixture-job-a"],
        "applications": { "ignored-by-put": {
            "jobId": "ignored-by-put", "stage": "Applied", "notes": "Must not appear",
            "updatedAt": "2026-08-20T00:00:00Z"
        } },
        "notifications": [],
        "recentViews": [{ "jobId": "fixture-job-a", "viewedAt": "2026-08-20T00:00:00Z" }],
        "learnedPreferences": {}, "lastVisitAt": null, "updatedAt": "2026-08-20T00:00:00Z"
    });

    let first = user_workspace::save(&pool, user_a, None, workspace.clone(), Some(0))
        .await
        .unwrap();
    assert!(matches!(
        first,
        user_workspace::SaveOutcome::Saved { revision: 1, .. }
    ));
    let conflict = user_workspace::save(&pool, user_a, None, json!({}), Some(0))
        .await
        .unwrap();
    assert!(matches!(
        conflict,
        user_workspace::SaveOutcome::Conflict {
            current_revision: 1
        }
    ));

    // Entity writers own saved jobs and applications; the PUT payload above
    // carried rows that must NOT have been materialized.
    entity_writes::upsert_save(
        &pool,
        user_a,
        "supplemental-job-a",
        Some(json!({ "id": "supplemental-job-a", "title": "Researcher" })),
        None,
    )
    .await
    .unwrap();
    entity_writes::upsert_application(
        &pool,
        user_a,
        "supplemental-job-a",
        &json!({
            "stage": "Applied",
            "notes": "Private note",
            "contacts": [{ "name": "Recruiter", "detail": "fixture@example.invalid" }]
        }),
    )
    .await
    .unwrap();

    let (loaded, revision, _, _, _) = user_workspace::load(&pool, user_a).await.unwrap().unwrap();
    assert_eq!(revision, 1);
    assert_eq!(
        loaded["savedJobs"]["supplemental-job-a"]["snapshot"]["title"],
        "Researcher"
    );
    assert_eq!(
        loaded["applications"]["supplemental-job-a"]["notes"],
        "Private note"
    );
    assert_eq!(
        loaded["applications"]["supplemental-job-a"]["contacts"][0]["name"],
        "Recruiter"
    );
    assert_eq!(
        loaded["strategies"][0]["revisions"][0]["plan"]["roleQueries"][0],
        "Research"
    );
    assert_eq!(loaded["dismissedJobIds"][0], "fixture-job-a");
    assert!(
        loaded["savedJobs"].get("ignored-by-put").is_none(),
        "PUT payload must not sync saved jobs anymore"
    );
    assert!(
        loaded["applications"].get("ignored-by-put").is_none(),
        "PUT payload must not sync applications anymore"
    );

    // A second workspace save keeps entity rows intact instead of wiping them.
    user_workspace::save(&pool, user_a, None, workspace.clone(), Some(1))
        .await
        .unwrap();
    let after_resave = user_workspace::load(&pool, user_a)
        .await
        .unwrap()
        .unwrap()
        .0;
    assert_eq!(
        after_resave["savedJobs"]["supplemental-job-a"]["snapshot"]["title"], "Researcher",
        "a strategies/feedback save must not delete sibling saves"
    );
    assert_eq!(
        after_resave["applications"]["supplemental-job-a"]["notes"], "Private note",
        "a strategies/feedback save must not delete sibling applications"
    );

    assert!(user_workspace::load(&pool, user_b).await.unwrap().is_none());
    for table in [
        "saved_jobs",
        "search_strategies",
        "search_strategy_revisions",
        "user_job_feedback",
        "applications",
        "application_activities",
        "application_contacts",
        "recently_viewed_jobs",
    ] {
        let count: i64 =
            sqlx::query_scalar(&format!("SELECT COUNT(*) FROM {table} WHERE user_id=$1"))
                .bind(user_a)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert!(
            count > 0,
            "{table} should contain normalized user-owned state"
        );
        let other_count: i64 =
            sqlx::query_scalar(&format!("SELECT COUNT(*) FROM {table} WHERE user_id=$1"))
                .bind(user_b)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(other_count, 0, "{table} must remain tenant isolated");
    }

    sqlx::query("DELETE FROM roleatlas_users WHERE id = ANY($1::UUID[])")
        .bind([user_a, user_b])
        .execute(&pool)
        .await
        .unwrap();
}
