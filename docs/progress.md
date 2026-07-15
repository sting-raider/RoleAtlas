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
