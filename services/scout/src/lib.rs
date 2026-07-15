pub mod config;
pub mod extract;
pub mod frontier;
pub mod identity;
pub mod models;
pub mod robots;
pub mod search;

use anyhow::Result;
use async_nats::jetstream;
use sqlx::{Pool, Postgres, postgres::PgPoolOptions};

pub const STREAM_NAME: &str = "FIRSTRUNG_CRAWL";
pub const PENDING_SUBJECT: &str = "firstrung.crawl.pending";
pub const RESULT_SUBJECT: &str = "firstrung.crawl.result";

pub async fn connect_database(database_url: &str) -> Result<Pool<Postgres>> {
    let pool = PgPoolOptions::new()
        .max_connections(12)
        .connect(database_url)
        .await?;
    sqlx::migrate!("./migrations").run(&pool).await?;
    Ok(pool)
}

pub async fn ensure_stream(context: &jetstream::Context) -> Result<jetstream::stream::Stream> {
    let stream = context
        .get_or_create_stream(jetstream::stream::Config {
            name: STREAM_NAME.to_string(),
            subjects: vec!["firstrung.crawl.*".to_string()],
            max_messages: 2_000_000,
            max_bytes: 8 * 1024 * 1024 * 1024,
            ..Default::default()
        })
        .await?;
    Ok(stream)
}

pub fn init_tracing() {
    let filter = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| "firstrung_scout=info,tower_http=info".into());
    tracing_subscriber::fmt().with_env_filter(filter).init();
}
