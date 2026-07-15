use anyhow::{Context, Result};
use async_nats::jetstream::consumer::pull;
use chrono::Utc;
use firstrung_scout::{
    PENDING_SUBJECT, RESULT_SUBJECT,
    config::ScoutConfig,
    connect_database, ensure_stream,
    frontier::{enqueue_seed_for_recrawl, save_result},
    init_tracing,
    models::{CrawlResult, CrawlTask},
};
use futures_util::StreamExt;
use std::time::Duration;
use tracing::{error, info};

async fn publish_task(context: &async_nats::jetstream::Context, task: &CrawlTask) -> Result<()> {
    context.publish(PENDING_SUBJECT, serde_json::to_vec(task)?.into()).await?.await?;
    Ok(())
}

#[tokio::main]
async fn main() -> Result<()> {
    init_tracing();
    let config = ScoutConfig::from_env();
    let pool = connect_database(&config.database_url).await.context("connect to Postgres")?;
    let client = async_nats::connect(&config.nats_url).await.context("connect to NATS")?;
    let jetstream = async_nats::jetstream::new(client);
    let stream = ensure_stream(&jetstream).await?;

    for url in &config.seeds {
        // Startup is also recovery: publish every maintained source even if the
        // database still says `queued` after JetStream exhausted an old delivery.
        let _ = enqueue_seed_for_recrawl(&pool, url, config.recrawl_interval.as_secs() as i64).await?;
        publish_task(&jetstream, &CrawlTask {
            url: url.clone(),
            depth: 0,
            discovered_from: None,
            queued_at: Utc::now(),
        }).await?;
    }

    let consumer = stream
        .get_or_create_consumer(
            "scout-coordinator",
            pull::Config {
                durable_name: Some("scout-coordinator".into()),
                filter_subject: RESULT_SUBJECT.into(),
                ack_wait: Duration::from_secs(90),
                max_deliver: 8,
                max_ack_pending: 32,
                ..Default::default()
            },
        )
        .await?;
    let mut messages = consumer.messages().await?;
    let mut recrawl_timer = tokio::time::interval(config.recrawl_interval);
    recrawl_timer.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    recrawl_timer.tick().await;
    info!(seeds = config.seeds.len(), recrawl_hours = config.recrawl_interval.as_secs() / 3600, "scout coordinator ready");

    loop {
        let message = tokio::select! {
            maybe_message = messages.next() => match maybe_message {
                Some(message) => message,
                None => break,
            },
            _ = recrawl_timer.tick() => {
                let mut queued = 0usize;
                for url in &config.seeds {
                    if enqueue_seed_for_recrawl(&pool, url, config.recrawl_interval.as_secs() as i64).await? {
                        publish_task(&jetstream, &CrawlTask {
                            url: url.clone(),
                            depth: 0,
                            discovered_from: None,
                            queued_at: Utc::now(),
                        }).await?;
                        queued += 1;
                    }
                }
                info!(queued, "scheduled source refresh complete");
                continue;
            }
        };
        let message = match message {
            Ok(message) => message,
            Err(error) => {
                error!(%error, "NATS consumer error");
                continue;
            }
        };
        let result: CrawlResult = match serde_json::from_slice(&message.payload) {
            Ok(result) => result,
            Err(error) => {
                error!(%error, "discarding malformed crawl result");
                message.ack().await.map_err(|error| anyhow::anyhow!(error.to_string()))?;
                continue;
            }
        };

        let new_tasks = save_result(&pool, &result).await?;
        for task in &new_tasks {
            publish_task(&jetstream, task).await?;
        }
        message.ack().await.map_err(|error| anyhow::anyhow!(error.to_string()))?;
        info!(url = %result.canonical_url, jobs = result.jobs.len(), queued = new_tasks.len(), "result indexed");
    }
    Ok(())
}
