use anyhow::Result;
use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use sqlx::{Pool, Postgres, Row};
use uuid::Uuid;

const DEFAULT_PAGE_SIZE: i64 = 50;
const MAX_PAGE_SIZE: i64 = 100;
const CURSOR_VERSION: u8 = 1;

#[derive(Clone, Debug, Default, Deserialize)]
pub struct JobSearchQuery {
    pub q: Option<String>,
    pub location: Option<String>,
    pub country_code: Option<String>,
    pub source_id: Option<String>,
    pub employment_type: Option<String>,
    pub max_experience: Option<i16>,
    pub remote: Option<bool>,
    pub no_degree: Option<bool>,
    pub posted_days: Option<i64>,
    pub cursor: Option<String>,
    pub limit: Option<i64>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct SearchJob {
    pub id: Uuid,
    pub source_url: String,
    pub source_name: String,
    pub source_id: String,
    pub canonical_url: String,
    pub apply_url: String,
    pub title: String,
    pub company: String,
    pub location: Option<String>,
    pub country: Option<String>,
    pub remote: bool,
    #[serde(skip_serializing)]
    pub geographic_locations: Value,
    #[serde(skip_serializing)]
    pub remote_policy: Value,
    pub opportunity_classification: Value,
    pub employment_type: Option<String>,
    pub experience_years: Option<i16>,
    pub degree_required: Option<bool>,
    pub salary_min: Option<f64>,
    pub salary_max: Option<f64>,
    pub salary_currency: Option<String>,
    pub date_posted: Option<NaiveDate>,
    pub description_preview: String,
    pub skills: Value,
    pub lifecycle_status: String,
    #[serde(skip_serializing)]
    pub first_seen_at: DateTime<Utc>,
    pub last_verified_at: Option<DateTime<Utc>>,
    #[serde(skip_serializing)]
    pub retrieval_score: i64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct JobDetail {
    pub id: Uuid,
    pub source_url: String,
    pub source_name: String,
    pub source_id: String,
    pub source_job_id: Option<String>,
    pub canonical_url: String,
    pub apply_url: String,
    pub company_domain: Option<String>,
    pub title: String,
    pub company: String,
    pub location: Option<String>,
    pub country: Option<String>,
    pub remote: bool,
    pub geographic_locations: Value,
    pub remote_policy: Value,
    pub opportunity_classification: Value,
    pub employment_type: Option<String>,
    pub experience_years: Option<i16>,
    pub degree_required: Option<bool>,
    pub salary_min: Option<f64>,
    pub salary_max: Option<f64>,
    pub salary_currency: Option<String>,
    pub date_posted: Option<NaiveDate>,
    pub description: String,
    pub skills: Value,
    pub lifecycle_status: String,
    pub first_seen_at: DateTime<Utc>,
    pub last_seen_at: DateTime<Utc>,
    pub last_verified_at: Option<DateTime<Utc>>,
}

#[derive(Clone, Debug, Serialize)]
pub struct JobSearchPage {
    pub jobs: Vec<SearchJob>,
    pub count: i64,
    pub returned: usize,
    pub has_more: bool,
    pub next_cursor: Option<String>,
    pub limit: i64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct SearchCursor {
    version: u8,
    filter_hash: String,
    retrieval_score: i64,
    posted_sort: NaiveDate,
    first_seen_at: DateTime<Utc>,
    id: Uuid,
    total_count: i64,
}

#[derive(Clone, Debug, Serialize)]
struct FilterFingerprint<'a> {
    q: &'a Option<String>,
    location: &'a Option<String>,
    country_code: &'a Option<String>,
    source_id: &'a Option<String>,
    employment_type: &'a Option<String>,
    max_experience: Option<i16>,
    remote: Option<bool>,
    no_degree: Option<bool>,
    posted_days: Option<i64>,
}

#[derive(Clone, Debug)]
pub struct ValidatedJobSearch {
    q: Option<String>,
    location: Option<String>,
    country_code: Option<String>,
    source_id: Option<String>,
    employment_type: Option<String>,
    max_experience: Option<i16>,
    remote: Option<bool>,
    no_degree: Option<bool>,
    posted_days: Option<i64>,
    cursor: Option<SearchCursor>,
    filter_hash: String,
    limit: i64,
}

impl ValidatedJobSearch {
    pub fn query(&self) -> Option<&str> {
        self.q.as_deref()
    }

    pub fn location(&self) -> Option<&str> {
        self.location.as_deref()
    }
}

fn trimmed(
    value: Option<String>,
    max: usize,
    label: &str,
) -> std::result::Result<Option<String>, String> {
    let value = value
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty());
    if value.as_ref().is_some_and(|value| value.len() > max) {
        return Err(format!("{label} is too long"));
    }
    Ok(value)
}

fn filter_hash(input: &FilterFingerprint<'_>) -> String {
    let payload = serde_json::to_vec(input).expect("filter fingerprint is serializable");
    hex::encode(Sha256::digest(payload))[..24].to_owned()
}

fn decode_cursor(
    value: &str,
    expected_filter_hash: &str,
) -> std::result::Result<SearchCursor, String> {
    if value.len() > 1_024 || value.len() % 2 != 0 {
        return Err("cursor is invalid".into());
    }
    let bytes = hex::decode(value).map_err(|_| "cursor is invalid")?;
    let cursor: SearchCursor = serde_json::from_slice(&bytes).map_err(|_| "cursor is invalid")?;
    if cursor.version != CURSOR_VERSION || cursor.filter_hash != expected_filter_hash {
        return Err("cursor does not belong to these search filters".into());
    }
    Ok(cursor)
}

fn encode_cursor(cursor: &SearchCursor) -> String {
    hex::encode(serde_json::to_vec(cursor).expect("search cursor is serializable"))
}

pub fn validate_query(input: JobSearchQuery) -> std::result::Result<ValidatedJobSearch, String> {
    let q = trimmed(input.q, 500, "query")?;
    let location = trimmed(input.location, 200, "location")?;
    let source_id = trimmed(input.source_id, 200, "source_id")?;
    if source_id.as_ref().is_some_and(|value| {
        !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b":_-".contains(&byte))
    }) {
        return Err("source_id is invalid".into());
    }
    let employment_type = trimmed(input.employment_type, 100, "employment_type")?;
    let country_code =
        trimmed(input.country_code, 2, "country_code")?.map(|value| value.to_ascii_uppercase());
    if country_code.as_ref().is_some_and(|value| {
        value.len() != 2 || !value.bytes().all(|byte| byte.is_ascii_uppercase())
    }) {
        return Err("country_code must be an ISO 3166-1 alpha-2 code".into());
    }
    if input
        .max_experience
        .is_some_and(|value| !(0..=50).contains(&value))
    {
        return Err("max_experience must be between 0 and 50".into());
    }
    if input
        .posted_days
        .is_some_and(|value| !(1..=3_650).contains(&value))
    {
        return Err("posted_days must be between 1 and 3650".into());
    }
    let limit = input
        .limit
        .unwrap_or(DEFAULT_PAGE_SIZE)
        .clamp(1, MAX_PAGE_SIZE);
    let fingerprint = FilterFingerprint {
        q: &q,
        location: &location,
        country_code: &country_code,
        source_id: &source_id,
        employment_type: &employment_type,
        max_experience: input.max_experience,
        remote: input.remote,
        no_degree: input.no_degree,
        posted_days: input.posted_days,
    };
    let filter_hash = filter_hash(&fingerprint);
    let cursor = input
        .cursor
        .as_deref()
        .map(|cursor| decode_cursor(cursor, &filter_hash))
        .transpose()?;
    Ok(ValidatedJobSearch {
        q,
        location,
        country_code,
        source_id,
        employment_type,
        max_experience: input.max_experience,
        remote: input.remote,
        no_degree: input.no_degree,
        posted_days: input.posted_days,
        cursor,
        filter_hash,
        limit,
    })
}

pub async fn search(pool: &Pool<Postgres>, input: &ValidatedJobSearch) -> Result<JobSearchPage> {
    let cursor_score = input.cursor.as_ref().map(|cursor| cursor.retrieval_score);
    let cursor_posted = input.cursor.as_ref().map(|cursor| cursor.posted_sort);
    let cursor_seen = input.cursor.as_ref().map(|cursor| cursor.first_seen_at);
    let cursor_id = input.cursor.as_ref().map(|cursor| cursor.id);
    // Shared admission and filter predicate. It is used twice: once for the
    // ranked page and once for the exact total count, so a page never has to
    // materialize the whole match set inside a window function.
    const JOB_FILTER_SQL: &str = r#"
        j.lifecycle_status IN ('active','possibly_closed')
        AND (j.valid_through IS NULL OR j.valid_through >= CURRENT_DATE)
        AND ($1::TEXT IS NULL OR j.search_document @@ search_input.query
             OR j.title % $1::TEXT OR j.company % $1::TEXT)
        AND ($2::TEXT IS NULL OR j.location ILIKE '%' || $2 || '%'
             OR j.country ILIKE '%' || $2 || '%')
        AND ($3::TEXT IS NULL OR j.geographic_locations @>
             JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT('countryCode', $3::TEXT)))
        AND ($4::TEXT IS NULL OR j.source_id = $4)
        AND ($5::TEXT IS NULL OR j.employment_type ILIKE '%' || $5 || '%'
             OR j.opportunity_classification->>'jobType' ILIKE '%' || $5 || '%')
        AND ($6::SMALLINT IS NULL OR j.experience_years IS NULL OR j.experience_years <= $6)
        AND ($7::BOOLEAN IS NULL OR j.remote = $7)
        AND (COALESCE($8::BOOLEAN,FALSE) = FALSE OR j.degree_required IS DISTINCT FROM TRUE)
        AND ($9::BIGINT IS NULL OR j.date_posted IS NULL
             OR j.date_posted >= CURRENT_DATE - ($9 * INTERVAL '1 day'))
    "#;
    let statement = format!(
        r#"
        WITH search_input AS (
          SELECT CASE WHEN $1::TEXT IS NULL THEN NULL
                      ELSE WEBSEARCH_TO_TSQUERY('simple', $1::TEXT) END AS query
        ), ranked AS (
          SELECT j.id,j.source_url,j.source_name,j.source_id,j.canonical_url,j.apply_url,
                 j.title,j.company,j.location,j.country,j.remote,j.geographic_locations,
                 j.remote_policy,j.opportunity_classification,j.employment_type,
                 j.experience_years,j.degree_required,j.salary_min,j.salary_max,
                 j.salary_currency,j.date_posted,LEFT(j.description, 320) AS description_preview,
                 j.skills,j.lifecycle_status,
                 j.first_seen_at,j.last_verified_at,
                 COALESCE(j.date_posted, DATE '0001-01-01') AS posted_sort,
                 CASE WHEN $1::TEXT IS NULL THEN 0::BIGINT ELSE
                   ROUND(
                     TS_RANK(j.search_document, search_input.query, 32) * 1000000
                     + SIMILARITY(j.title, $1::TEXT) * 250000
                     + SIMILARITY(j.company, $1::TEXT) * 100000
                   )::BIGINT
                 END AS retrieval_score
          FROM jobs j CROSS JOIN search_input
          WHERE {JOB_FILTER_SQL}
        ), total AS (
          SELECT COUNT(*)::BIGINT AS total_count
          FROM jobs j CROSS JOIN search_input
          WHERE {JOB_FILTER_SQL}
        )
        SELECT ranked.*, total.total_count FROM ranked CROSS JOIN total
        WHERE $10::BIGINT IS NULL
           OR retrieval_score < $10
           OR (retrieval_score = $10 AND posted_sort < $11::DATE)
           OR (retrieval_score = $10 AND posted_sort = $11::DATE AND first_seen_at < $12::TIMESTAMPTZ)
           OR (retrieval_score = $10 AND posted_sort = $11::DATE AND first_seen_at = $12::TIMESTAMPTZ AND id < $13::UUID)
        ORDER BY retrieval_score DESC,posted_sort DESC,first_seen_at DESC,id DESC
        LIMIT $14
        "#
    );
    let rows = sqlx::query(&statement)
        .bind(input.q.as_deref())
        .bind(input.location.as_deref())
        .bind(input.country_code.as_deref())
        .bind(input.source_id.as_deref())
        .bind(input.employment_type.as_deref())
        .bind(input.max_experience)
        .bind(input.remote)
        .bind(input.no_degree)
        .bind(input.posted_days)
        .bind(cursor_score)
        .bind(cursor_posted)
        .bind(cursor_seen)
        .bind(cursor_id)
        .bind(input.limit + 1)
        .fetch_all(pool)
        .await?;

    let count = rows
        .first()
        .map(|row| row.get::<i64, _>("total_count"))
        .or_else(|| input.cursor.as_ref().map(|cursor| cursor.total_count))
        .unwrap_or(0);
    let has_more = rows.len() > input.limit as usize;
    let jobs = rows
        .into_iter()
        .take(input.limit as usize)
        .map(|row| SearchJob {
            id: row.get("id"),
            source_url: row.get("source_url"),
            source_name: row.get("source_name"),
            source_id: row.get("source_id"),
            canonical_url: row.get("canonical_url"),
            apply_url: row.get("apply_url"),
            title: row.get("title"),
            company: row.get("company"),
            location: row.get("location"),
            country: row.get("country"),
            remote: row.get("remote"),
            geographic_locations: row.get("geographic_locations"),
            remote_policy: row.get("remote_policy"),
            opportunity_classification: row.get("opportunity_classification"),
            employment_type: row.get("employment_type"),
            experience_years: row.get("experience_years"),
            degree_required: row.get("degree_required"),
            salary_min: row.get("salary_min"),
            salary_max: row.get("salary_max"),
            salary_currency: row.get("salary_currency"),
            date_posted: row.get("date_posted"),
            description_preview: row.get("description_preview"),
            skills: row.get("skills"),
            lifecycle_status: row.get("lifecycle_status"),
            first_seen_at: row.get("first_seen_at"),
            last_verified_at: row.get("last_verified_at"),
            retrieval_score: row.get("retrieval_score"),
        })
        .collect::<Vec<_>>();
    let next_cursor = if has_more {
        jobs.last().map(|job| {
            encode_cursor(&SearchCursor {
                version: CURSOR_VERSION,
                filter_hash: input.filter_hash.clone(),
                retrieval_score: job.retrieval_score,
                posted_sort: job.date_posted.unwrap_or(NaiveDate::MIN),
                first_seen_at: job.first_seen_at,
                id: job.id,
                total_count: count,
            })
        })
    } else {
        None
    };
    Ok(JobSearchPage {
        returned: jobs.len(),
        jobs,
        count,
        has_more,
        next_cursor,
        limit: input.limit,
    })
}

pub async fn get_job(pool: &Pool<Postgres>, job_id: Uuid) -> Result<Option<JobDetail>> {
    let row = sqlx::query(
        r#"
        SELECT id,source_url,source_name,source_id,source_job_id,canonical_url,apply_url,
               company_domain,title,company,location,country,remote,
               geographic_locations,remote_policy,opportunity_classification,employment_type,
               experience_years,degree_required,salary_min,salary_max,salary_currency,date_posted,
               description,skills,lifecycle_status,first_seen_at,last_seen_at,last_verified_at
        FROM jobs
        WHERE id = $1
        "#,
    )
    .bind(job_id)
    .fetch_optional(pool)
    .await?;

    Ok(row.map(|row| JobDetail {
        id: row.get("id"),
        source_url: row.get("source_url"),
        source_name: row.get("source_name"),
        source_id: row.get("source_id"),
        source_job_id: row.get("source_job_id"),
        canonical_url: row.get("canonical_url"),
        apply_url: row.get("apply_url"),
        company_domain: row.get("company_domain"),
        title: row.get("title"),
        company: row.get("company"),
        location: row.get("location"),
        country: row.get("country"),
        remote: row.get("remote"),
        geographic_locations: row.get("geographic_locations"),
        remote_policy: row.get("remote_policy"),
        opportunity_classification: row.get("opportunity_classification"),
        employment_type: row.get("employment_type"),
        experience_years: row.get("experience_years"),
        degree_required: row.get("degree_required"),
        salary_min: row.get("salary_min"),
        salary_max: row.get("salary_max"),
        salary_currency: row.get("salary_currency"),
        date_posted: row.get("date_posted"),
        description: row.get("description"),
        skills: row.get("skills"),
        lifecycle_status: row.get("lifecycle_status"),
        first_seen_at: row.get("first_seen_at"),
        last_seen_at: row.get("last_seen_at"),
        last_verified_at: row.get("last_verified_at"),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_bounds_and_binds_cursors_to_filters() {
        let query = validate_query(JobSearchQuery {
            q: Some("  product designer  ".into()),
            country_code: Some("in".into()),
            limit: Some(500),
            ..JobSearchQuery::default()
        })
        .unwrap();
        assert_eq!(query.query(), Some("product designer"));
        assert_eq!(query.country_code.as_deref(), Some("IN"));
        assert_eq!(query.limit, MAX_PAGE_SIZE);

        let cursor = encode_cursor(&SearchCursor {
            version: CURSOR_VERSION,
            filter_hash: query.filter_hash.clone(),
            retrieval_score: 42,
            posted_sort: NaiveDate::from_ymd_opt(2026, 8, 20).unwrap(),
            first_seen_at: Utc::now(),
            id: Uuid::new_v4(),
            total_count: 12,
        });
        assert!(
            validate_query(JobSearchQuery {
                q: Some("product designer".into()),
                country_code: Some("IN".into()),
                cursor: Some(cursor.clone()),
                ..JobSearchQuery::default()
            })
            .is_ok()
        );
        assert!(
            validate_query(JobSearchQuery {
                q: Some("data scientist".into()),
                country_code: Some("IN".into()),
                cursor: Some(cursor),
                ..JobSearchQuery::default()
            })
            .is_err()
        );
    }

    #[test]
    fn rejects_malformed_filters_and_cursors() {
        assert!(
            validate_query(JobSearchQuery {
                country_code: Some("IND".into()),
                ..JobSearchQuery::default()
            })
            .is_err()
        );
        assert!(
            validate_query(JobSearchQuery {
                source_id: Some("https://attacker.invalid".into()),
                ..JobSearchQuery::default()
            })
            .is_err()
        );
        assert!(
            validate_query(JobSearchQuery {
                cursor: Some("not-hex".into()),
                ..JobSearchQuery::default()
            })
            .is_err()
        );
    }
}
