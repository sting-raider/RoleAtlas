use firstrung_scout::{
    connect_database,
    eligibility::{normalized_locations, parse_remote_policy},
    orchestration, search,
};
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
        "INSERT INTO jobs (id, source_url, source_name, source_id, source_type, canonical_url, apply_url, identity_key, identity_strategy, title, company, location, country, remote, employment_type, experience_years, description, skills, raw, lifecycle_status, is_active, geographic_locations, remote_policy, geography_normalization_version) \
         VALUES ($1,$2,'Fixture','fixture:search','fixture',$2,$2,$3,'canonical_url','Quantum Verification Intern','RoleAtlas Fixture','Remote within India','India',TRUE,'Internship',0,'Quantum verification projects welcome.','[]'::jsonb,'{}'::jsonb,'active',TRUE,$4,$5,1) \
         ON CONFLICT (id) DO UPDATE SET lifecycle_status = 'active', is_active = TRUE, location = EXCLUDED.location, remote = TRUE, geographic_locations = EXCLUDED.geographic_locations, remote_policy = EXCLUDED.remote_policy, geography_normalization_version = 1",
    ).bind(job_id).bind("https://fixture.invalid/jobs/search-session").bind("url:https://fixture.invalid/jobs/search-session")
    .bind(serde_json::to_value(normalized_locations(Some("Remote within India"))).unwrap())
    .bind(serde_json::to_value(parse_remote_policy(Some("Remote within India"), "Quantum verification projects welcome.", true)).unwrap())
    .execute(&pool).await.unwrap();

    let response = search::execute(&pool, json!({ "search_plan": { "roleQueries": ["Quantum Verification"], "locations": ["India"], "jobTypes": ["Internship"], "workModes": [], "maxExperience": 1, "noDegreeRequired": false,
        "mobility": { "residenceCountryCode": "IN", "citizenshipCountryCodes": [], "workAuthorizedCountryCodes": [], "requiresSponsorshipCountryCodes": [], "preferredCountryCodes": ["IN"], "excludedCountryCodes": [], "preferredCities": [], "willingToRelocate": false, "relocationCountryCodes": [], "preferredTimezones": ["Asia/Kolkata"], "maximumTimezoneDifferenceHours": null, "inferredFields": [], "confirmedFields": ["residenceCountryCode"] }
    } })).await.unwrap();
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
    assert_eq!(fixture["eligibility_status"], "confirmed");
    assert_eq!(fixture["eligibility"]["status"], "confirmed");
    assert!(
        fixture["remote_policy"]["evidence"]
            .as_array()
            .is_some_and(|evidence| !evidence.is_empty())
    );
    assert!(response["session"]["coverage"]["configured_sources"].is_number());
    assert!(response["session"]["coverage"]["successful_sources"].is_number());
    assert!(matches!(
        response["session"]["coverage"]["state"].as_str(),
        Some("complete" | "partial")
    ));

    orchestration::select_sources(&pool, session_id)
        .await
        .unwrap();
    orchestration::queue_selected_sources(&pool, None, session_id)
        .await
        .unwrap();
    let expanded = search::get(&pool, session_id).await.unwrap();
    assert_eq!(expanded["queries"][0]["query_text"], "Quantum Verification");
    assert!(
        expanded["execution_counts"]["listings_inspected"]
            .as_i64()
            .is_some_and(|count| count >= 1)
    );
    assert_eq!(
        expanded["execution_counts"]["listings_ranked"],
        expanded["session"]["result_count"]
    );
    assert!(!expanded["source_expansion"].as_array().unwrap().is_empty());
    assert!(
        expanded["source_expansion"]
            .as_array()
            .unwrap()
            .iter()
            .all(|source| matches!(
                source["state"].as_str(),
                Some("fresh" | "scanning" | "deferred")
            ))
    );
    assert!(matches!(
        expanded["session"]["stage"].as_str(),
        Some("completed" | "scanning_sources" | "partial")
    ));
    assert!(
        expanded["session"]["coverage"]["selected_sources"]
            .as_i64()
            .is_some_and(|count| count > 0 && count <= 12)
    );
    assert!(
        expanded["jobs"]
            .as_array()
            .unwrap()
            .iter()
            .any(|job| job["id"] == job_id.to_string())
    );

    let history = search::list(&pool).await.unwrap();
    assert!(
        history["sessions"]
            .as_array()
            .unwrap()
            .iter()
            .any(|session| session["id"] == session_id.to_string())
    );
    let historical = history["sessions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|session| session["id"] == session_id.to_string())
        .unwrap();
    assert_eq!(historical["plan"]["roleQueries"][0], "Quantum Verification");
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
