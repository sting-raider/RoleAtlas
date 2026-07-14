use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CrawlTask {
    pub url: String,
    pub depth: u16,
    pub discovered_from: Option<String>,
    pub queued_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CrawlStatus {
    Success,
    BlockedByRobots,
    UnsupportedContent,
    HttpError(u16),
    FetchError(String),
    BodyTooLarge,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CrawlResult {
    pub task: CrawlTask,
    pub status: CrawlStatus,
    pub fetched_at: DateTime<Utc>,
    pub canonical_url: String,
    pub content_hash: Option<String>,
    pub content_bytes: usize,
    pub discovered_urls: Vec<String>,
    pub jobs: Vec<NormalizedJob>,
    pub elapsed_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NormalizedJob {
    pub id: Uuid,
    pub source_url: String,
    pub source_name: String,
    pub title: String,
    pub company: String,
    pub location: Option<String>,
    pub country: Option<String>,
    pub remote: bool,
    pub employment_type: Option<String>,
    pub experience_years: Option<i16>,
    pub degree_required: Option<bool>,
    pub salary_min: Option<f64>,
    pub salary_max: Option<f64>,
    pub salary_currency: Option<String>,
    pub date_posted: Option<NaiveDate>,
    pub valid_through: Option<NaiveDate>,
    pub description: String,
    pub skills: Vec<String>,
    pub raw: Value,
}

impl NormalizedJob {
    pub fn stable_id(source_url: &str, title: &str, company: &str) -> Uuid {
        let identity = format!("{source_url}|{title}|{company}");
        Uuid::new_v5(&Uuid::NAMESPACE_URL, identity.as_bytes())
    }
}
