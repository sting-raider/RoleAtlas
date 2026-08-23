use chrono::Utc;
use firstrung_scout::{
    connect_database,
    frontier::{begin_source_run, begin_source_run_with_id, save_result},
    models::{CrawlResult, CrawlStatus, NormalizedJob},
};
use serde_json::json;
use uuid::Uuid;

fn result(
    task: firstrung_scout::models::CrawlTask,
    jobs: Vec<NormalizedJob>,
    status: CrawlStatus,
) -> CrawlResult {
    let canonical_url = task.url.clone();
    CrawlResult {
        task,
        status,
        fetched_at: Utc::now(),
        canonical_url,
        content_hash: Some("fixture".into()),
        content_bytes: 2,
        discovered_urls: vec![],
        jobs,
        elapsed_ms: 1,
        chunk_index: 0,
        chunk_count: 1,
    }
}

#[tokio::test]
#[ignore = "requires the local PostgreSQL integration service"]
async fn source_run_receipts_are_idempotent_for_a_stable_request_id() {
    let database_url = std::env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgres://firstrung:firstrung@127.0.0.1:5432/firstrung".into());
    let pool = connect_database(&database_url).await.unwrap();
    let board_url = "https://api.lever.co/v0/postings/roleatlas-idempotency-fixture?mode=json";
    let run_id = Uuid::new_v4();

    let first = begin_source_run_with_id(&pool, board_url, run_id)
        .await
        .unwrap();
    let repeated = begin_source_run_with_id(&pool, board_url, run_id)
        .await
        .unwrap();
    assert_eq!(first.run_id, Some(run_id));
    assert_eq!(repeated.run_id, Some(run_id));
    let persisted: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM source_runs WHERE id = $1")
        .bind(run_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(persisted, 1);

    sqlx::query("DELETE FROM source_runs WHERE id = $1")
        .bind(run_id)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("DELETE FROM sources WHERE id = 'lever:roleatlas idempotency fixture'")
        .execute(&pool)
        .await
        .unwrap();
}

#[tokio::test]
#[ignore = "requires the local PostgreSQL integration service"]
async fn complete_runs_reconcile_but_failed_runs_do_not() {
    let database_url = std::env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgres://firstrung:firstrung@127.0.0.1:5432/firstrung".into());
    let pool = connect_database(&database_url).await.unwrap();
    let board_url = "https://api.lever.co/v0/postings/roleatlas-reconciliation-fixture?mode=json";
    let source_url = "https://jobs.lever.co/roleatlas-reconciliation-fixture/job-1";
    let job_id = Uuid::new_v5(&Uuid::NAMESPACE_URL, source_url.as_bytes());
    let fixture = NormalizedJob {
        id: job_id,
        source_url: source_url.into(),
        source_name: "Lever".into(),
        title: "Fixture Intern".into(),
        company: "RoleAtlas Fixture".into(),
        location: Some("Remote".into()),
        country: None,
        remote: true,
        employment_type: Some("Internship".into()),
        experience_years: Some(0),
        degree_required: None,
        salary_min: None,
        salary_max: None,
        salary_currency: None,
        date_posted: None,
        valid_through: None,
        description: "test".into(),
        skills: vec![],
        raw: json!({"id":"job-1"}),
    };

    let first = begin_source_run(&pool, board_url).await.unwrap();
    save_result(&pool, &result(first, vec![fixture], CrawlStatus::Success))
        .await
        .unwrap();

    let failed = begin_source_run(&pool, board_url).await.unwrap();
    save_result(&pool, &result(failed, vec![], CrawlStatus::HttpError(503)))
        .await
        .unwrap();
    let status: String = sqlx::query_scalar("SELECT lifecycle_status FROM jobs WHERE id = $1")
        .bind(job_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(status, "active");

    let missing_once = begin_source_run(&pool, board_url).await.unwrap();
    save_result(&pool, &result(missing_once, vec![], CrawlStatus::Success))
        .await
        .unwrap();
    let status: String = sqlx::query_scalar("SELECT lifecycle_status FROM jobs WHERE id = $1")
        .bind(job_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(status, "possibly_closed");

    let missing_twice = begin_source_run(&pool, board_url).await.unwrap();
    save_result(&pool, &result(missing_twice, vec![], CrawlStatus::Success))
        .await
        .unwrap();
    let row: (String, bool) =
        sqlx::query_as("SELECT lifecycle_status, is_active FROM jobs WHERE id = $1")
            .bind(job_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(row, ("closed".into(), false));

    sqlx::query("DELETE FROM jobs WHERE id = $1")
        .bind(job_id)
        .execute(&pool)
        .await
        .ok();
    sqlx::query(
        "DELETE FROM source_runs WHERE source_id = 'lever:roleatlas reconciliation fixture'",
    )
    .execute(&pool)
    .await
    .ok();
    sqlx::query("DELETE FROM sources WHERE id = 'lever:roleatlas reconciliation fixture'")
        .execute(&pool)
        .await
        .ok();
}

#[tokio::test]
#[ignore = "requires the local PostgreSQL integration service"]
async fn recruitee_complete_scans_close_missing_jobs_through_the_board_namespace() {
    let database_url = std::env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgres://firstrung:firstrung@127.0.0.1:5432/firstrung".into());
    let pool = connect_database(&database_url).await.unwrap();
    let board_url = "https://roleatlas-reconciliation-fixture.recruitee.com/api/offers/";
    let source_url = "https://roleatlas-reconciliation-fixture.recruitee.com/o/fixture-analyst";
    let job_id = Uuid::new_v5(&Uuid::NAMESPACE_URL, source_url.as_bytes());
    let fixture = NormalizedJob {
        id: job_id,
        source_url: source_url.into(),
        source_name: "Recruitee".into(),
        title: "Fixture Analyst".into(),
        // The board slug names the company on hosted Recruitee boards.
        company: "Roleatlas Reconciliation Fixture".into(),
        location: Some("Berlin, Germany".into()),
        country: Some("Germany".into()),
        remote: false,
        employment_type: Some("fulltime permanent".into()),
        experience_years: Some(0),
        degree_required: None,
        salary_min: None,
        salary_max: None,
        salary_currency: None,
        date_posted: None,
        valid_through: None,
        description: "test".into(),
        skills: vec![],
        raw: json!({"id": 7002001}),
    };

    let first = begin_source_run(&pool, board_url).await.unwrap();
    save_result(&pool, &result(first, vec![fixture], CrawlStatus::Success))
        .await
        .unwrap();

    let missing_once = begin_source_run(&pool, board_url).await.unwrap();
    save_result(&pool, &result(missing_once, vec![], CrawlStatus::Success))
        .await
        .unwrap();
    let status: String = sqlx::query_scalar("SELECT lifecycle_status FROM jobs WHERE id = $1")
        .bind(job_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(status, "possibly_closed");

    let missing_twice = begin_source_run(&pool, board_url).await.unwrap();
    save_result(&pool, &result(missing_twice, vec![], CrawlStatus::Success))
        .await
        .unwrap();
    let row: (String, bool) =
        sqlx::query_as("SELECT lifecycle_status, is_active FROM jobs WHERE id = $1")
            .bind(job_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(row, ("closed".into(), false));

    sqlx::query("DELETE FROM jobs WHERE id = $1")
        .bind(job_id)
        .execute(&pool)
        .await
        .ok();
    sqlx::query(
        "DELETE FROM source_runs WHERE source_id = 'recruitee:roleatlas reconciliation fixture'",
    )
    .execute(&pool)
    .await
    .ok();
    sqlx::query("DELETE FROM sources WHERE id = 'recruitee:roleatlas reconciliation fixture'")
        .execute(&pool)
        .await
        .ok();
}
