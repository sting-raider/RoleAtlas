# Production-readiness progress

## 2026-08-01 — Phase 0 baseline

Completed:

- created `codex/production-readiness` from the latest Nothing UI v2 descendant;
- reproduced web formatting, lint, type checking, registry validation, unit, rendered, and production-build checks;
- reproduced Rust formatting, strict Clippy, unit, worker, and PostgreSQL integration tests;
- ran the complete local Compose stack without colliding with the user's existing port-3000 process;
- verified web/API/NATS health and inspected current database contents/indexes;
- reviewed all ten migrations, every web API route, Scout API ownership queries, Docker/runtime configuration, AI/provider networking, source policy, current CI, GitHub Pages separation, and representative UI workspaces;
- measured bundle size, key HTTP paths, and a representative PostgreSQL query plan;
- recorded the evidence-backed gap audit and phased implementation plan.

Current evidence:

- 45 TypeScript unit tests and 8 rendered/site tests passed.
- 24 Rust library tests, 1 worker test, and 3 PostgreSQL integration tests passed.
- local full stack returned HTTP 200 for the web, Scout health, and NATS monitoring.
- 400-job Scout response: 5,411,123 bytes, 2.669 s local warm average.
- representative database scan: 4.644 ms over 3,513 jobs.
- main client chunk: 1,056,362 bytes uncompressed; build warning remains.

Known blockers found:

- no authentication, users, ownership, or tenant isolation;
- global latest-profile/plan/session behavior and global `local` workspace;
- public administrative crawler controls and permissive Scout CORS;
- published internal services and development-only Compose security;
- browser-held provider keys/product entities and unauthenticated AI routes;
- oversized unpaginated job payload, monolithic client, and missing browser/a11y/load/security suites.

Next:

- finish Phase 0 evidence packaging and commit it;
- begin Phase 1 with the canonical Next.js runtime, Better Auth, additive ownership migration, bootstrap account, authorization layer, and adversarial tenant-isolation tests.

## 2026-08-01 — Phase 1 runtime foundation

Completed:

- replaced Vinext/Vite development, build, and start commands with supported Next.js 16 Node commands;
- removed unused Cloudflare Sites, Worker, D1, Drizzle, Wrangler, Vite, and Tailwind starter scaffolding and dependencies;
- enabled Next standalone output and corrected the inferred workspace root;
- rebuilt the web image as a minimal standalone runtime running as the unprivileged `roleatlas` user.

Verification:

- formatting, lint, type checking, registry validation, 45 unit tests, Next production build, and 8 rendered/site tests passed;
- the standalone Docker image built successfully, ran as `roleatlas`, and returned HTTP 200 from `/api/health`.

Next:

- integrate Better Auth against PostgreSQL;
- add the bootstrap ownership migration and enforce server-derived user ownership across all private routes.

## 2026-08-13 — Phase 1 identity and tenancy (verification in progress)

Implemented:

- added Better Auth 1.6 with PostgreSQL database sessions, email/password authentication, configurable verification and password-reset email, optional GitHub OAuth, secure-cookie support, session expiry/rotation, and database-backed rate limiting;
- added sign-in, sign-up, password-recovery, sign-out, account export, and permanent account-deletion surfaces;
- added local Mailpit capture configuration so development verification/reset messages never become real outbound email;
- added migration `0011_auth_and_tenancy.sql`, generated from the live Better Auth schema and extended with an explicit bootstrap account, non-null owners, foreign keys, owner-aware indexes, composite per-user workspaces, audit events, and export/deletion request tables;
- preserved representative pre-migration profile, plan, session, feedback, and workspace rows under the non-login bootstrap account in an upgrade test;
- made the Next.js session the browser trust boundary and protected candidate profile, workspace, search session, feedback, résumé, AI, source-operations, and account-export routes;
- added signed, time-bounded HMAC identity assertions between Next.js and Scout, removed permissive Scout CORS, required an internal service secret, and required an administrator role for manual crawler seeds and operational metrics;
- scoped profile, active-plan, workspace, search-session, rerun, list, and feedback SQL to the authenticated user; guessed foreign UUIDs return no owned resource;
- added Rust PostgreSQL tenant-adversary coverage and updated existing PostgreSQL tests for explicit ownership.

Verified:

- clean migration from an empty database: passed (25 tables, explicit bootstrap account);
- upgrade from migrations 0001–0010 with representative persisted records: passed, with all five private record categories assigned to the bootstrap account;
- locked Rust production image compilation after the auth/API changes: passed;
- Rust formatting, strict all-target Clippy, 24 library tests, and 1 worker test: passed using the installed host toolchain;
- `npm run format:check`, lint, TypeScript, registry validation, 46 unit tests, Next production build, and 8 rendered/site tests: passed;
- internal assertion tests prove that method, path/query, user, role, and timestamp participate in the signature.

Still required before Phase 1 is complete:

- rerun the four ignored PostgreSQL integration tests against a disposable database after Docker Desktop is available again;
- run the rebuilt full stack, then verify sign-up → captured verification → sign-in → private API → logout/revocation in a real browser;
- execute two live accounts against the API and confirm profile/session/workspace UUID guessing cannot cross tenants;
- verify account export and deletion end-to-end, including retained redacted audit evidence and removal of owned records;
- add browser automation for the identity journeys rather than relying on unit, build, and repository tests alone.

Current environmental limitation:

- Docker Desktop stopped after the successful Rust image build and migration checks. Web-only checks remain green; container/runtime verification is pending rather than claimed.

## 2026-08-20 — Onboarding progress-rail correction

Implemented:

- removed both browser-native and ARIA list semantics from the onboarding progress rail after Chromium still exposed a duplicate marker column; the rail is now a labelled navigation landmark with one custom index per step;
- replaced anonymous step text with explicit `01`–`08` index and label elements for stable alignment and wrapping;
- kept each step as a named button, used `aria-current="step"` for the active item, and hid the decorative index text from accessible button names.

Verified:

- formatting, lint, TypeScript, and the Next.js production build passed;
- rebuilt the web container and visually confirmed one aligned step-number column in the running onboarding dialog;
- confirmed the deployed stylesheet explicitly suppresses list styles and `::marker` content as a hydration-safe fallback;
- added rendered-source regressions that reject native `<ol>`/`<li>` markup and require the marker-suppression fallback.

## 2026-08-20 — Phase 1 durable ownership and account lifecycle

Implemented:

- normalized saved jobs, strategies and revisions, user-job feedback, applications and timelines, contacts, notifications, recent views, AI activity, provider metadata, and generated application artifacts in additive migration `0012_normalized_user_product_entities.sql`;
- made normalized tables authoritative on workspace reads while retaining the versioned JSON workspace as a backward-compatible presentation/preferences bridge;
- added transactional workspace writes with `expected_revision` optimistic concurrency and HTTP 409 conflict responses;
- added per-account browser-storage namespaces and stopped importing legacy shared saved/application state into signed-in accounts;
- limited raw provider credentials to the current session and persisted only non-secret provider metadata, AI activity, and generated artifacts;
- expanded account export to schema version 2 across normalized product state;
- added composite same-user foreign keys in `0013_tenant_parent_integrity.sql` so a child cannot reference another tenant's profile, plan, session, or application;
- added Cargo migration change tracking through `services/scout/build.rs` and included it in the production Scout image;
- documented the live model and trust boundary in `docs/DATA_MODEL.md` and `docs/AUTHENTICATION.md`.

Verified:

- all 13 migrations and all 6 ignored PostgreSQL integration tests passed against a fresh disposable database;
- migration 0013 passed against a restored representative pre-0013 database;
- a built Scout container applied migrations 0011–0013 to a clean container database;
- a two-account browser scenario restored Tenant B's saved state while Tenant C remained empty, and a supplied fake provider key was absent from PostgreSQL and absent after refresh;
- live account export returned schema version 2 with the owned saved job and provider metadata, and did not contain the supplied fake key;
- live account deletion returned HTTP 200, removed the user from all 20 checked authentication/product tables, retained 4,024 shared canonical jobs, and left only an anonymized 32-character subject fingerprint in the deletion audit event;
- the three synthetic tenant accounts used for manual verification were removed afterward;
- 48 TypeScript unit tests, the Next production build, and 8 rendered/site tests passed after the final account lifecycle run.

Known limitations:

- the compatibility workspace save currently replaces and reinserts the account's bounded normalized collections transactionally; dedicated incremental domain APIs remain Phase 2–4 work;
- encrypted long-lived BYOK storage and secret-manager integration are not implemented; keys are deliberately session-only;
- PostgreSQL row-level security is not enabled; isolation currently uses authenticated routes, signed service assertions, owner predicates, and composite tenant foreign keys;
- the live two-account and account-lifecycle scenarios are not yet encoded as Playwright tests.

Next:

- run the final complete Phase 1 verification gate and commit the work in logical slices;
- begin Phase 2 with persistent agent runs, typed policy-controlled tools, budgets, cancellation, resumability, approval gates, audit history, and adversarial runtime tests.

## 2026-08-20 — Bounded NATS crawl work queue

Implemented:

- changed the crawl stream from indefinite limits retention to a 128 MiB, seven-day JetStream work queue with discard-new backpressure;
- added a guarded legacy migration that replaces the old stream only after both exact-subject consumers have zero pending and zero unacknowledged messages;
- retained canonical jobs, source runs, reconciliation history, and frontier state in PostgreSQL while removing redundant acknowledged queue payloads.

Verified:

- the live legacy stream had 3,696 fully acknowledged messages consuming 1.44 GB and no pending deliveries before migration;
- the migration recreated the stream with `workqueue` retention, 128 MiB maximum storage, and seven-day maximum age;
- the live coordinator remained running and resumed indexing all 16 maintained seeds while JetStream storage fell to a few kilobytes;
- Rust formatting, strict Clippy, 25 library tests, and the worker chunking test passed.

Known limitations:

- dead-letter handling and explicit queue-depth alerting remain later reliability work;
- the legacy migration intentionally refuses to replace a stream that still contains pending or unacknowledged work.

## 2026-08-20 — Phase 2 persistent agent core and approved-source dispatch

Implemented:

- added migrations `0014_agent_runtime.sql` and `0015_agent_step_keys.sql` for tenant-owned runs, plan revisions, keyed steps and observations, typed tool calls, exact-call approvals, bounded worker records, and ordered events;
- added a lease-protected persistent plan → act → observe → re-plan runtime with bounded requests, deterministic fallback planning, strict schemas, effect policy, cancellation, idempotent recovery, retry limits, loop prevention, and redacted failures;
- registered the initial canonical search, job, strategy, coverage, source-scan, ranking, analysis, application, follow-up, notification, controlled-research, preparation, and reserved external-message tools;
- kept all external listing and tool output as `data_only` evidence rather than agent authority;
- expanded account export to schema version 3 with owned agent history and no provider secrets;
- extracted the shared signed Scout client to `lib/scout-client.ts`;
- connected `request_source_scan` to Scout using only a stable verified registry source ID, database enablement/quarantine state, a retry-stable run UUID, and a NATS message ID;
- added asynchronous waiting semantics so a `running` source scan persists `waiting_for_tool`, then resumes from another request and completes only after a terminal source-run observation.
- connected `analyze_jobs_parallel` to same-user persistent workers that run registered `analyze_job` calls under the parent step/tool/concurrency budgets, preserve partial successes, retry safely, and use versioned idempotency keys;
- added a server-enforced per-tool deadline, cancellation polling and `AbortSignal` propagation, plus bounded production retry backoff.

Verified so far:

- 64 TypeScript unit tests pass, including policy rejection, budget boundaries, prompt-injection data treatment, interrupted idempotency behavior, repeated-failure loop prevention, in-flight cancellation, redacted timeouts, asynchronous source waiting, and a five-worker partial-failure fixture whose observed concurrency never exceeds two;
- 26 Rust library tests and the worker chunking test pass, including stable enabled-source resolution that rejects URL-shaped input;
- Scout and web production images build and return healthy responses;
- two identical signed approved-source requests returned one UUID and one persisted `source_runs` row;
- an arbitrary URL submitted as a source ID returned HTTP 404 before queue admission;
- live persisted run `a1cddc11-ab7d-4de9-afd2-da62fda0edad` moved from `waiting_for_tool` with a `running` observation to `completed` after a second status poll observed `success` and 483 jobs;
- the earlier full deterministic live run persisted a multi-step canonical search, coverage observation, bounded comparison, restart-safe history, and tenant isolation.
- a live PostgreSQL/API run completed with one persisted delegation step, five completed workers and five audited child `analyze_job` calls; a second authenticated user received HTTP 404 for that run, and both synthetic accounts were deleted afterward;
- a separate live run configured `maxConcurrency=2` and measured a maximum of two overlapping persisted worker intervals.
- an injected interrupted delegation resumed through the production API without duplication: the worker moved from running to queued, used its second and final attempt, completed once, and retained two redacted `execution_interrupted` call records plus one recovery event;
- the exact-call approval API path entered `waiting_for_approval`, returned HTTP 404 to a second tenant, atomically consumed the owner's approval, attempted the intentionally unavailable external boundary once, then refused both replay and re-approval;
- all 15 migrations passed from an empty database with all 7 ignored PostgreSQL tests; a restored pre-agent database upgraded from migration 13 to 15 with its existing profile/search/workspace record count unchanged;
- the final schema-v3 export contained five workers and ten audited tool calls without the fixture credential, and Better Auth account deletion removed every owned agent row while retaining shared canonical jobs and an anonymized deletion audit;
- the complete web gate passed formatting, ESLint, TypeScript, registry validation, 65 unit tests, a production Next.js build, and 8 rendered-site checks; Rust formatting, strict all-target Clippy, 26 library tests, the worker test, and the PostgreSQL suites passed.

Phase 2 deterministic runtime gate: complete.

Deferred to their planned later phases rather than represented as complete here:

- production model-backed planning/routing and repeatable agent-quality evaluation;
- a background scheduler for runs waiting on asynchronous tools;
- add the first-class plan/activity/budget/approval UI in Phase 5.

## 2026-08-20 — Phase 3 indexed retrieval and batched search sessions

Implemented:

- added migration `0016_indexed_job_search.sql` with weighted stored full-text search, trigram indexes, and partial active-listing cursor/source/work-mode indexes;
- added one filter-validated Scout retrieval engine with ISO-country/source/employment/experience/remote/degree/freshness filters and filter-bound stable cursors;
- moved the registered `search_jobs` agent tool from direct broad SQL to the signed canonical Scout search API;
- replaced persisted search sessions' 5,000-row `ILIKE` query with bounded indexed 100-row candidate pages and a 1,000-candidate-per-query ceiling;
- replaced per-job result and provenance inserts with two array-batched statements per query and deterministic rank tie-breaking;
- added server-backed persisted-result pagination, bounded client continuation, stale-request cancellation, 320-character list previews, and on-demand full job detail;
- switched the country picker request to the canonical ISO country-code filter instead of a country-name substring.

Verified:

- Rust formatting, strict all-target Clippy, 28 library tests, and the worker test passed;
- all 9 ignored PostgreSQL tests passed sequentially on a fresh disposable database, including indexed typo/filter/cursor behavior, batched persisted sessions, pagination without duplicates, tenant isolation, and reconciliation;
- a representative pre-0016 schema upgraded through migration 0016 without losing a persisted profile or canonical job, and all seven expected indexes were present;
- the live 4,033-job database used the FTS GIN index and executed a representative query in 1.939 ms;
- live API pagination returned a filter-bound cursor; a two-record page had no overlap with its successor; invalid cursors were rejected;
- live list output omitted the full description (600-character pre-final-compaction preview at measurement time), while the detail endpoint returned the complete 3,299-character listing.

Known limitations / next gate:

- the offline ranking evaluation is not implemented, so the existing deterministic score remains the default;
- post-compaction response size, 10k/100k/1m scale, concurrent users, and browser interaction latency still require repeatable benchmarks;
- cursor continuation is stable but not snapshot-isolated from newly ingested jobs;
- migration 0016 uses ordinary transactional index creation and needs a planned production rollout for a very large existing table.

Next:

- build and run the offline ranking evaluation, adopt only measurable improvements, then add repeatable search/load benchmarks before expanding source adapters.

## 2026-08-22 — Phase 3 offline ranking evaluation harness

Implemented:

- added `services/scout/src/rank_eval.rs` with graded-relevance precision@K, recall@K, MRR, NDCG@K with exponential gains, hard-disqualifier leakage, duplicate marking, unknown-evidence visibility, pool-normalized retrieval relevance, and two scorers: the shipped heuristic (`baseline_score`) and a bounded feature blend (`proposed_score`) whose unit tests prove missing data never earns positive credit;
- added the ignored PostgreSQL test `curated_fixture_corpus_evaluates_baseline_and_proposed_rankers`, which seeds a 14-listing adversarial corpus (perfect, partial, and marginal matches; keyword-stuffed and description-only distractors; one duplicate pair; policy-excluded and timezone-mismatched listings; an unknown-geography listing), retrieves through the real indexed engine, applies deterministic eligibility filtering, compares both scorers at depths 5 and 10, prints full ranked orders, and gates on zero leakage, duplicate detection, sane NDCG floors, and no-regression against baseline.

Verified:

- 37 Scout library tests pass including nine new rank_eval metric and scorer property tests;
- the evaluation ran green on the disposable PostgreSQL 17 container: baseline P@5 1.000 / R@5 0.500 / MRR 1.000 / NDCG@5 0.788 / NDCG@10 0.810 versus proposed P@5 1.000 / R@5 0.500 / MRR 1.000 / NDCG@5 0.818 / NDCG@10 0.836, both models leaking zero disqualified listings, marking exactly one duplicate-pair member, and preserving the unknown-evidence listing as unclear; indexed retrieval of the pool took 8 ms;
- the decisive observed difference is tie handling: five listings share the baseline top score and degenerate to job-ID order, placing stale and duplicated gain-2 rows above gain-3 matches, while the blend separates them by retrieval relevance and freshness;
- Rust formatting and strict all-target Clippy passed.

Known limitations:

- one curated corpus is not adoption evidence; the shipped session heuristic remains the default until the harness shows stable improvement across expanded corpora;
- scale/load benchmarks (10k/100k/1m jobs, concurrent users) remain open.

Next:

- expand evaluation corpora and add repeatable search/load benchmarks before expanding source adapters.

## 2026-08-23 — Phase 3 exact-count pages, ts_rank scoring, and the synthetic scale benchmark

Implemented:

- rewrote the canonical search statement in `services/scout/src/search_index.rs`: the admission/filter predicate now lives in one shared constant applied to both a bounded top-N ranked page and an exact `COUNT(*)` CTE, replacing `COUNT(*) OVER()` (the window function that materialized every matching row before LIMIT);
- switched retrieval scoring from `ts_rank_cd(..., 32)` to `ts_rank(..., 32)` after measuring both;
- added `services/scout/tests/search_benchmark.rs`, an ignored repeatable benchmark that seeds a disposable generated corpus (`BENCH_JOB_COUNT`, default 10,000), runs five representative query shapes × 20 iterations, prints p50/p95 latency plus serialized page bytes, and includes a seed-only mode for EXPLAIN capture.

Verified:

- all five ignored PostgreSQL suites passed sequentially on a freshly recreated disposable database: indexed typo/filter/cursor behavior with exact counts, curated ranking evaluation, two tenancy tests, two workspace tests, and the migration-16 upgrade proof;
- ranking evaluation re-run under `ts_rank` on the same curated corpus: baseline NDCG@5/NDCG@10 improved from 0.788/0.810 to 0.870/0.876 because heuristic-tied listings now tie-break by retrieval relevance instead of job-ID order; proposed blend unchanged at 0.818/0.836; zero leakage; duplicate and unknown-evidence gates unchanged; decision recorded as D-020 keeping `ts_rank`;
- 10k-job benchmark (debug build, Docker Desktop PostgreSQL 17): browse p50/p95 34/77 ms, single-term FTS 27/53 ms, multi-term AND 95/104 ms, typo trigram 30/39 ms, country+freshness 29/47 ms; compact 100-row pages serialize to ~120 KB; seeding took 1.1 s;
- web baseline reconfirmed: typecheck, lint, registry validation (16 sources), and all unit/rendered tests green.

Known limitations / next gate:

- the benchmark runs a debug build and a single sequential caller; release-build numbers, 100k/1m corpora, concurrent users/workers, reconciliation, and browser interaction benchmarks remain open;
- the exact-count CTE evaluates the filter twice per request — measured acceptable at 10k jobs, revisit with a count budget if larger corpora regress;
- cursors minted before the scoring swap stay valid but their embedded scores shift meaning once across the upgrade boundary (recorded in D-020).

Next:

- close the CI gap by running the direct search_index and ranking_evaluation suites against a PostgreSQL service job, then expand source adapters.
