# Data flow

## Public-feed path

`app/page.tsx` -> `getLiveJobs()` in `app/liveJobs.ts` -> validated public feeds and the persistent Scout index -> canonical normalization and in-memory deduplication -> initial props -> `RoleAtlasApp` client state.

This path has no durable source run, raw snapshot, reconciliation, or server-side filtered count.

**Boundary (enforced in code):** the five aggregator feeds (Arbeitnow, Remotive, Jobicy, Himalayas, Remote OK) are explicitly supplemental. `getLiveJobs()` stamps every record it returns as `recordKind: "feed"` with `verified: false`; UI renders feed rows as "Aggregator feed · unverified", splits indexed/feed counts, and only `recordKind: "canonical"` rows participate in persisted search-session feedback or agent tools. A repo test pins that no module under `lib/agent/` may import the feed path, and no public API route exposes the unlabeled payload. Promotion into canonical storage can only happen through the Phase 3 adapter gate (fixtures, terms evidence, complete-board semantics, reconciliation tests) — never by merging feed rows into the index.

## NATS crawler path

Seed catalog / `POST /api/seeds` -> PostgreSQL `crawl_frontier` -> NATS `firstrung.crawl.pending` -> worker fetch and extraction -> NATS `firstrung.crawl.result` -> coordinator `save_result()` -> PostgreSQL `jobs` -> scout `GET /api/jobs` -> Next proxy `/api/local-scout` -> browser merge.

Before Work Order 1, `jobs.source_url UNIQUE` was the only database identity rule. Work Order 1 changes the durable identity boundary to source job ID, canonical URL, then a structured fingerprint, while retaining every source reference and recording merges.

## Search-session path

Confirmed profile -> persisted active search plan -> `POST /api/search-sessions` -> each role query executes against all lifecycle-visible PostgreSQL jobs -> query/result/provenance rows -> ranked job payload -> browser merge and résumé ranking. AI query expansion follows the same persisted path. Session history and feedback remain in PostgreSQL across refreshes.

## Résumé and AI path

PDF upload -> `/api/resume` -> deterministic evidence/confidence extraction -> user review -> structured profile and plan persistence -> search session -> local ranking. If explicitly invoked, `/api/ai/match` sends résumé text plus a bounded job batch to the selected provider; returned role queries expand the persisted plan and execute another search session. The model API is not needed for crawling or deterministic search.
