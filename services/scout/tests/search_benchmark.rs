//! Repeatable synthetic-scale search benchmark.
//!
//! Seeds a generated canonical job corpus into a disposable PostgreSQL
//! database, executes representative indexed-search shapes repeatedly, and
//! reports per-shape latency percentiles plus one serialized page size. It is
//! an ignored integration test so it never runs in CI by default:
//!
//! ```text
//! $env:DATABASE_URL = "postgres://...disposable..."
//! cargo test --test search_benchmark -- --ignored --nocapture
//! ```
//!
//! `BENCH_JOB_COUNT` (default 10_000) controls the corpus size. Results are
//! printed for manual recording; no absolute performance gate is asserted.

use firstrung_scout::{connect_database, search_index};
use std::time::{Duration, Instant};
use uuid::Uuid;

const ROLES: &[&str] = &[
    "Software Engineer",
    "Product Designer",
    "Data Analyst",
    "Account Executive",
    "Support Specialist",
    "Marketing Manager",
    "Quantum Widget Designer",
];
const COMPANIES: &[&str] = &[
    "Northwind Labs",
    "Acme Systems",
    "Globex Corporation",
    "Initech Solutions",
    "Umbrella Health",
    "Stark Industries",
];
const CITIES: &[(&str, &str)] = &[
    ("Denver", "US"),
    ("Austin", "US"),
    ("Toronto", "CA"),
    ("Berlin", "DE"),
    ("Pune", "IN"),
    ("Sydney", "AU"),
];
const DESCRIPTION: &str = "Join a distributed team building reliable products. You will partner with engineers and designers, own features end to end, and help customers succeed. We value clear communication and steady delivery.";

struct QueryShape {
    label: &'static str,
    q: Option<&'static str>,
    country_code: Option<&'static str>,
    posted_days: Option<i64>,
}

fn query_shapes() -> Vec<QueryShape> {
    vec![
        QueryShape {
            label: "no-query browse",
            q: None,
            country_code: None,
            posted_days: None,
        },
        QueryShape {
            label: "single-term FTS",
            q: Some("engineer"),
            country_code: None,
            posted_days: None,
        },
        QueryShape {
            label: "multi-term AND",
            q: Some("quantum widget designer"),
            country_code: None,
            posted_days: None,
        },
        QueryShape {
            label: "typo trigram fallback",
            q: Some("quantam widget"),
            country_code: None,
            posted_days: None,
        },
        QueryShape {
            label: "country + freshness filter",
            q: Some("designer"),
            country_code: Some("US"),
            posted_days: Some(90),
        },
    ]
}

async fn seed_corpus(pool: &sqlx::Pool<sqlx::Postgres>, source_id: &str, total: usize) {
    const BATCH: usize = 1_000;
    let mut seeded = 0;
    while seeded < total {
        let count = BATCH.min(total - seeded);
        let mut ids = Vec::with_capacity(count);
        let mut source_urls = Vec::with_capacity(count);
        let mut job_ids = Vec::with_capacity(count);
        let mut titles = Vec::with_capacity(count);
        let mut companies = Vec::with_capacity(count);
        let mut locations = Vec::with_capacity(count);
        let mut countries = Vec::with_capacity(count);
        let mut geos = Vec::with_capacity(count);
        let mut days = Vec::with_capacity(count);
        for index in 0..count {
            let ordinal = seeded + index;
            let id = Uuid::new_v4();
            ids.push(id);
            source_urls.push(format!("https://fixture.invalid/{source_id}/{ordinal}"));
            job_ids.push(format!("bench-{ordinal}"));
            let role = ROLES[ordinal % ROLES.len()];
            let (city, country) = CITIES[ordinal % CITIES.len()];
            titles.push(format!("{role} {ordinal}",));
            companies.push(COMPANIES[(ordinal / 7) % COMPANIES.len()]);
            locations.push(format!("{city}, United States"));
            countries.push(country);
            geos.push(format!(
                "[{{\"countryCode\":\"{country}\",\"raw\":\"{city}\"}}]"
            ));
            days.push((ordinal % 400) as i32);
        }
        sqlx::query(
            "INSERT INTO jobs (id,source_url,source_name,source_id,source_type,source_job_id,canonical_url,apply_url,identity_key,identity_strategy,title,company,location,country,remote,date_posted,description,skills,raw,geographic_locations,lifecycle_status) \
             SELECT b.id, b.url, 'Bench fixture', $1, 'fixture', b.job_id, b.url, b.url, b.job_id, 'source_job_id', b.title, b.company, b.location, b.country, b.ordinal % 3 = 0, CURRENT_DATE - b.days, $2, '[]', '{}', b.geo::JSONB, 'active' \
             FROM UNNEST($3::UUID[],$4::TEXT[],$5::TEXT[],$6::TEXT[],$7::TEXT[],$8::TEXT[],$9::TEXT[],$10::INT[],$11::INT[],$12::TEXT[]) \
                  AS b(id,url,job_id,title,company,location,country,days,ordinal,geo)",
        )
        .bind(source_id)
        .bind(DESCRIPTION)
        .bind(&ids)
        .bind(&source_urls)
        .bind(&job_ids)
        .bind(&titles)
        .bind(&companies)
        .bind(&locations)
        .bind(&countries)
        .bind(&days)
        .bind((0..count).map(|index| (seeded + index) as i32).collect::<Vec<_>>())
        .bind(&geos)
        .execute(pool)
        .await
        .unwrap();
        seeded += count;
        println!("seeded {seeded}/{total}");
    }
}

fn percentile(samples: &mut [Duration], fraction: f64) -> Duration {
    samples.sort_unstable();
    let index = ((samples.len() as f64 - 1.0) * fraction).round() as usize;
    samples[index]
}

#[tokio::test]
#[ignore = "requires a disposable PostgreSQL integration database"]
async fn synthetic_corpus_reports_search_latency_percentiles() {
    let database_url = std::env::var("DATABASE_URL")
        .expect("DATABASE_URL must point to a disposable integration database");
    let pool = connect_database(&database_url).await.unwrap();
    let total: usize = std::env::var("BENCH_JOB_COUNT")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(10_000)
        .clamp(100, 200_000);
    let source_id = format!("fixture:bench:{}", Uuid::new_v4());

    println!("\n=== RoleAtlas synthetic search benchmark: {total} jobs ===");
    let seed_started = Instant::now();
    seed_corpus(&pool, &source_id, total).await;
    println!(
        "seed completed in {:.1}s",
        seed_started.elapsed().as_secs_f64()
    );

    for shape in query_shapes() {
        let mut latencies = Vec::new();
        let mut payload_bytes = 0usize;
        let mut last_page_count = 0usize;
        for _ in 0..20 {
            let started = Instant::now();
            let validated = search_index::validate_query(search_index::JobSearchQuery {
                q: shape.q.map(str::to_owned),
                country_code: shape.country_code.map(str::to_owned),
                posted_days: shape.posted_days,
                limit: Some(100),
                ..search_index::JobSearchQuery::default()
            })
            .unwrap();
            let page = search_index::search(&pool, &validated).await.unwrap();
            latencies.push(started.elapsed());
            payload_bytes = serde_json::to_vec(&page.jobs).unwrap().len();
            last_page_count = page.count as usize;
        }
        let p50 = percentile(&mut latencies, 0.50);
        let p95 = percentile(&mut latencies, 0.95);
        println!(
            "{:<26} count {:>7} p50 {:>8.2?} p95 {:>8.2?} page-bytes {:>9}",
            shape.label,
            last_page_count,
            p50.as_millis(),
            p95.as_millis(),
            payload_bytes
        );
    }

    if std::env::var("BENCH_KEEP").ok().as_deref() == Some("1") {
        println!(
            "source id {source_id} retained for plan inspection; remove later with DELETE FROM jobs WHERE source_id='{source_id}'"
        );
    } else {
        sqlx::query("DELETE FROM jobs WHERE source_id=$1")
            .bind(&source_id)
            .execute(&pool)
            .await
            .unwrap();
        println!("source id {source_id} cleaned");
    }
}

/// Seeds the corpus without measuring or cleaning so `EXPLAIN ANALYZE` can be
/// captured against realistic data. Run the main benchmark once with
/// BENCH_KEEP=1, inspect plans, then remove the source manually.
#[tokio::test]
#[ignore = "requires a disposable PostgreSQL integration database"]
async fn seed_only_for_plan_inspection() {
    let database_url = std::env::var("DATABASE_URL")
        .expect("DATABASE_URL must point to a disposable integration database");
    let pool = connect_database(&database_url).await.unwrap();
    let total: usize = std::env::var("BENCH_JOB_COUNT")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(10_000)
        .clamp(100, 200_000);
    let source_id = std::env::var("BENCH_SOURCE_ID")
        .unwrap_or_else(|_| format!("fixture:bench:{}", Uuid::new_v4()));
    println!("seeding {total} jobs under source id {source_id}");
    seed_corpus(&pool, &source_id, total).await;
    println!("done; drop later with DELETE FROM jobs WHERE source_id='{source_id}'");
}
