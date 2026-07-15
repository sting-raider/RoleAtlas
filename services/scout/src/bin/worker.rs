use anyhow::{Context, Result};
use async_nats::jetstream::consumer::pull;
use chrono::Utc;
use firstrung_scout::{
    PENDING_SUBJECT, RESULT_SUBJECT,
    config::ScoutConfig,
    ensure_stream,
    extract::{discover_job_urls, extract_jobs},
    init_tracing,
    models::{CrawlResult, CrawlStatus, CrawlTask},
    robots::RobotsCache,
};
use futures_util::StreamExt;
use reqwest::{Client, header};
use sha2::{Digest, Sha256};
use std::{collections::HashMap, sync::Arc, time::{Duration, Instant}};
use tokio::sync::Mutex;
use tracing::{error, info, warn};
use url::Url;

const RESULT_PAYLOAD_BUDGET: usize = 700 * 1024;

fn chunk_result(result: CrawlResult) -> Vec<CrawlResult> {
    if result.jobs.is_empty() {
        return vec![result];
    }
    let jobs = result.jobs.clone();
    let template = CrawlResult { jobs: Vec::new(), ..result };
    let mut chunks = Vec::new();
    let mut current = template.clone();
    for mut job in jobs {
        if serde_json::to_vec(&job).map(|bytes| bytes.len()).unwrap_or_default() > RESULT_PAYLOAD_BUDGET {
            job.raw = serde_json::Value::Null;
            job.description = job.description.chars().take(120_000).collect();
        }
        current.jobs.push(job);
        let exceeds_budget = serde_json::to_vec(&current).map(|bytes| bytes.len()).unwrap_or(usize::MAX) > RESULT_PAYLOAD_BUDGET;
        if exceeds_budget && current.jobs.len() > 1 {
            let last = current.jobs.pop().expect("current batch contains the appended job");
            chunks.push(current);
            current = CrawlResult { jobs: vec![last], discovered_urls: Vec::new(), ..template.clone() };
        }
    }
    if !current.jobs.is_empty() {
        if !chunks.is_empty() { current.discovered_urls.clear(); }
        chunks.push(current);
    }
    chunks
}

#[derive(Clone)]
struct Crawler {
    client: Client,
    robots: RobotsCache,
    default_delay: Duration,
    max_body_bytes: usize,
    host_gates: Arc<Mutex<HashMap<String, Instant>>>,
}

impl Crawler {
    fn new(config: &ScoutConfig) -> Result<Self> {
        let mut headers = header::HeaderMap::new();
        headers.insert(header::ACCEPT, header::HeaderValue::from_static("text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.2"));
        headers.insert(header::ACCEPT_LANGUAGE, header::HeaderValue::from_static("en-US,en;q=0.8"));
        let client = Client::builder()
            .user_agent(&config.user_agent)
            .default_headers(headers)
            .redirect(reqwest::redirect::Policy::limited(8))
            .timeout(config.request_timeout)
            .build()?;
        Ok(Self {
            robots: RobotsCache::new(client.clone(), config.user_agent.clone()),
            client,
            default_delay: config.crawl_delay,
            max_body_bytes: config.max_body_bytes,
            host_gates: Arc::new(Mutex::new(HashMap::new())),
        })
    }

    async fn crawl(&self, task: CrawlTask) -> CrawlResult {
        let started = Instant::now();
        let parsed = Url::parse(&task.url);
        let Ok(url) = parsed else {
            return failed(task, CrawlStatus::FetchError("invalid URL".into()), started);
        };
        if !matches!(url.scheme(), "http" | "https") {
            return failed(task, CrawlStatus::UnsupportedContent, started);
        }
        if !self.robots.allowed(&url).await {
            return failed(task, CrawlStatus::BlockedByRobots, started);
        }

        self.wait_for_host(&url).await;
        let response = match self.fetch_with_retry(url.clone()).await {
            Ok(response) => response,
            Err(error) => return failed(task, CrawlStatus::FetchError(error.to_string()), started),
        };
        let canonical_url = response.url().to_string();
        let status = response.status();
        if !status.is_success() {
            return CrawlResult {
                task,
                status: CrawlStatus::HttpError(status.as_u16()),
                fetched_at: Utc::now(),
                canonical_url,
                content_hash: None,
                content_bytes: 0,
                discovered_urls: Vec::new(),
                jobs: Vec::new(),
                elapsed_ms: started.elapsed().as_millis() as u64,
            };
        }
        let is_supported = response
            .headers()
            .get(header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .map(|value| value.contains("text/html") || value.contains("application/xhtml+xml") || value.contains("application/json"))
            .unwrap_or(true);
        if !is_supported {
            return CrawlResult {
                task,
                status: CrawlStatus::UnsupportedContent,
                fetched_at: Utc::now(),
                canonical_url,
                content_hash: None,
                content_bytes: 0,
                discovered_urls: Vec::new(),
                jobs: Vec::new(),
                elapsed_ms: started.elapsed().as_millis() as u64,
            };
        }

        let mut stream = response.bytes_stream();
        let mut body = Vec::new();
        while let Some(chunk) = stream.next().await {
            match chunk {
                Ok(chunk) if body.len() + chunk.len() <= self.max_body_bytes => body.extend_from_slice(&chunk),
                Ok(_) => return failed(task, CrawlStatus::BodyTooLarge, started),
                Err(error) => return failed(task, CrawlStatus::FetchError(error.to_string()), started),
            }
        }
        let content_bytes = body.len();
        let content_hash = format!("{:x}", Sha256::digest(&body));
        let html = String::from_utf8_lossy(&body);
        let canonical = Url::parse(&canonical_url).unwrap_or(url);
        let jobs = extract_jobs(&html, &canonical);
        // A job detail page is a terminal crawl result. Following its related-job
        // navigation creates thousands of duplicate frontier entries without adding
        // coverage, so only listing pages are allowed to fan out.
        let discovered_urls = if jobs.is_empty() {
            discover_job_urls(&html, &canonical)
        } else {
            Vec::new()
        };

        CrawlResult {
            task,
            status: CrawlStatus::Success,
            fetched_at: Utc::now(),
            canonical_url,
            content_hash: Some(content_hash),
            content_bytes,
            discovered_urls,
            jobs,
            elapsed_ms: started.elapsed().as_millis() as u64,
        }
    }

    async fn wait_for_host(&self, url: &Url) {
        let Some(host) = url.host_str() else { return };
        let delay = self.robots.crawl_delay(url).await.unwrap_or(self.default_delay).max(self.default_delay);
        let wait = {
            let mut gates = self.host_gates.lock().await;
            let now = Instant::now();
            let ready_at = gates.get(host).copied().unwrap_or(now);
            gates.insert(host.to_string(), now.max(ready_at) + delay);
            ready_at.saturating_duration_since(now)
        };
        if !wait.is_zero() {
            tokio::time::sleep(wait).await;
        }
    }

    async fn fetch_with_retry(&self, url: Url) -> Result<reqwest::Response> {
        let mut delay = Duration::from_millis(450);
        for attempt in 1..=3 {
            match self.client.get(url.clone()).send().await {
                Ok(response) if response.status().as_u16() == 429 || response.status().is_server_error() => {
                    if attempt == 3 { return Ok(response) }
                    warn!(attempt, status = %response.status(), url = %url, "transient response; retrying");
                }
                Ok(response) => return Ok(response),
                Err(error) if attempt == 3 => return Err(error.into()),
                Err(error) => warn!(attempt, %error, url = %url, "request failed; retrying"),
            }
            tokio::time::sleep(delay).await;
            delay *= 2;
        }
        unreachable!()
    }
}

fn failed(task: CrawlTask, status: CrawlStatus, started: Instant) -> CrawlResult {
    let canonical_url = task.url.clone();
    CrawlResult {
        task,
        status,
        fetched_at: Utc::now(),
        canonical_url,
        content_hash: None,
        content_bytes: 0,
        discovered_urls: Vec::new(),
        jobs: Vec::new(),
        elapsed_ms: started.elapsed().as_millis() as u64,
    }
}

#[tokio::main]
async fn main() -> Result<()> {
    init_tracing();
    let config = ScoutConfig::from_env();
    let crawler = Crawler::new(&config)?;
    let client = async_nats::connect(&config.nats_url).await.context("connect to NATS")?;
    let jetstream = async_nats::jetstream::new(client);
    let stream = ensure_stream(&jetstream).await?;
    let consumer = stream
        .get_or_create_consumer(
            "scout-workers",
            pull::Config {
                durable_name: Some("scout-workers".into()),
                filter_subject: PENDING_SUBJECT.into(),
                ack_wait: Duration::from_secs(90),
                max_deliver: 5,
                max_ack_pending: 64,
                ..Default::default()
            },
        )
        .await?;
    let mut messages = consumer.messages().await?;
    info!("scout worker ready");

    while let Some(message) = messages.next().await {
        let message = match message {
            Ok(message) => message,
            Err(error) => {
                error!(%error, "NATS consumer error");
                continue;
            }
        };
        let task: CrawlTask = match serde_json::from_slice(&message.payload) {
            Ok(task) => task,
            Err(error) => {
                error!(%error, "discarding malformed crawl task");
                message.ack().await.map_err(|error| anyhow::anyhow!(error.to_string()))?;
                continue;
            }
        };
        info!(url = %task.url, depth = task.depth, "crawling");
        let result = crawler.crawl(task).await;
        for chunk in chunk_result(result.clone()) {
            let payload = serde_json::to_vec(&chunk)?;
            jetstream.publish(RESULT_SUBJECT, payload.into()).await?.await?;
        }
        message.ack().await.map_err(|error| anyhow::anyhow!(error.to_string()))?;
        info!(url = %result.canonical_url, jobs = result.jobs.len(), links = result.discovered_urls.len(), elapsed_ms = result.elapsed_ms, "crawl complete");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use firstrung_scout::models::NormalizedJob;
    use serde_json::json;
    use uuid::Uuid;

    fn job(index: usize) -> NormalizedJob {
        NormalizedJob {
            id: Uuid::new_v5(&Uuid::NAMESPACE_URL, format!("job-{index}").as_bytes()), source_url: format!("https://example.com/jobs/{index}"), source_name: "Fixture".into(),
            title: format!("Role {index}"), company: "Example".into(), location: None, country: None, remote: false,
            employment_type: None, experience_years: None, degree_required: None, salary_min: None, salary_max: None,
            salary_currency: None, date_posted: None, valid_through: None, description: "x".repeat(80_000), skills: Vec::new(), raw: json!({"id": index}),
        }
    }

    #[test]
    fn chunks_bulk_board_results_below_nats_payload_limit() {
        let result = CrawlResult {
            task: CrawlTask { url: "https://api.example.com/jobs".into(), depth: 0, discovered_from: None, queued_at: Utc::now() },
            status: CrawlStatus::Success, fetched_at: Utc::now(), canonical_url: "https://api.example.com/jobs".into(),
            content_hash: Some("fixture".into()), content_bytes: 2_500_000, discovered_urls: Vec::new(),
            jobs: (0..40).map(job).collect(), elapsed_ms: 100,
        };
        let chunks = chunk_result(result);
        assert!(chunks.len() > 1);
        assert_eq!(chunks.iter().map(|chunk| chunk.jobs.len()).sum::<usize>(), 40);
        assert!(chunks.iter().all(|chunk| serde_json::to_vec(chunk).unwrap().len() < 1_048_576));
    }
}
