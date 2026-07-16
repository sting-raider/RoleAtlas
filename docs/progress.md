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

## Work Order 3 — Candidate profile and search plan (complete)

- Completed work: added deterministic evidence/confidence extraction, an editable review-and-confirm step, a separate search-plan model/editor, PostgreSQL persistence and API proxy, profile reload, and explicit-only AI invocation after upload.
- Files changed: candidate-profile module/tests, discovery/profile UI and styles, package scripts, scout API, Next proxy, migration, and docs.
- Migrations added: `0005_candidate_profiles_and_search_plans.sql`.
- Tests added: evidence-backed early-career plan generation and no-invented-location behavior.
- Known limitations: the plan is persisted but does not execute multiple server-side queries until Work Order 4; résumé text intentionally cannot be restored after the browser session ends.
- Deviations from plan: raw résumé content is not persisted because the structured profile is sufficient for search planning and materially reduces privacy risk.
- Next work order: Work Order 4 — search sessions and local-index plan execution.

Verification: Rust tests/formatting, TypeScript, lint, all web tests/builds, and deterministic profile tests passed. Migration 0005 applied. A live API round-trip persisted and reloaded a confirmed profile plus `Data Analyst`/India/internship plan, then removed the verification fixture.

## Work Order 4 — Search sessions and retrieval provenance (complete)

- Completed work: added durable search sessions/queries/results/provenance/feedback; full-index deterministic plan execution; explicit complete/partial coverage snapshots and source-expansion candidates; history APIs and profile UI; browser import of previously unloaded results; explicit AI query expansion that triggers retrieval; viewed/saved/applied feedback capture.
- Files changed: scout search module/API/lib, migration and PostgreSQL integration test, Next search/feedback proxies, discovery/profile UI, regression tests, crawler Dockerfiles, two mechanical Rust lint cleanups, and docs.
- Migrations added: `0006_search_sessions.sql`.
- Tests added: a real PostgreSQL session test covering unloaded-job discovery, provenance, history, coverage, and feedback. All earlier TODO regression tests are now replaced by executable coverage.
- Known limitations: dismissed feedback has API support but no dedicated card control; ATS expansion candidates are surfaced but not automatically crawled; public-feed-only jobs remain outside persistent search sessions.
- Deviations from plan: automatic source expansion stops at a policy-safe candidate list instead of blindly crawling URLs proposed by an LLM.
- Next work order: none in the ordered rebuild plan; the deferred UI overhaul and broader policy-safe ATS coverage can now begin from a trustworthy data foundation.

Verification: TypeScript, lint, all web tests/builds, strict Rust Clippy/formatting, Rust unit tests, and both PostgreSQL integration suites passed. The rebuilt Docker stack applied migrations 1–6 and remained healthy. A live round-trip through `localhost:3000` persisted a confirmed plan, executed one query across the full local index, stored and returned 250 ranked jobs with provenance, exposed the run through history and detail endpoints, recorded viewed feedback, reported partial coverage as 20/32 successful configured sources, and returned HTTP 200 for the production UI. The temporary profile, session, results, provenance, and feedback were removed afterward.

## Work Order 5 — Global coverage, eligibility, and source orchestration (complete)

- Completed work: replaced duplicated country logic with one generated ISO country/subdivision, IANA timezone, city-alias, and deterministic region contract shared by TypeScript and Rust; added conservative geographic eligibility and international opportunity classification; added a schema-validated registry of 16 verified geographically diverse Greenhouse/Ashby boards; selected sources per confirmed search; returned local-index results before incremental NATS expansion; persisted source-selection states and reranked completed sessions; kept indexed search operational when NATS is absent; added NVIDIA NIM and centralized provider security/verification/activity transparency; exposed checked-source progress in the UI; allowed persisted reviewed plans to rerun without reuploading a résumé; and scoped every configured-source counter to the verified registry.
- Files changed: `shared/geography.ts`, `shared/geography/*`, `shared/opportunityTaxonomy.ts`, `shared/taxonomy/*`, `sources/registry/global.json`, `sources/schema/source.schema.json`, geography/taxonomy/registry scripts and tests, crawler geography/eligibility/opportunity/registry/orchestration/search/API modules, candidate-profile and discovery UI paths, AI provider/routes/tests, Docker/CI configuration, source contribution guidance, and implementation documents. The complete list is the branch diff from `06fa197`.
- Migrations added: `0007_global_location_eligibility.sql`, `0008_global_opportunity_taxonomy.sql`, and `0009_search_source_orchestration.sql`. All are additive. Fresh installation and an upgrade from the exact six-migration baseline both reached migration 9; the upgrade retained its seeded candidate profile, plan, and search session.
- Tests added: shared geography and region membership; international opportunity taxonomy; registry schema/trust rejection; source ranking/orchestration; AI endpoint/auth/SSRF/model-verification/activity behavior; and a production eligibility acceptance matrix covering single-country onsite, multi-country region, worldwide remote, region-restricted remote, country and subdivision exclusions, authorization, sponsorship available/unavailable, relocation, timezone mismatch, and hybrid attendance. Existing reconciliation and full profile → plan → persisted results → provenance → history → feedback integration tests still pass against PostgreSQL.
- Known limitations: the verified registry is intentionally 16 boards and is not global market coverage; public feed jobs remain transient and outside crawler reconciliation; live NVIDIA/DeepSeek calls require user credentials and were verified with deterministic mocked provider responses rather than a real key; model proposals cannot automatically add sources; ambiguous eligibility remains `unclear`; the production web bundle still emits a non-failing size warning above 500 kB; and Docker's production install reported 17 npm audit advisories (1 low, 10 moderate, 6 high) that need a separate dependency-upgrade review rather than an unreviewed forced update.
- Deviations from plan: the plan’s suggested schema was split into three additive migrations only after inspecting migrations 1–6. The initial registry is smaller than a broad company catalog because every automatic endpoint requires current listing-backed geography and a successful complete scan. AI never owns eligibility or source trust; it may expand confirmed queries and prepare applications only.
- Next work order: none on this branch. It is ready for review; expansion of verified adapters/sources and public-feed persistence should be separate work and must not weaken the trust model.

Verification: `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm run registry:validate`, `npm test`, strict Rust formatting/Clippy/tests, both ignored PostgreSQL integration suites, Docker production builds, fresh and six-to-nine migration paths, reduced-function missing-NATS search, and manual production browser checks passed. A live India/APAC search returned 15 indexed roles immediately, selected 12 verified sources, queued one stale source through NATS, moved coverage from `expanding` to `checked`, reranked the same session after 15 observed jobs, preserved provenance/history, and stored feedback. A separate browser check reused a persisted plan without résumé reupload and displayed 546 eligible indexed roles with 12/12 selected sources checked. Verification fixtures were removed; the retained job index and existing user data were not reset.
