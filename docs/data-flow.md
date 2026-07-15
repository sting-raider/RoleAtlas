# Data flow

## Public-feed path

`app/page.tsx` -> `getLiveJobs()` in `app/liveJobs.ts` -> five external JSON feeds -> `buildJob()` -> in-memory deduplication -> initial props -> `FirstRungApp` client state.

This path has no durable source run, raw snapshot, reconciliation, or server-side filtered count.

## NATS crawler path

Seed catalog / `POST /api/seeds` -> PostgreSQL `crawl_frontier` -> NATS `firstrung.crawl.pending` -> worker fetch and extraction -> NATS `firstrung.crawl.result` -> coordinator `save_result()` -> PostgreSQL `jobs` -> scout `GET /api/jobs` -> Next proxy `/api/local-scout` -> browser merge.

Before Work Order 1, `jobs.source_url UNIQUE` was the only database identity rule. Work Order 1 changes the durable identity boundary to source job ID, canonical URL, then a structured fingerprint, while retaining every source reference and recording merges.

## Search-session path

Confirmed profile -> persisted active search plan -> `POST /api/search-sessions` -> each role query executes against all lifecycle-visible PostgreSQL jobs -> query/result/provenance rows -> ranked job payload -> browser merge and résumé ranking. AI query expansion follows the same persisted path. Session history and feedback remain in PostgreSQL across refreshes.

## Résumé and AI path

PDF upload -> `/api/resume` -> deterministic evidence/confidence extraction -> user review -> structured profile and plan persistence -> search session -> local ranking. If explicitly invoked, `/api/ai/match` sends résumé text plus a bounded job batch to the selected provider; returned role queries expand the persisted plan and execute another search session. The model API is not needed for crawling or deterministic search.
