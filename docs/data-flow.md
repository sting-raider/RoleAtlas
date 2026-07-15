# Data flow

## Public-feed path

`app/page.tsx` -> `getLiveJobs()` in `app/liveJobs.ts` -> five external JSON feeds -> `buildJob()` -> in-memory deduplication -> initial props -> `FirstRungApp` client state.

This path has no durable source run, raw snapshot, reconciliation, or server-side filtered count.

## NATS crawler path

Seed catalog / `POST /api/seeds` -> PostgreSQL `crawl_frontier` -> NATS `firstrung.crawl.pending` -> worker fetch and extraction -> NATS `firstrung.crawl.result` -> coordinator `save_result()` -> PostgreSQL `jobs` -> scout `GET /api/jobs` -> Next proxy `/api/local-scout` -> browser merge.

Before Work Order 1, `jobs.source_url UNIQUE` was the only database identity rule. Work Order 1 changes the durable identity boundary to source job ID, canonical URL, then a structured fingerprint, while retaining every source reference and recording merges.

## Résumé and AI path

PDF upload -> `/api/resume` -> deterministic text/skill extraction -> browser session storage -> local ranking. If configured, `/api/ai/match` sends résumé text plus the currently loaded jobs to the selected provider and returns a profile plus scores. The model API is not needed for crawling. Before Work Order 3/4, its planned queries do not cause new retrieval.
