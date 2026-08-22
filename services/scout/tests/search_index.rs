use firstrung_scout::{connect_database, search_index};
use serde_json::json;
use uuid::Uuid;

#[tokio::test]
#[ignore = "requires a disposable PostgreSQL integration database"]
async fn indexed_search_is_filtered_typo_tolerant_and_cursor_stable() {
    let database_url = std::env::var("DATABASE_URL")
        .expect("DATABASE_URL must point to a disposable integration database");
    let pool = connect_database(&database_url).await.unwrap();
    let source_suffix = Uuid::new_v4();
    let source_id = format!("fixture:search-index:{source_suffix}");
    let mut ids = Vec::new();
    for index in 0..5 {
        let id = Uuid::new_v4();
        ids.push(id);
        let country_code = if index < 3 { "IN" } else { "US" };
        let country = if country_code == "IN" {
            "India"
        } else {
            "United States"
        };
        let url = format!("https://fixture.invalid/{source_suffix}/{id}");
        sqlx::query(
            "INSERT INTO jobs (id,source_url,source_name,source_id,source_type,source_job_id,canonical_url,apply_url,identity_key,identity_strategy,title,company,location,country,remote,employment_type,experience_years,degree_required,date_posted,description,skills,raw,geographic_locations,lifecycle_status) \
             VALUES ($1,$2,'Indexed fixture',$3,'fixture',$4,$2,$2,$5,'source_job_id','Quantum Widget Designer','Fixture Search Co',$6,$7,$8,'Internship',$9,$10,CURRENT_DATE-$11::INT,'Design quantum widgets with a distributed product team.','[\"Figma\",\"Research\"]','{}',$12,'active')",
        )
        .bind(id)
        .bind(&url)
        .bind(&source_id)
        .bind(format!("fixture-{index}"))
        .bind(format!("fixture:{source_suffix}:{index}"))
        .bind(format!("City {index}, {country}"))
        .bind(country)
        .bind(index % 2 == 0)
        .bind(index as i16)
        .bind(index == 4)
        .bind(index)
        .bind(json!([{ "countryCode": country_code, "raw": country }]))
        .execute(&pool)
        .await
        .unwrap();
    }
    let long_description = format!(
        "{} Design quantum widgets with a distributed product team.",
        "Evidence-rich fixture text. ".repeat(30)
    );
    sqlx::query("UPDATE jobs SET description=$2 WHERE id=$1")
        .bind(ids[0])
        .bind(&long_description)
        .execute(&pool)
        .await
        .unwrap();
    let closed_id = Uuid::new_v4();
    let closed_url = format!("https://fixture.invalid/{source_suffix}/{closed_id}");
    sqlx::query(
        "INSERT INTO jobs (id,source_url,source_name,source_id,source_type,source_job_id,canonical_url,apply_url,identity_key,identity_strategy,title,company,description,raw,lifecycle_status) \
         VALUES ($1,$2,'Indexed fixture',$3,'fixture','closed',$2,$2,$4,'source_job_id','Quantum Widget Designer','Fixture Search Co','Closed fixture','{}','closed')",
    )
    .bind(closed_id)
    .bind(&closed_url)
    .bind(&source_id)
    .bind(format!("fixture:{source_suffix}:closed"))
    .execute(&pool)
    .await
    .unwrap();

    let first = search_index::search(
        &pool,
        &search_index::validate_query(search_index::JobSearchQuery {
            q: Some("quantum widget".into()),
            source_id: Some(source_id.clone()),
            limit: Some(2),
            ..search_index::JobSearchQuery::default()
        })
        .unwrap(),
    )
    .await
    .unwrap();
    assert_eq!(first.count, 5);
    assert_eq!(first.returned, 2);
    assert!(first.has_more);
    assert!(first.next_cursor.is_some());
    assert!(
        first
            .jobs
            .iter()
            .all(|job| job.description_preview.len() <= 320)
    );
    let detail = search_index::get_job(&pool, ids[0]).await.unwrap().unwrap();
    assert_eq!(detail.description, long_description);
    assert!(detail.description.len() > 600);

    let second = search_index::search(
        &pool,
        &search_index::validate_query(search_index::JobSearchQuery {
            q: Some("quantum widget".into()),
            source_id: Some(source_id.clone()),
            cursor: first.next_cursor.clone(),
            limit: Some(2),
            ..search_index::JobSearchQuery::default()
        })
        .unwrap(),
    )
    .await
    .unwrap();
    let third = search_index::search(
        &pool,
        &search_index::validate_query(search_index::JobSearchQuery {
            q: Some("quantum widget".into()),
            source_id: Some(source_id.clone()),
            cursor: second.next_cursor.clone(),
            limit: Some(2),
            ..search_index::JobSearchQuery::default()
        })
        .unwrap(),
    )
    .await
    .unwrap();
    let paged_ids = first
        .jobs
        .iter()
        .chain(&second.jobs)
        .chain(&third.jobs)
        .map(|job| job.id)
        .collect::<std::collections::HashSet<_>>();
    assert_eq!(paged_ids.len(), 5);
    assert_eq!(third.returned, 1);
    assert!(!third.has_more);

    let india = search_index::search(
        &pool,
        &search_index::validate_query(search_index::JobSearchQuery {
            q: Some("quantum widget".into()),
            source_id: Some(source_id.clone()),
            country_code: Some("IN".into()),
            limit: Some(100),
            ..search_index::JobSearchQuery::default()
        })
        .unwrap(),
    )
    .await
    .unwrap();
    assert_eq!(india.count, 3);

    let typo = search_index::search(
        &pool,
        &search_index::validate_query(search_index::JobSearchQuery {
            q: Some("qantum widget".into()),
            source_id: Some(source_id.clone()),
            limit: Some(100),
            ..search_index::JobSearchQuery::default()
        })
        .unwrap(),
    )
    .await
    .unwrap();
    assert_eq!(typo.count, 5);

    let degree_unfiltered = search_index::search(
        &pool,
        &search_index::validate_query(search_index::JobSearchQuery {
            source_id: Some(source_id.clone()),
            no_degree: Some(false),
            limit: Some(100),
            ..search_index::JobSearchQuery::default()
        })
        .unwrap(),
    )
    .await
    .unwrap();
    let degree_excluded = search_index::search(
        &pool,
        &search_index::validate_query(search_index::JobSearchQuery {
            source_id: Some(source_id.clone()),
            no_degree: Some(true),
            limit: Some(100),
            ..search_index::JobSearchQuery::default()
        })
        .unwrap(),
    )
    .await
    .unwrap();
    assert_eq!(degree_unfiltered.count, 5);
    assert_eq!(degree_excluded.count, 4);

    sqlx::query("DELETE FROM jobs WHERE source_id=$1")
        .bind(&source_id)
        .execute(&pool)
        .await
        .unwrap();
}
