use firstrung_scout::connect_database;
use serde_json::json;

#[tokio::test]
#[ignore = "requires the local PostgreSQL integration service"]
async fn daily_workspace_survives_round_trip_and_revision_updates() {
    let database_url = std::env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgres://firstrung:firstrung@127.0.0.1:5432/firstrung".into());
    let pool = connect_database(&database_url).await.unwrap();
    let first = json!({
        "schemaVersion": 1,
        "onboarding": { "currentStep": "career-goals" },
        "savedJobs": { "fixture-job": { "jobId": "fixture-job" } },
        "notifications": []
    });
    sqlx::query(
        "INSERT INTO daily_workspaces (workspace_key, state) VALUES ('integration-test',$1) \
         ON CONFLICT (workspace_key) DO UPDATE SET state = EXCLUDED.state, revision = daily_workspaces.revision + 1, updated_at = NOW()",
    )
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
        "UPDATE daily_workspaces SET state = $1, revision = revision + 1, updated_at = NOW() WHERE workspace_key = 'integration-test' RETURNING state, revision",
    )
    .bind(&second)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(row.0["onboarding"]["currentStep"], "run-search");
    assert_eq!(row.0["savedJobs"]["fixture-job"]["jobId"], "fixture-job");
    assert!(row.1 >= 2);
    sqlx::query("DELETE FROM daily_workspaces WHERE workspace_key = 'integration-test'")
        .execute(&pool)
        .await
        .unwrap();
}
