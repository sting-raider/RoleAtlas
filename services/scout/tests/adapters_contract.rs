//! Adapter contract tests over recorded public-endpoint fixtures.
//!
//! Each fixture is a trimmed snapshot of a real public ATS board payload shape.
//! The contract under test is the reconciliation invariant: every job extracted
//! from a board endpoint must resolve to the same `source_id` that the endpoint
//! itself resolves to, so `frontier::save_result` reconciliation and
//! complete-source-scan closure stay consistent for that adapter.

use firstrung_scout::extract::extract_jobs;
use firstrung_scout::identity;
use firstrung_scout::models::NormalizedJob;

const LEVER_BOARD: &str = include_str!("fixtures/lever/board.json");
const LEVER_ENDPOINT: &str = "https://api.lever.co/v0/postings/acme-fixture?mode=json";
const RECRUITEE_BOARD: &str = include_str!("fixtures/recruitee/offers.json");
const RECRUITEE_ENDPOINT: &str = "https://acme-fixture.recruitee.com/api/offers/";

fn contract(endpoint: &str, body: &str) -> Vec<NormalizedJob> {
    let url = url::Url::parse(endpoint).expect("fixture endpoint parses");
    let jobs = extract_jobs(body, &url);
    assert!(!jobs.is_empty(), "{endpoint} must extract at least one job");
    let source = identity::identify_source_url(endpoint);
    assert!(
        source.complete_scan,
        "{endpoint} must be recognized as a complete board scan"
    );
    for job in &jobs {
        let job_identity = identity::identify_job(job);
        assert_eq!(
            job_identity.source_id, source.id,
            "job {} must reconcile into the board namespace",
            job.title
        );
        assert_ne!(
            job.source_url, endpoint,
            "job {} must carry a real posting URL, not the API endpoint",
            job.title
        );
        let again = NormalizedJob::stable_id(&job.source_url, &job.title, &job.company);
        assert_eq!(job.id, again, "stable_id must be deterministic");
    }
    jobs
}

#[test]
fn lever_board_fixture_satisfies_the_adapter_contract() {
    let jobs = contract(LEVER_ENDPOINT, LEVER_BOARD);
    assert_eq!(jobs.len(), 2);

    let onsite = jobs
        .iter()
        .find(|job| job.title == "Software Engineering Intern")
        .expect("onsite fixture job");
    assert_eq!(onsite.company, "Acme Fixture");
    assert_eq!(onsite.location.as_deref(), Some("Bengaluru, India"));
    assert_eq!(onsite.country.as_deref(), Some("India"));
    assert_eq!(onsite.employment_type.as_deref(), Some("Internship"));
    assert!(!onsite.remote);
    assert_eq!(onsite.degree_required, Some(false));
    assert!(onsite.salary_min.is_none());

    let remote = jobs
        .iter()
        .find(|job| job.title == "Remote Support Engineer")
        .expect("remote fixture job");
    // workplaceType is remote evidence even when the location string is the
    // only other hint.
    assert!(remote.remote);
    assert_eq!(remote.salary_min, Some(144000.0));
    assert_eq!(remote.salary_max, Some(192000.0));
    assert_eq!(remote.salary_currency.as_deref(), Some("PLN"));
}

#[test]
fn recruitee_board_fixture_satisfies_the_adapter_contract() {
    let jobs = contract(RECRUITEE_ENDPOINT, RECRUITEE_BOARD);
    assert_eq!(jobs.len(), 2);

    let analyst = jobs
        .iter()
        .find(|job| job.title == "Junior Data Analyst")
        .expect("berlin fixture job");
    assert_eq!(analyst.company, "Acme Fixture");
    assert_eq!(analyst.location.as_deref(), Some("Berlin, Germany"));
    assert_eq!(analyst.country.as_deref(), Some("Germany"));
    assert!(!analyst.remote);
    assert_eq!(
        analyst.employment_type.as_deref(),
        Some("fulltime permanent")
    );
    assert_eq!(analyst.degree_required, Some(false));
    assert_eq!(
        analyst.source_url,
        "https://acme-fixture.recruitee.com/o/junior-data-analyst"
    );

    let designer = jobs
        .iter()
        .find(|job| job.title == "Remote Content Designer")
        .expect("remote fixture job");
    assert!(designer.remote);
    assert_eq!(designer.salary_min, Some(5200.0));
    assert_eq!(designer.salary_max, Some(6800.0));
    assert_eq!(designer.salary_currency.as_deref(), Some("EUR"));
    assert_eq!(
        designer.valid_through,
        chrono::NaiveDate::from_ymd_opt(2026, 10, 20),
        "close_at must populate valid_through so expiry admission works"
    );
}

#[test]
fn recruitee_detail_pages_never_claim_complete_scans() {
    let source =
        identity::identify_source_url("https://acme-fixture.recruitee.com/o/junior-data-analyst");
    assert_eq!(source.source_type, "company_site");
    assert!(!source.complete_scan);
}
