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
        headers.insert(header::ACCEPT, header::HeaderValue::from_static("text/html,application/xhtml+xml;q=0.9,*/*;q=0.2"));
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
        let is_html = response
            .headers()
            .get(header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .map(|value| value.contains("text/html") || value.contains("application/xhtml+xml"))
            .unwrap_or(true);
        if !is_html {
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
        let discovered_urls = discover_job_urls(&html, &canonical);

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
        let payload = serde_json::to_vec(&result)?;
        jetstream.publish(RESULT_SUBJECT, payload.into()).await?.await?;
        message.ack().await.map_err(|error| anyhow::anyhow!(error.to_string()))?;
        info!(url = %result.canonical_url, jobs = result.jobs.len(), links = result.discovered_urls.len(), elapsed_ms = result.elapsed_ms, "crawl complete");
    }
    Ok(())
}
