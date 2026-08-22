use firstrung_scout::connect_database;
use serde_json::json;
use uuid::Uuid;

#[tokio::test]
#[ignore = "requires a disposable PostgreSQL integration database"]
async fn migration_16_upgrades_the_pre_index_schema_without_losing_product_data() {
    let database_url = std::env::var("DATABASE_URL")
        .expect("DATABASE_URL must point to a disposable integration database");
    let pool = connect_database(&database_url).await.unwrap();
    let user_id = Uuid::parse_str("00000000-0000-4000-8000-000000000001").unwrap();
    let profile_id = Uuid::new_v4();
    let job_id = Uuid::new_v4();

    sqlx::query(
        "INSERT INTO candidate_profiles (id,user_id,profile,source_file) VALUES ($1,$2,$3,'migration-16-fixture')",
    )
    .bind(profile_id)
    .bind(user_id)
    .bind(json!({ "name": "Migration fixture" }))
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO jobs (id,source_url,source_name,source_id,source_type,canonical_url,apply_url,identity_key,identity_strategy,title,company,description,raw,lifecycle_status) \
         VALUES ($1,$2,'Migration fixture','fixture:migration-16','fixture',$2,$2,$3,'canonical_url','Migration Search Engineer','RoleAtlas Fixture','Persistent migration evidence','{}','active')",
    )
    .bind(job_id)
    .bind(format!("https://fixture.invalid/migration-16/{job_id}"))
    .bind(format!("fixture:migration-16:{job_id}"))
    .execute(&pool)
    .await
    .unwrap();

    for index in [
        "jobs_search_document_gin_idx",
        "jobs_title_trgm_idx",
        "jobs_company_trgm_idx",
        "jobs_location_trgm_idx",
        "jobs_active_cursor_idx",
        "jobs_active_source_cursor_idx",
        "jobs_active_remote_experience_idx",
    ] {
        sqlx::query(&format!("DROP INDEX IF EXISTS {index}"))
            .execute(&pool)
            .await
            .unwrap();
    }
    sqlx::query("ALTER TABLE jobs DROP COLUMN search_document")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("DELETE FROM _sqlx_migrations WHERE version=16")
        .execute(&pool)
        .await
        .unwrap();

    sqlx::migrate!("./migrations").run(&pool).await.unwrap();

    let migration_applied: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM _sqlx_migrations WHERE version=16 AND success=TRUE)",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    let profile_preserved: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM candidate_profiles WHERE id=$1 AND user_id=$2)",
    )
    .bind(profile_id)
    .bind(user_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let indexed_job_preserved: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM jobs WHERE id=$1 AND search_document @@ WEBSEARCH_TO_TSQUERY('simple','Migration Search Engineer'))",
    )
    .bind(job_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let expected_indexes: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM pg_indexes WHERE tablename='jobs' AND indexname = ANY($1::TEXT[])",
    )
    .bind([
        "jobs_search_document_gin_idx",
        "jobs_title_trgm_idx",
        "jobs_company_trgm_idx",
        "jobs_location_trgm_idx",
        "jobs_active_cursor_idx",
        "jobs_active_source_cursor_idx",
        "jobs_active_remote_experience_idx",
    ])
    .fetch_one(&pool)
    .await
    .unwrap();

    assert!(migration_applied);
    assert!(profile_preserved);
    assert!(indexed_job_preserved);
    assert_eq!(expected_indexes, 7);

    sqlx::query("DELETE FROM candidate_profiles WHERE id=$1")
        .bind(profile_id)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("DELETE FROM jobs WHERE id=$1")
        .bind(job_id)
        .execute(&pool)
        .await
        .unwrap();
}
