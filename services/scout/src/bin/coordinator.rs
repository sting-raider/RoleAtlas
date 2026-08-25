use anyhow::{Context, Result};
use async_nats::jetstream::consumer::pull;
use firstrung_scout::{
    DEAD_SUBJECT, PENDING_SUBJECT, RESULT_SUBJECT,
    config::ScoutConfig,
    connect_database, connect_nats, ensure_stream,
    frontier::{begin_source_run, enqueue_seed_for_recrawl, mark_dead_letter, save_result},
    init_tracing,
    models::{CrawlResult, CrawlTask},
    orchestration, search,
};
use futures_util::StreamExt;
use sqlx::Pool;
use sqlx::Postgres;
use std::time::Duration;
use tracing::{error, info, warn};

async fn publish_task(context: &async_nats::jetstream::Context, task: &CrawlTask) -> Result<()> {
    context
        .publish(PENDING_SUBJECT, serde_json::to_vec(task)?.into())
        .await?
        .await?;
    Ok(())
}

/// Consumes final-delivery snapshots so exhausted tasks leave a durable trace
/// and a failed frontier row instead of disappearing with the work queue.
async fn run_dead_letter_consumer(jetstream: async_nats::jetstream::Context, pool: Pool<Postgres>) {
    let stream = match firstrung_scout::ensure_dead_letter_stream(&jetstream).await {
        Ok(stream) => stream,
        Err(error) => {
            error!(%error, "dead-letter stream unavailable");
            return;
        }
    };
    let consumer = match stream
        .get_or_create_consumer(
            "scout-dlq",
            pull::Config {
                durable_name: Some("scout-dlq".into()),
                filter_subject: DEAD_SUBJECT.into(),
                ack_wait: Duration::from_secs(90),
                max_deliver: 8,
                max_ack_pending: 32,
                ..Default::default()
            },
        )
        .await
    {
        Ok(consumer) => consumer,
        Err(error) => {
            error!(%error, "dead-letter consumer unavailable");
            return;
        }
    };
    let mut messages = match consumer.messages().await {
        Ok(messages) => messages,
        Err(error) => {
            error!(%error, "dead-letter consumer could not subscribe");
            return;
        }
    };
    info!("scout dead-letter consumer ready");
    while let Some(message) = messages.next().await {
        let message = match message {
            Ok(message) => message,
            Err(error) => {
                error!(%error, "dead-letter consumer error");
                continue;
            }
        };
        #[derive(serde::Deserialize)]
        struct DeadTask {
            task: CrawlTask,
            attempts: u64,
        }
        match serde_json::from_slice::<DeadTask>(&message.payload) {
            Ok(dead) => {
                let reason = format!("delivery budget exhausted after {} attempts", dead.attempts);
                match mark_dead_letter(&pool, &dead.task.url, &reason).await {
                    Ok(count) => {
                        if count == 0 {
                            warn!(url = %dead.task.url, "dead-letter task has no frontier row");
                        } else {
                            info!(url = %dead.task.url, attempts = dead.attempts, "dead-letter task recorded");
                        }
                    }
                    Err(error) => {
                        error!(%error, url = %dead.task.url, "could not record dead-letter task")
                    }
                }
            }
            Err(error) => {
                error!(%error, "discarding malformed dead-letter snapshot");
            }
        }
        if let Err(error) = message.ack().await {
            error!(%error, "could not ack dead-letter snapshot");
        }
    }
}

#[tokio::main]
async fn main() -> Result<()> {
    init_tracing();
    let config = ScoutConfig::from_env();
    let pool = connect_database(&config.database_url)
        .await
        .context("connect to Postgres")?;
    let client = connect_nats(&config.nats_url).await?;
    let jetstream = async_nats::jetstream::new(client);
    let stream = ensure_stream(&jetstream).await?;

    for url in &config.seeds {
        // Startup is also recovery: publish every maintained source even if the
        // database still says `queued` after JetStream exhausted an old delivery.
        let _ =
            enqueue_seed_for_recrawl(&pool, url, config.recrawl_interval.as_secs() as i64).await?;
        publish_task(&jetstream, &begin_source_run(&pool, url).await?).await?;
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
    tokio::spawn(run_dead_letter_consumer(jetstream.clone(), pool.clone()));
    let mut recrawl_timer = tokio::time::interval(config.recrawl_interval);
    recrawl_timer.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    recrawl_timer.tick().await;
    info!(
        seeds = config.seeds.len(),
        recrawl_hours = config.recrawl_interval.as_secs() / 3600,
        "scout coordinator ready"
    );

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
                        publish_task(&jetstream, &begin_source_run(&pool, url).await?).await?;
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
                message
                    .ack()
                    .await
                    .map_err(|error| anyhow::anyhow!(error.to_string()))?;
                continue;
            }
        };

        let new_tasks = save_result(&pool, &result).await?;
        for task in &new_tasks {
            publish_task(&jetstream, task).await?;
        }
        if result.chunk_index + 1 >= result.chunk_count
            && let Some(run_id) = result.task.run_id
        {
            for session_id in orchestration::sessions_for_completed_run(&pool, run_id).await? {
                if let Err(error) = search::rerun_after_source_refresh(&pool, session_id).await {
                    error!(%error, %session_id, "could not rerank search after source refresh");
                }
                orchestration::refresh_session(&pool, session_id).await?;
            }
        }
        message
            .ack()
            .await
            .map_err(|error| anyhow::anyhow!(error.to_string()))?;
        info!(url = %result.canonical_url, jobs = result.jobs.len(), queued = new_tasks.len(), "result indexed");
    }
    Ok(())
}
