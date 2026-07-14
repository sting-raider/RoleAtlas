use std::{env, time::Duration};

#[derive(Clone, Debug)]
pub struct ScoutConfig {
    pub nats_url: String,
    pub database_url: String,
    pub user_agent: String,
    pub crawl_delay: Duration,
    pub request_timeout: Duration,
    pub max_body_bytes: usize,
    pub seeds: Vec<String>,
}

impl ScoutConfig {
    pub fn from_env() -> Self {
        dotenvy::dotenv().ok();
        let seeds = env::var("SCOUT_SEEDS")
            .unwrap_or_else(|_| {
                "https://boards.greenhouse.io/,https://jobs.lever.co/,https://jobs.ashbyhq.com/"
                    .to_string()
            })
            .split(',')
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .collect();

        Self {
            nats_url: env::var("NATS_URL").unwrap_or_else(|_| "nats://127.0.0.1:4222".into()),
            database_url: env::var("DATABASE_URL").unwrap_or_else(|_| {
                "postgres://firstrung:firstrung@127.0.0.1:5432/firstrung".into()
            }),
            user_agent: env::var("SCOUT_USER_AGENT").unwrap_or_else(|_| {
                "FirstRungScout/0.1 (+https://firstrung.example/crawler; jobs-only)".into()
            }),
            crawl_delay: Duration::from_millis(
                env::var("CRAWL_DELAY_MS").ok().and_then(|v| v.parse().ok()).unwrap_or(1_500),
            ),
            request_timeout: Duration::from_secs(
                env::var("REQUEST_TIMEOUT_SECS").ok().and_then(|v| v.parse().ok()).unwrap_or(25),
            ),
            max_body_bytes: env::var("MAX_BODY_BYTES")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(5 * 1024 * 1024),
            seeds,
        }
    }
}
