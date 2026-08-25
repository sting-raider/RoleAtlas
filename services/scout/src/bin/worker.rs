use anyhow::{Context, Result};
use async_nats::jetstream::consumer::pull;
use chrono::Utc;
use firstrung_scout::{
    DEAD_SUBJECT, PENDING_SUBJECT, RESULT_SUBJECT,
    config::ScoutConfig,
    egress::EgressPolicy,
    ensure_stream,
    extract::{discover_job_urls, extract_jobs},
    init_tracing,
    models::{CrawlResult, CrawlStatus, CrawlTask},
    robots::RobotsCache,
};
use futures_util::StreamExt;
use reqwest::{Client, header};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    sync::Arc,
    time::{Duration, Instant},
};
use tokio::sync::Mutex;
use tracing::{error, info, warn};
use url::Url;

const RESULT_PAYLOAD_BUDGET: usize = 700 * 1024;
const REDIRECT_LIMIT: usize = 8;
/// Matches the pull consumer's `max_deliver`; the last delivery also publishes
/// a dead-letter copy so a crash during this attempt still leaves an operator
/// trace and a failed frontier row behind.
const FINAL_DELIVERY_ATTEMPT: i64 = 5;

fn chunk_result(result: CrawlResult) -> Vec<CrawlResult> {
    if result.jobs.is_empty() {
        let mut result = result;
        result.chunk_index = 0;
        result.chunk_count = 1;
        return vec![result];
    }
    let jobs = result.jobs.clone();
    let template = CrawlResult {
        jobs: Vec::new(),
        ..result
    };
    let mut chunks = Vec::new();
    let mut current = template.clone();
    for mut job in jobs {
        if serde_json::to_vec(&job)
            .map(|bytes| bytes.len())
            .unwrap_or_default()
            > RESULT_PAYLOAD_BUDGET
        {
            job.raw = serde_json::Value::Null;
            job.description = job.description.chars().take(120_000).collect();
        }
        current.jobs.push(job);
        let exceeds_budget = serde_json::to_vec(&current)
            .map(|bytes| bytes.len())
            .unwrap_or(usize::MAX)
            > RESULT_PAYLOAD_BUDGET;
        if exceeds_budget && current.jobs.len() > 1 {
            let last = current
                .jobs
                .pop()
                .expect("current batch contains the appended job");
            chunks.push(current);
            current = CrawlResult {
                jobs: vec![last],
                discovered_urls: Vec::new(),
                ..template.clone()
            };
        }
    }
    if !current.jobs.is_empty() {
        if !chunks.is_empty() {
            current.discovered_urls.clear();
        }
        chunks.push(current);
    }
    let chunk_count = chunks.len() as u32;
    for (index, chunk) in chunks.iter_mut().enumerate() {
        chunk.chunk_index = index as u32;
        chunk.chunk_count = chunk_count;
    }
    chunks
}

#[derive(Clone)]
struct Crawler {
    client: Client,
    robots: RobotsCache,
    egress: EgressPolicy,
    default_delay: Duration,
    max_body_bytes: usize,
    host_gates: Arc<Mutex<HashMap<String, Instant>>>,
}

impl Crawler {
    fn new(config: &ScoutConfig) -> Result<Self> {
        Self::with_policy(config, EgressPolicy::from_env())
    }

    fn with_policy(config: &ScoutConfig, egress: EgressPolicy) -> Result<Self> {
        let mut headers = header::HeaderMap::new();
        headers.insert(
            header::ACCEPT,
            header::HeaderValue::from_static(
                "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.2",
            ),
        );
        headers.insert(
            header::ACCEPT_LANGUAGE,
            header::HeaderValue::from_static("en-US,en;q=0.8"),
        );
        // Redirects are followed manually so every hop passes the egress
        // policy (scheme, allowlist, and DNS-resolved public address) before
        // a request is issued.
        let client = Client::builder()
            .user_agent(&config.user_agent)
            .default_headers(headers)
            .redirect(reqwest::redirect::Policy::none())
            .timeout(config.request_timeout)
            .build()?;
        Ok(Self {
            robots: RobotsCache::new(client.clone(), config.user_agent.clone()),
            client,
            egress,
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
        if let Err(reason) = self.egress.validate(&url).await {
            return failed(
                task,
                CrawlStatus::FetchError(format!("blocked by egress policy: {reason}")),
                started,
            );
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
                chunk_index: 0,
                chunk_count: 1,
            };
        }
        let is_supported = response
            .headers()
            .get(header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .map(|value| {
                value.contains("text/html")
                    || value.contains("application/xhtml+xml")
                    || value.contains("application/json")
            })
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
                chunk_index: 0,
                chunk_count: 1,
            };
        }

        let mut stream = response.bytes_stream();
        let mut body = Vec::new();
        while let Some(chunk) = stream.next().await {
            match chunk {
                Ok(chunk) if body.len() + chunk.len() <= self.max_body_bytes => {
                    body.extend_from_slice(&chunk)
                }
                Ok(_) => return failed(task, CrawlStatus::BodyTooLarge, started),
                Err(error) => {
                    return failed(task, CrawlStatus::FetchError(error.to_string()), started);
                }
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
            chunk_index: 0,
            chunk_count: 1,
        }
    }

    async fn wait_for_host(&self, url: &Url) {
        let Some(host) = url.host_str() else { return };
        let delay = self
            .robots
            .crawl_delay(url)
            .await
            .unwrap_or(self.default_delay)
            .max(self.default_delay);
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
            match self.follow_redirects(url.clone()).await {
                Ok(response)
                    if response.status().as_u16() == 429 || response.status().is_server_error() =>
                {
                    if attempt == 3 {
                        return Ok(response);
                    }
                    warn!(attempt, status = %response.status(), url = %url, "transient response; retrying");
                }
                Ok(response) => return Ok(response),
                Err(error) if attempt == 3 => return Err(error),
                Err(error) => warn!(attempt, %error, url = %url, "request failed; retrying"),
            }
            tokio::time::sleep(delay).await;
            delay *= 2;
        }
        unreachable!()
    }

    /// Follows up to `REDIRECT_LIMIT` hops manually, re-validating every
    /// target against the egress policy (which resolves DNS per hop) so a
    /// redirect can never bounce the crawler into a private or disallowed
    /// host.
    async fn follow_redirects(&self, start: Url) -> Result<reqwest::Response> {
        let mut url = start;
        for hop in 0..=REDIRECT_LIMIT {
            self.egress
                .validate(&url)
                .await
                .map_err(|reason| anyhow::anyhow!("blocked by egress policy: {reason}"))?;
            let response = self.client.get(url.clone()).send().await?;
            if !response.status().is_redirection() || hop == REDIRECT_LIMIT {
                return Ok(response);
            }
            let Some(location) = response
                .headers()
                .get(header::LOCATION)
                .and_then(|value| value.to_str().ok())
            else {
                return Ok(response);
            };
            url = url.join(location)?;
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
        chunk_index: 0,
        chunk_count: 1,
    }
}

#[tokio::main]
async fn main() -> Result<()> {
    init_tracing();
    let config = ScoutConfig::from_env();
    let crawler = Crawler::new(&config)?;
    let client = async_nats::connect(&config.nats_url)
        .await
        .context("connect to NATS")?;
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

    'message: while let Some(message) = messages.next().await {
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
                if let Err(ack_error) = message.ack().await {
                    error!(%ack_error, "could not ack malformed crawl task");
                }
                continue;
            }
        };
        info!(url = %task.url, depth = task.depth, "crawling");
        let delivery_attempt = message.info().map(|info| info.delivered).unwrap_or(0);
        if delivery_attempt >= FINAL_DELIVERY_ATTEMPT {
            // This is the last chance: if the worker dies mid-crawl the queue
            // would silently drop the task after this delivery. Publish the
            // snapshot first so the coordinator records it either way.
            let snapshot = serde_json::json!({ "task": task, "attempts": delivery_attempt });
            match serde_json::to_vec(&snapshot) {
                Ok(payload) => {
                    if let Err(error) =
                        publish_and_confirm(&jetstream, DEAD_SUBJECT, payload.into()).await
                    {
                        error!(%error, url = %task.url, "could not publish dead-letter snapshot");
                    }
                }
                Err(error) => {
                    error!(%error, url = %task.url, "could not serialize dead-letter snapshot");
                }
            }
            warn!(url = %task.url, attempts = delivery_attempt, "final delivery attempt");
        }
        let result = crawler.crawl(task.clone()).await;
        // A publish failure must not kill the worker: leave the message
        // unacked so JetStream redelivers it (bounded by max_deliver, whose
        // final attempt re-enters the dead-letter snapshot above) and move on
        // to the next task so one broken publish cannot stall the queue. The
        // failure stays observable through the error log and the redelivery.
        for chunk in chunk_result(result.clone()) {
            let payload = match serde_json::to_vec(&chunk) {
                Ok(payload) => payload,
                Err(error) => {
                    error!(url = %result.task.url, %error, "could not serialize result chunk");
                    continue;
                }
            };
            if let Err(error) =
                publish_and_confirm(&jetstream, RESULT_SUBJECT, payload.into()).await
            {
                error!(url = %result.task.url, %error, "could not publish crawl result; leaving task for redelivery");
                continue 'message;
            }
        }
        if let Err(ack_error) = message.ack().await {
            // The crawl succeeded but the ack did not: JetStream will
            // redeliver and the coordinator's upserts make a re-crawl
            // idempotent, so log and keep serving rather than crash.
            error!(url = %task.url, %ack_error, "could not ack completed crawl");
        }
        info!(url = %result.canonical_url, jobs = result.jobs.len(), links = result.discovered_urls.len(), elapsed_ms = result.elapsed_ms, "crawl complete");
    }
    Ok(())
}

/// Publishes to JetStream and waits for the server acknowledgment. Returns
/// `Err` on either stage so callers can decide how to surface the loss —
/// nothing here may terminate the worker process.
async fn publish_and_confirm(
    jetstream: &async_nats::jetstream::Context,
    subject: &str,
    payload: bytes::Bytes,
) -> Result<()> {
    let ack = jetstream.publish(subject.to_string(), payload).await?;
    ack.await
        .map_err(|error| anyhow::anyhow!(error.to_string()))?;
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
            id: Uuid::new_v5(&Uuid::NAMESPACE_URL, format!("job-{index}").as_bytes()),
            source_url: format!("https://example.com/jobs/{index}"),
            source_name: "Fixture".into(),
            title: format!("Role {index}"),
            company: "Example".into(),
            location: None,
            country: None,
            remote: false,
            employment_type: None,
            experience_years: None,
            degree_required: None,
            salary_min: None,
            salary_max: None,
            salary_currency: None,
            date_posted: None,
            valid_through: None,
            description: "x".repeat(80_000),
            skills: Vec::new(),
            raw: json!({"id": index}),
        }
    }

    #[test]
    fn chunks_bulk_board_results_below_nats_payload_limit() {
        let result = CrawlResult {
            task: CrawlTask {
                url: "https://api.example.com/jobs".into(),
                depth: 0,
                discovered_from: None,
                queued_at: Utc::now(),
                run_id: None,
                source_id: None,
                complete_source_scan: false,
            },
            status: CrawlStatus::Success,
            fetched_at: Utc::now(),
            canonical_url: "https://api.example.com/jobs".into(),
            content_hash: Some("fixture".into()),
            content_bytes: 2_500_000,
            discovered_urls: Vec::new(),
            jobs: (0..40).map(job).collect(),
            elapsed_ms: 100,
            chunk_index: 0,
            chunk_count: 1,
        };
        let chunks = chunk_result(result);
        assert!(chunks.len() > 1);
        assert_eq!(
            chunks.iter().map(|chunk| chunk.jobs.len()).sum::<usize>(),
            40
        );
        assert!(
            chunks
                .iter()
                .all(|chunk| serde_json::to_vec(chunk).unwrap().len() < 1_048_576)
        );
    }

    /// Minimal single-connection HTTP fixture server so crawler behavior is
    /// tested against controlled responses instead of external sites.
    async fn spawn_fixture_server() -> String {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("fixture server binds");
        let base = format!("http://{}", listener.local_addr().unwrap());
        let server_base = base.clone();
        tokio::spawn(async move {
            loop {
                let Ok((mut socket, _)) = listener.accept().await else {
                    break;
                };
                let server_base = server_base.clone();
                tokio::spawn(async move {
                    let mut buffer = [0u8; 2048];
                    if socket.read(&mut buffer).await.unwrap_or(0) == 0 {
                        return;
                    }
                    let request = String::from_utf8_lossy(&buffer);
                    let path = request.split_whitespace().nth(1).unwrap_or("/").to_string();
                    let response = if path.starts_with("/robots.txt") {
                        "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\nUser-agent: *\nAllow: /\n".to_string()
                    } else if path.starts_with("/redirect") {
                        format!(
                            "HTTP/1.1 302 Found\r\nLocation: {server_base}/board.json\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                        )
                    } else if path.starts_with("/board.json") {
                        let body = r#"<html><head><script type="application/ld+json">{"@type":"JobPosting","title":"Fixture Analyst","description":"Projects welcome.","hiringOrganization":{"name":"Fixture Co"},"jobLocation":{"address":{"addressLocality":"Bengaluru","addressCountry":"IN"}},"datePosted":"2026-07-14"}</script></head><body>fixture</body></html>"#;
                        format!(
                            "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                            body.len()
                        )
                    } else {
                        "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                            .to_string()
                    };
                    let _ = socket.write_all(response.as_bytes()).await;
                });
            }
        });
        base
    }

    fn fixture_config(base: &str) -> ScoutConfig {
        ScoutConfig {
            nats_url: "nats://127.0.0.1:4222".into(),
            database_url: "postgres://firstrung:firstrung@127.0.0.1:5432/firstrung".into(),
            user_agent: "RoleAtlasFixture/0.1 (+https://roleatlas.example)".into(),
            crawl_delay: Duration::ZERO,
            request_timeout: Duration::from_secs(10),
            max_body_bytes: 1024 * 1024,
            recrawl_interval: Duration::from_secs(3600),
            seeds: vec![format!("{base}/board.json")],
        }
    }

    fn fixture_task(url: String) -> CrawlTask {
        CrawlTask {
            url,
            depth: 0,
            discovered_from: None,
            queued_at: Utc::now(),
            run_id: None,
            source_id: None,
            complete_source_scan: false,
        }
    }

    #[tokio::test]
    async fn crawls_a_controlled_fixture_server_through_validated_redirects() {
        let base = spawn_fixture_server().await;
        let config = fixture_config(&base);
        let crawler =
            Crawler::with_policy(&config, EgressPolicy::new(true, None)).expect("crawler builds");

        // The redirect hop is validated and followed before extraction.
        let result = crawler
            .crawl(fixture_task(format!("{base}/redirect")))
            .await;
        assert!(matches!(result.status, CrawlStatus::Success), "{result:?}");
        assert_eq!(result.jobs.len(), 1);
        assert!(result.canonical_url.ends_with("/board.json"));
        assert_eq!(result.jobs[0].title, "Fixture Analyst");
    }

    #[tokio::test]
    async fn egress_policy_blocks_the_private_fixture_server_by_default() {
        let base = spawn_fixture_server().await;
        let config = fixture_config(&base);
        // Production default: the loopback fixture server is not a legal target.
        let crawler =
            Crawler::with_policy(&config, EgressPolicy::new(false, None)).expect("crawler builds");
        let result = crawler
            .crawl(fixture_task(format!("{base}/board.json")))
            .await;
        match result.status {
            CrawlStatus::FetchError(reason) => {
                assert!(reason.contains("egress policy"), "{reason}");
            }
            other => panic!("expected an egress block, got {other:?}"),
        }
    }
}
