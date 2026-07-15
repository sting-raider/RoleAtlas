# Rebuild progress

This file is updated at the completion of each work order.

## Work Order 1 — Repository audit and canonical identity (complete)

- Completed work: audited both discovery paths and persistence; replaced company/title feed deduplication; added source-scoped IDs, canonical URLs, structured fingerprints, durable source references, and merge auditing; fixed the pre-existing TypeScript and lint failures.
- Files changed: `app/jobIdentity.ts`, `app/liveJobs.ts`, `app/FirstRungApp.tsx`, `services/scout/src/identity.rs`, `services/scout/src/frontier.rs`, `services/scout/src/lib.rs`, Rust formatting, test/config files, and four architecture/progress documents.
- Migrations added: `0003_canonical_job_identity.sql`; applied successfully to the running database with all 3,128 existing job rows retained and canonicalized.
- Tests added: canonical URL normalization, tracking-variant merge, source-ID precedence, fingerprint separation, and preservation of legitimate same-title openings. Later-work-order regressions remain explicit TODOs.
- Known limitations: no source-run reconciliation, authoritative filtered counts/coverage, persisted candidate profile, or search sessions yet.
- Deviations from plan: none. The migration is additive and intentionally avoids an irreversible unique canonical-URL constraint.
- Next work order: Work Order 2 — source runs, reconciliation, trustworthy counts, and coverage.

## Work Order 2 — Source reconciliation and trustworthy counts (complete)

- Completed work: added durable sources and source runs, NATS run/chunk provenance, complete/partial/failed classification, conservative two-run lifecycle reconciliation, source-health and metrics endpoints, authoritative filtered counts, coverage metadata, and UI wording for loaded versus indexed results.
- Files changed: scout models, identity, frontier, coordinator, worker, API, local proxy, job/client types and discovery UI, docs, and integration tests.
- Migrations added: `0004_source_runs_and_reconciliation.sql`.
- Tests added: recognized complete-board classification and a PostgreSQL integration test covering success, failure, first absence, second absence, and closure.
- Known limitations: transient public feeds are still not persisted as source runs; full per-result query provenance belongs to Work Order 4. Coverage is intentionally incomplete while configured runs are still running or failed.
- Deviations from plan: lifecycle closure uses two confirmed complete absences instead of immediately closing on one absence, favoring false-positive safety.
- Next work order: Work Order 3 — candidate profile and deterministic search plan.

Verification: all Rust unit tests, the ignored PostgreSQL reconciliation integration test, web tests/build, TypeScript, lint, and Rust formatting passed. Migration 0004 applied without losing existing records. Live API/proxy checks returned 127 India internship matches before pagination, three returned records at `limit=3`, and explicit 20/32 successful-source coverage while the remaining runs were still in flight.
