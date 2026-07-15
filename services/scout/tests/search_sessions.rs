use firstrung_scout::{connect_database, search};
use serde_json::json;
use uuid::Uuid;

#[tokio::test]
#[ignore = "requires the local PostgreSQL integration service"]
async fn search_session_finds_unloaded_index_job_and_persists_provenance_feedback() {
    let database_url = std::env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgres://firstrung:firstrung@127.0.0.1:5432/firstrung".into());
    let pool = connect_database(&database_url).await.unwrap();
    let job_id = Uuid::new_v5(&Uuid::NAMESPACE_URL, b"roleatlas-search-session-fixture");
    sqlx::query(
        "INSERT INTO jobs (id, source_url, source_name, source_id, source_type, canonical_url, apply_url, identity_key, identity_strategy, title, company, location, country, remote, employment_type, experience_years, description, skills, raw, lifecycle_status, is_active) \
         VALUES ($1,$2,'Fixture','fixture:search','fixture',$2,$2,$3,'canonical_url','Quantum Verification Intern','RoleAtlas Fixture','Bengaluru, India','India',FALSE,'Internship',0,'Quantum verification projects welcome.','[]'::jsonb,'{}'::jsonb,'active',TRUE) \
         ON CONFLICT (id) DO UPDATE SET lifecycle_status = 'active', is_active = TRUE",
    ).bind(job_id).bind("https://fixture.invalid/jobs/search-session").bind("url:https://fixture.invalid/jobs/search-session").execute(&pool).await.unwrap();

    let response = search::execute(&pool, json!({ "search_plan": { "roleQueries": ["Quantum Verification"], "locations": ["India"], "jobTypes": ["Internship"], "workModes": [], "maxExperience": 1, "noDegreeRequired": false } })).await.unwrap();
    let session_id = Uuid::parse_str(response["session"]["id"].as_str().unwrap()).unwrap();
    assert!(
        response["jobs"]
            .as_array()
            .unwrap()
            .iter()
            .any(|job| job["id"] == job_id.to_string())
    );
    let fixture = response["jobs"]
        .as_array()
        .unwrap()
        .iter()
        .find(|job| job["id"] == job_id.to_string())
        .unwrap();
    assert_eq!(fixture["provenance"][0]["query"], "Quantum Verification");
    assert!(response["session"]["coverage"]["configured_sources"].is_number());
    assert!(response["session"]["coverage"]["successful_sources"].is_number());
    assert!(matches!(
        response["session"]["coverage"]["state"].as_str(),
        Some("complete" | "partial")
    ));

    let history = search::list(&pool).await.unwrap();
    assert!(
        history["sessions"]
            .as_array()
            .unwrap()
            .iter()
            .any(|session| session["id"] == session_id.to_string())
    );
    search::feedback(
        &pool,
        json!({ "session_id": session_id, "job_id": job_id, "action": "saved" }),
    )
    .await
    .unwrap();
    let feedback: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM search_feedback WHERE session_id = $1 AND job_id = $2 AND action = 'saved'").bind(session_id).bind(job_id).fetch_one(&pool).await.unwrap();
    assert_eq!(feedback, 1);

    sqlx::query("DELETE FROM search_sessions WHERE id = $1")
        .bind(session_id)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("DELETE FROM jobs WHERE id = $1")
        .bind(job_id)
        .execute(&pool)
        .await
        .unwrap();
}
