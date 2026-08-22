use chrono::Utc;
use firstrung_scout::{
    connect_database,
    eligibility::{
        CandidateEligibility, CandidateMobility, RemotePolicy, evaluate_candidate,
        parse_remote_policy,
    },
    rank_eval::{
        JudgedCandidate, RankFeatures, RankingMetrics, baseline_score, normalized_retrieval_scores,
        proposed_score, title_features,
    },
    search_index,
};
use sqlx::{Pool, Postgres, Row};
use std::collections::BTreeMap;
use std::time::Instant;
use uuid::Uuid;

const ROLE_QUERY: &str = "quantum widget designer";

struct FixtureJob {
    key: &'static str,
    title: &'static str,
    company: &'static str,
    location: Option<&'static str>,
    country: Option<&'static str>,
    remote: bool,
    posted_days_ago: i32,
    description: String,
    gain: u8,
}

fn fixture_jobs() -> Vec<FixtureJob> {
    vec![
        FixtureJob {
            key: "perfect_fit",
            title: "Quantum Widget Designer",
            company: "Perfect Fit Labs",
            location: Some("Mountain View, United States"),
            country: Some("US"),
            remote: true,
            posted_days_ago: 2,
            description: "Design quantum widgets end to end. You will join a distributed product team building the flagship quantum widget designer platform used by hardware teams everywhere. This role is restricted to candidates in the United States.".into(),
            gain: 3,
        },
        FixtureJob {
            key: "senior_widgetworks",
            title: "Senior Quantum Widget Designer",
            company: "WidgetWorks",
            location: Some("Austin, United States"),
            country: Some("US"),
            remote: true,
            posted_days_ago: 9,
            description: "Senior quantum widget designer role. Own the quantum widget designer surface across web and desktop while mentoring two designers. This role is restricted to candidates in the United States.".into(),
            gain: 3,
        },
        FixtureJob {
            key: "lead_designhub",
            title: "Quantum Widget Design Lead",
            company: "DesignHub",
            location: Some("New York, United States"),
            country: Some("US"),
            remote: true,
            posted_days_ago: 15,
            description: "Lead designer for the quantum widget suite. Guide three designers shipping quantum widget experiences each quarter. This role is restricted to candidates in the United States.".into(),
            gain: 2,
        },
        FixtureJob {
            key: "junior_juniorjoy",
            title: "Junior Widget Designer",
            company: "JuniorJoy",
            location: Some("Denver, United States"),
            country: Some("US"),
            remote: true,
            posted_days_ago: 1,
            description: "Junior widget designer supporting our quantum education program. Craft widget lessons that explain quantum basics with every designer mentor. This role is restricted to candidates in the United States.".into(),
            gain: 2,
        },
        FixtureJob {
            key: "writer_sciencepen",
            title: "Quantum Physics Content Writer",
            company: "SciencePen",
            location: Some("Boston, United States"),
            country: Some("US"),
            remote: true,
            posted_days_ago: 30,
            description: "Writer covering quantum physics topics. Interview each widget designer on staff and turn their quantum notes into guides. This role is restricted to candidates in the United States.".into(),
            gain: 1,
        },
        FixtureJob {
            key: "supervisor_factoryrow",
            title: "Widget Factory Line Supervisor",
            company: "FactoryRow",
            location: Some("Pune, India"),
            country: Some("IN"),
            remote: true,
            posted_days_ago: 45,
            description: "Supervise the widget factory line. Coordinate quantum component intake with every designer station in Pune. Work remotely from anywhere in the world.".into(),
            gain: 1,
        },
        FixtureJob {
            key: "platform_unknowngeo",
            title: "Quantum Widget Platform Engineer",
            company: "UnknownGeo Corp",
            location: None,
            country: None,
            remote: false,
            posted_days_ago: 60,
            description: "Platform engineer for the quantum widget designer infrastructure that every designer and widget team depends on.".into(),
            gain: 2,
        },
        FixtureJob {
            key: "marketing_hypewave",
            title: "Growth Marketing Manager",
            company: "HypeWave",
            location: Some("Seattle, United States"),
            country: Some("US"),
            remote: true,
            posted_days_ago: 5,
            description: "Growth marketing manager for consumer apps. Our team once shipped an internal quantum widget designer toolkit, and those acquisition lessons now power every campaign. This role is restricted to candidates in the United States.".into(),
            gain: 0,
        },
        FixtureJob {
            key: "courses_learnfast",
            title: "Course Catalog Publisher",
            company: "LearnFast",
            location: Some("Online, United States"),
            country: Some("US"),
            remote: true,
            posted_days_ago: 3,
            description: "Course catalog publisher. Study every quantum widget designer case study: quantum widget designer fundamentals, quantum widget designer studio tours, and quantum widget designer critique sessions.".into(),
            gain: 0,
        },
        FixtureJob {
            key: "dup_a_duplicorp",
            title: "Quantum Widget Designer",
            company: "DupliCorp",
            location: Some("Chicago, United States"),
            country: Some("US"),
            remote: true,
            posted_days_ago: 6,
            description: "Own quantum widget features for enterprise buyers as our next quantum widget designer. This role is restricted to candidates in the United States.".into(),
            gain: 2,
        },
        FixtureJob {
            key: "dup_b_duplicorp",
            title: "quantum widget designer",
            company: "DupliCorp",
            location: Some("Remote, United States"),
            country: Some("US"),
            remote: true,
            posted_days_ago: 6,
            description: "Support quantum widget integrations as a quantum widget designer serving mid-market clients. This role is restricted to candidates in the United States.".into(),
            gain: 2,
        },
        FixtureJob {
            key: "excluded_nous_labs",
            title: "Quantum Widget Designer",
            company: "NoUS Labs",
            location: Some("Portland, United States"),
            country: Some("US"),
            remote: true,
            posted_days_ago: 4,
            description: "Build quantum widget designer tooling for international markets. This role is not available in the United States.".into(),
            gain: 0,
        },
        FixtureJob {
            key: "timezone_clockwork",
            title: "Quantum Widget Designer",
            company: "Clockwork Labs",
            location: Some("Sydney, Australia"),
            country: Some("AU"),
            remote: true,
            posted_days_ago: 7,
            description: "Join our APAC squad as a quantum widget designer; core collaboration hours run UTC+9 to UTC+11.".into(),
            gain: 0,
        },
        FixtureJob {
            key: "stale_legacycorp",
            title: "Quantum Widget Designer II",
            company: "LegacyCorp",
            location: Some("Remote, United States"),
            country: Some("US"),
            remote: true,
            posted_days_ago: 300,
            description: "Maintain the classic quantum widget designer workflow relied on by long-running widget accounts. This role is restricted to candidates in the United States.".into(),
            gain: 2,
        },
    ]
}

fn evaluation_mobility() -> CandidateMobility {
    CandidateMobility {
        residence_country_code: Some("US".into()),
        citizenship_country_codes: vec!["US".into()],
        work_authorized_country_codes: vec!["US".into()],
        preferred_country_codes: vec!["US".into(), "IN".into()],
        excluded_country_codes: vec!["CN".into()],
        preferred_timezones: vec!["America/New_York".into(), "Asia/Kolkata".into()],
        willing_to_relocate: false,
        ..CandidateMobility::default()
    }
}

fn query_terms(query: &str) -> Vec<String> {
    const STOP: &[&str] = &[
        "and",
        "the",
        "for",
        "with",
        "entry",
        "level",
        "opportunities",
    ];
    query
        .split(|character: char| !character.is_alphanumeric())
        .map(str::to_lowercase)
        .filter(|term| term.len() >= 3 && !STOP.contains(&term.as_str()))
        .collect()
}

async fn retrieve_fixture_pool(
    pool: &Pool<Postgres>,
    source_id: &str,
) -> Vec<search_index::SearchJob> {
    let mut candidates = Vec::new();
    let mut cursor = None;
    loop {
        let validated = search_index::validate_query(search_index::JobSearchQuery {
            q: Some(ROLE_QUERY.into()),
            source_id: Some(source_id.to_owned()),
            cursor: cursor.clone(),
            limit: Some(100),
            ..search_index::JobSearchQuery::default()
        })
        .unwrap();
        let page = search_index::search(pool, &validated).await.unwrap();
        candidates.extend(page.jobs);
        cursor = page.next_cursor;
        if !page.has_more || cursor.is_none() || candidates.len() >= 1_000 {
            break;
        }
    }
    candidates
}

#[tokio::test]
#[ignore = "requires a disposable PostgreSQL integration database"]
async fn curated_fixture_corpus_evaluates_baseline_and_proposed_rankers() {
    let database_url = std::env::var("DATABASE_URL")
        .expect("DATABASE_URL must point to a disposable integration database");
    let pool = connect_database(&database_url).await.unwrap();
    let source_id = format!("fixture:rank-eval:{}", Uuid::new_v4());

    let fixtures = fixture_jobs();
    let mut keys_by_id = BTreeMap::new();
    let mut gains_by_key = BTreeMap::new();
    for job in &fixtures {
        let id = Uuid::new_v4();
        let url = format!("https://fixture.invalid/{source_id}/{}", job.key);
        sqlx::query(
            "INSERT INTO jobs (id,source_url,source_name,source_id,source_type,source_job_id,canonical_url,apply_url,identity_key,identity_strategy,title,company,location,country,remote,date_posted,description,skills,raw,remote_policy,lifecycle_status) \
             VALUES ($1,$2,'Rank eval fixture',$3,'fixture',$4,$2,$2,$5,'source_job_id',$6,$7,$8,$9,$10,CURRENT_DATE-$11::INT,$12,'[]','{}','-1'::JSONB,'active')",
        )
        .bind(id)
        .bind(&url)
        .bind(&source_id)
        .bind(job.key)
        .bind(format!("fixture:{source_id}:{}", job.key))
        .bind(job.title)
        .bind(job.company)
        .bind(job.location)
        .bind(job.country)
        .bind(job.remote)
        .bind(job.posted_days_ago)
        .bind(&job.description)
        .execute(&pool)
        .await
        .unwrap();
        keys_by_id.insert(id, job.key);
        gains_by_key.insert(job.key.to_owned(), job.gain);
    }

    let retrieval_started = Instant::now();
    let candidates = retrieve_fixture_pool(&pool, &source_id).await;
    let retrieval_ms = retrieval_started.elapsed().as_millis();

    assert_eq!(
        candidates.len(),
        fixtures.len(),
        "retrieval should observe every active fixture listing"
    );

    let terms = query_terms(ROLE_QUERY);
    let mobility = evaluation_mobility();
    let today = Utc::now().date_naive();

    let mut statuses = BTreeMap::new();
    let mut surviving = Vec::new();
    let mut disqualified_ids = Vec::new();
    for job in &candidates {
        let stored_policy: Option<serde_json::Value> =
            sqlx::query("SELECT remote_policy FROM jobs WHERE id = $1")
                .bind(job.id)
                .fetch_one(&pool)
                .await
                .unwrap()
                .get::<Option<serde_json::Value>, _>("remote_policy");
        let parsed =
            stored_policy.and_then(|value| serde_json::from_value::<RemotePolicy>(value).ok());
        let policy = parsed.unwrap_or_else(|| {
            parse_remote_policy(
                job.location.as_deref(),
                &job.description_preview,
                job.remote,
            )
        });
        let decision = evaluate_candidate(&mobility, &policy);
        statuses.insert(job.id, decision.status.clone());
        if matches!(
            decision.status,
            CandidateEligibility::Excluded | CandidateEligibility::TimezoneMismatch
        ) {
            disqualified_ids.push(job.id);
            continue;
        }
        surviving.push(job);
    }

    assert_eq!(
        disqualified_ids.len(),
        2,
        "both disqualifier fixtures must be caught deterministically"
    );
    for id in &disqualified_ids {
        assert!(
            matches!(
                statuses[id],
                CandidateEligibility::Excluded | CandidateEligibility::TimezoneMismatch
            ),
            "disqualified fixture must classify as excluded or timezone mismatch"
        );
    }
    let unknown_status = statuses
        .iter()
        .find(|(id, _)| keys_by_id[id] == "platform_unknowngeo")
        .map(|(_, status)| status.clone())
        .unwrap();
    assert_eq!(
        unknown_status,
        CandidateEligibility::Unclear,
        "missing location evidence must remain unclear"
    );

    let raw_scores = surviving
        .iter()
        .map(|job| job.retrieval_score)
        .collect::<Vec<_>>();
    let normalized = normalized_retrieval_scores(&raw_scores);

    let mut ranked_baseline = Vec::new();
    let mut ranked_proposed = Vec::new();
    for (index, job) in surviving.iter().enumerate() {
        let lowercase_title = job.title.to_lowercase();
        let (hits, exact) = title_features(&lowercase_title, &terms);
        let age_days = job
            .date_posted
            .map(|posted| (today - posted).num_days().max(0));
        let features = RankFeatures {
            title_term_hits: hits,
            title_term_total: terms.len(),
            exact_query_in_title: exact,
            retrieval_relevance: normalized[index],
            age_days,
        };
        let adjustment = match statuses[&job.id] {
            CandidateEligibility::Confirmed => 12.0,
            CandidateEligibility::Likely => 6.0,
            CandidateEligibility::Unclear => -5.0,
            CandidateEligibility::RequiresSponsorship
            | CandidateEligibility::RequiresRelocation
            | CandidateEligibility::RequiresOfficeAttendance => -10.0,
            CandidateEligibility::Excluded | CandidateEligibility::TimezoneMismatch => -100.0,
        };
        let judged = JudgedCandidate {
            job_id: job.id,
            gain: gains_by_key[keys_by_id[&job.id]],
            hard_disqualified: false,
            duplicate_of_higher_ranked: false,
            unknown_eligibility: statuses[&job.id] == CandidateEligibility::Unclear,
        };
        ranked_baseline.push((baseline_score(&features, adjustment), judged.clone()));
        ranked_proposed.push((proposed_score(&features, adjustment), judged));
    }

    let listing_keys = surviving
        .iter()
        .map(|job| {
            (
                job.id,
                format!(
                    "{}|{}",
                    job.title.trim().to_lowercase(),
                    job.company.trim().to_lowercase()
                ),
            )
        })
        .collect::<BTreeMap<_, _>>();

    fn sort_ranked(ranked: &mut [(f64, JudgedCandidate)]) {
        ranked.sort_by(|left, right| {
            right
                .0
                .partial_cmp(&left.0)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| left.1.job_id.cmp(&right.1.job_id))
        });
    }

    fn mark_duplicates(
        ranked: &mut [(f64, JudgedCandidate)],
        listing_keys: &BTreeMap<Uuid, String>,
    ) -> usize {
        let mut seen = std::collections::BTreeSet::new();
        let mut marked = 0;
        for (_, candidate) in ranked.iter_mut() {
            let listing = &listing_keys[&candidate.job_id];
            if !seen.insert(listing.clone()) {
                candidate.duplicate_of_higher_ranked = true;
                marked += 1;
            }
        }
        marked
    }

    sort_ranked(&mut ranked_baseline);
    sort_ranked(&mut ranked_proposed);
    let baseline_duplicates_total = mark_duplicates(&mut ranked_baseline, &listing_keys);
    let proposed_duplicates_total = mark_duplicates(&mut ranked_proposed, &listing_keys);
    assert_eq!(
        baseline_duplicates_total, 1,
        "exactly one duplicate-pair member must be marked in the full baseline ranking"
    );
    assert_eq!(
        proposed_duplicates_total, 1,
        "exactly one duplicate-pair member must be marked in the full proposed ranking"
    );

    let total_relevant = gains_by_key.values().filter(|gain| **gain >= 1).count();
    let pool_gains = surviving
        .iter()
        .map(|job| gains_by_key[keys_by_id[&job.id]])
        .collect::<Vec<_>>();

    let baseline_metrics_at = |k: usize| {
        RankingMetrics::compute(
            &ranked_baseline
                .iter()
                .map(|(_, c)| c.clone())
                .collect::<Vec<_>>(),
            k,
            total_relevant,
            &pool_gains,
        )
    };
    let proposed_metrics_at = |k: usize| {
        RankingMetrics::compute(
            &ranked_proposed
                .iter()
                .map(|(_, c)| c.clone())
                .collect::<Vec<_>>(),
            k,
            total_relevant,
            &pool_gains,
        )
    };

    let baseline_five = baseline_metrics_at(5);
    let baseline_ten = baseline_metrics_at(10);
    let proposed_five = proposed_metrics_at(5);
    let proposed_ten = proposed_metrics_at(10);

    println!("\n=== RoleAtlas offline ranking evaluation ===");
    println!(
        "query: {ROLE_QUERY:?}; pool after eligibility filter: {} of {} fixtures; relevant: {total_relevant}",
        pool_gains.len(),
        fixtures.len()
    );
    println!("indexed retrieval latency for the full pool: {retrieval_ms} ms");
    for (name, five, ten) in [
        ("baseline", &baseline_five, &baseline_ten),
        ("proposed", &proposed_five, &proposed_ten),
    ] {
        println!(
            "{name} @5: P {:.3} R {:.3} MRR {:.3} NDCG {:.3} leak {} dup {} unknown {}",
            five.precision_at_k,
            five.recall_at_k,
            five.reciprocal_rank,
            five.ndcg_at_k,
            five.hard_disqualifier_leakage,
            five.duplicates_in_top_k,
            five.unknown_in_top_k,
        );
        println!(
            "{name} @10: P {:.3} R {:.3} MRR {:.3} NDCG {:.3} leak {} dup {} unknown {}",
            ten.precision_at_k,
            ten.recall_at_k,
            ten.reciprocal_rank,
            ten.ndcg_at_k,
            ten.hard_disqualifier_leakage,
            ten.duplicates_in_top_k,
            ten.unknown_in_top_k,
        );
    }
    for (name, ranked) in [
        ("baseline", &ranked_baseline),
        ("proposed", &ranked_proposed),
    ] {
        println!("{name} ranked order:");
        for (position, (score, candidate)) in ranked.iter().enumerate().take(12) {
            println!(
                "  {:>2}. {:<26} gain {} score {:.1}",
                position + 1,
                keys_by_id[&candidate.job_id],
                candidate.gain,
                score
            );
        }
    }

    for (name, metrics_ten) in [("baseline", &baseline_ten), ("proposed", &proposed_ten)] {
        assert_eq!(
            metrics_ten.hard_disqualifier_leakage, 0,
            "{name}: hard-disqualifier leakage must remain zero"
        );
        assert!(
            metrics_ten.ndcg_at_k > 0.2,
            "{name}: a sane ranker must separate relevant from irrelevant listings"
        );
    }
    assert!(
        proposed_ten.ndcg_at_k >= baseline_ten.ndcg_at_k * 0.95,
        "proposed blend must stay within 5% of baseline NDCG@10 before any adoption discussion"
    );

    sqlx::query("DELETE FROM jobs WHERE source_id=$1")
        .bind(&source_id)
        .execute(&pool)
        .await
        .unwrap();
}
