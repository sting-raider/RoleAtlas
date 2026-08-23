pub mod config;
pub mod egress;
pub mod eligibility;
pub mod extract;
pub mod frontier;
pub mod geography;
pub mod identity;
pub mod models;
pub mod opportunity;
pub mod orchestration;
pub mod rank_eval;
pub mod registry;
pub mod robots;
pub mod search;
pub mod search_index;
pub mod user_workspace;

use anyhow::{Context, Result, bail};
use async_nats::jetstream;
use sqlx::{Pool, Postgres, postgres::PgPoolOptions};
use std::time::Duration;

pub const STREAM_NAME: &str = "FIRSTRUNG_CRAWL";
pub const PENDING_SUBJECT: &str = "firstrung.crawl.pending";
pub const RESULT_SUBJECT: &str = "firstrung.crawl.result";
pub const DEAD_SUBJECT: &str = "firstrung.dead.task";
pub const DEAD_STREAM_NAME: &str = "FIRSTRUNG_CRAWL_DLQ";

const CRAWL_STREAM_MAX_BYTES: i64 = 128 * 1024 * 1024;
const CRAWL_STREAM_MAX_AGE: Duration = Duration::from_secs(7 * 24 * 60 * 60);
const DEAD_STREAM_MAX_BYTES: i64 = 64 * 1024 * 1024;
const DEAD_STREAM_MAX_AGE: Duration = Duration::from_secs(30 * 24 * 60 * 60);

pub async fn connect_database(database_url: &str) -> Result<Pool<Postgres>> {
    let pool = PgPoolOptions::new()
        .max_connections(12)
        .connect(database_url)
        .await?;
    sqlx::migrate!("./migrations").run(&pool).await?;
    frontier::backfill_structured_geography(&pool).await?;
    frontier::backfill_opportunity_classification(&pool).await?;
    Ok(pool)
}

fn crawl_stream_config() -> jetstream::stream::Config {
    jetstream::stream::Config {
        name: STREAM_NAME.to_string(),
        subjects: vec!["firstrung.crawl.*".to_string()],
        retention: jetstream::stream::RetentionPolicy::WorkQueue,
        discard: jetstream::stream::DiscardPolicy::New,
        max_messages: 100_000,
        max_bytes: CRAWL_STREAM_MAX_BYTES,
        max_age: CRAWL_STREAM_MAX_AGE,
        ..Default::default()
    }
}

pub async fn ensure_stream(context: &jetstream::Context) -> Result<jetstream::stream::Stream> {
    let desired = crawl_stream_config();
    match context.get_stream(STREAM_NAME).await {
        Ok(stream)
            if stream.cached_info().config.retention
                != jetstream::stream::RetentionPolicy::WorkQueue =>
        {
            migrate_drained_legacy_stream(context, stream).await?;
        }
        Ok(_) => {
            context.create_or_update_stream(desired).await?;
        }
        Err(_) => {
            context.create_stream(desired).await?;
        }
    }
    let stream = context.get_stream(STREAM_NAME).await?;
    ensure_dead_letter_stream(context).await?;
    Ok(stream)
}

/// Bounded operator-facing dead-letter store. Work-queue retention removes a
/// task once its delivery budget is exhausted, so the worker snapshots final
/// deliveries onto this limits-retention stream before attempting them.
pub async fn ensure_dead_letter_stream(
    context: &jetstream::Context,
) -> Result<jetstream::stream::Stream> {
    let desired = jetstream::stream::Config {
        name: DEAD_STREAM_NAME.to_string(),
        subjects: vec!["firstrung.dead.*".to_string()],
        retention: jetstream::stream::RetentionPolicy::Limits,
        max_bytes: DEAD_STREAM_MAX_BYTES,
        max_age: DEAD_STREAM_MAX_AGE,
        discard: jetstream::stream::DiscardPolicy::Old,
        ..Default::default()
    };
    match context.get_stream(DEAD_STREAM_NAME).await {
        Ok(_) => {
            context.create_or_update_stream(desired).await?;
        }
        Err(_) => {
            context.create_stream(desired).await?;
        }
    }
    let stream = context.get_stream(DEAD_STREAM_NAME).await?;
    Ok(stream)
}

async fn migrate_drained_legacy_stream(
    context: &jetstream::Context,
    stream: jetstream::stream::Stream,
) -> Result<()> {
    let state = &stream.cached_info().state;
    if state.messages > 0 {
        if state.subjects_count > 2 {
            bail!(
                "legacy crawl stream contains an unexpected subject and cannot be migrated safely"
            );
        }
        for consumer_name in ["scout-workers", "scout-coordinator"] {
            let info = stream
                .consumer_info(consumer_name)
                .await
                .with_context(|| format!("inspect legacy {consumer_name} consumer"))?;
            if info.num_pending > 0
                || info.num_ack_pending > 0
                || info.ack_floor.consumer_sequence != info.delivered.consumer_sequence
            {
                bail!(
                    "legacy crawl stream still has pending work for {consumer_name}; drain it before migrating"
                );
            }
        }
    }

    // Limits-retention kept every acknowledged crawl payload forever. Once both
    // exact-subject consumers are fully drained, those messages are redundant:
    // canonical jobs, source runs, and frontier state already live in PostgreSQL.
    context
        .delete_stream(STREAM_NAME)
        .await
        .context("remove drained legacy crawl stream")?;
    context
        .create_stream(crawl_stream_config())
        .await
        .context("create bounded crawl work queue")?;
    Ok(())
}

pub fn init_tracing() {
    let filter = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| "firstrung_scout=info,tower_http=info".into());
    tracing_subscriber::fmt().with_env_filter(filter).init();
}

#[cfg(test)]
mod stream_tests {
    use super::*;

    #[test]
    fn crawl_stream_is_a_bounded_work_queue() {
        let config = crawl_stream_config();
        assert_eq!(
            config.retention,
            jetstream::stream::RetentionPolicy::WorkQueue
        );
        assert_eq!(config.discard, jetstream::stream::DiscardPolicy::New);
        assert_eq!(config.max_bytes, CRAWL_STREAM_MAX_BYTES);
        assert_eq!(config.max_age, CRAWL_STREAM_MAX_AGE);
        assert_eq!(config.subjects, vec!["firstrung.crawl.*"]);
    }
}
