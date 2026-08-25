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
- ranking evaluation re-run with deterministic v5 fixture identities on freshly seeded disposable databases, under both scorers: baseline NDCG@5/NDCG@10 0.870/0.876 and proposed 0.818/0.836 are IDENTICAL for `ts_rank` and `ts_rank_cd`; the previously recorded 2026-08-22 numbers (baseline 0.788/0.810) differed because random v4 fixture UUIDs made heuristic-tie order vary per run. An interim claim that `ts_rank` improved tie ordering was retracted after a controlled A/B; decision recorded honestly as D-020 (keep `ts_rank` on parity, fixtures made deterministic);
- 10k-job benchmark (debug build, Docker Desktop PostgreSQL 17): browse p50/p95 34/77 ms, single-term FTS 27/53 ms, multi-term AND 95/104 ms, typo trigram 30/39 ms, country+freshness 29/47 ms; compact 100-row pages serialize to ~120 KB; seeding took 1.1 s;
- web baseline reconfirmed: typecheck, lint, registry validation (16 sources), and all unit/rendered tests green.

Known limitations / next gate:

- the benchmark runs a debug build and a single sequential caller; release-build numbers, 100k/1m corpora, concurrent users/workers, reconciliation, and browser interaction benchmarks remain open;
- the exact-count CTE evaluates the filter twice per request — measured acceptable at 10k jobs, revisit with a count budget if larger corpora regress;
- cursors minted before the scoring swap stay valid but their embedded scores shift meaning once across the upgrade boundary (recorded in D-020).

Next:

- close the CI gap by running the direct search_index and ranking_evaluation suites against a PostgreSQL service job, then expand source adapters.

## 2026-08-23 — Phase 3 supplemental-feed boundary and Recruitee adapter

Implemented:

- enforced the supplemental-feed boundary in code (D-021): `getLiveJobs()` stamps every record as unverified feed lineage; canonical crawler rows carry canonical lineage; demo fixtures carry demo lineage; job cards, drawer labels, and the top bar/source-confidence counts distinguish indexed listings from aggregator copies; persisted session feedback and lazy detail loads gate on lineage instead of the brittle `scout-` id prefix; dedup promotes merged survivors to the strongest lineage;
- removed the unused public `GET /api/jobs` Next route that served the unlabeled feed payload, and added a repo test forbidding any `lib/agent/` module from importing the feed path;
- added a hosted-Recruitee board adapter (`{board}.recruitee.com/api/offers`) with identity branches for complete scans and host-derived namespaces, HTML-stripped descriptions/requirements, locations/country/employment-type/close-date normalization, and bounded salary capture (D-022);
- filled Lever extraction gaps: workplaceType remote evidence, salaryRange bounds/currency, and ISO country fallback;
- added `tests/adapters_contract.rs` over recorded fixtures proving the reconciliation invariant (job namespace == endpoint namespace), deterministic stable ids, real posting URLs, and expected field mappings for both Lever and Recruitee payloads.

Verified:

- web: typecheck clean after regenerating Next route types; all 68 unit/rendered tests pass including new lineage-promotion, feed-labeling, and agent-import-boundary tests; lint and format gates pass;
- Rust: fmt and strict all-target clippy pass; 38 library tests pass; the three adapter contract tests pass; the reconciliation suite passes on a disposable PostgreSQL 17 container including a new proof that a missing Recruitee listing closes through possibly_closed -> closed under two successful complete runs;
- SmartRecruiters evaluated and explicitly unsupported on robots grounds; Teamtailor/Workday/BambooHR/Jobvite recorded as unsupported with revisit conditions in docs/source-support.md.

Known limitations / next gate:

- registry breadth is unchanged by design: no employer board was added without maintainer verification evidence; the adapter capability awaits verified Recruitee boards;
- crawler egress/redirect hardening, dead-letter handling, and a controlled HTTP fixture server remain open Phase 3 items.

Next:

- crawler failure/recovery hardening (per-redirect DNS/approved-origin enforcement, dead-letter stream, fixture server), then Phase 4 product workflows.

## 2026-08-23 — Phase 3 crawler egress hardening and dead-letter handling

Implemented:

- added `services/scout/src/egress.rs`: every outbound URL — original task and each redirect hop — must be HTTP(S), respect an optional `SCOUT_EGRESS_ALLOWLIST`, and, by default, resolve only to public addresses (loopback, private, link-local incl. cloud metadata, unspecified, unique-local, and v4-mapped ranges are blocked); `SCOUT_ALLOW_PRIVATE_HOSTS` opts in for fixture-server testing;
- replaced the HTTP client's automatic redirects with bounded manual following (8 hops) so every target re-passes egress validation with fresh DNS resolution;
- added a bounded dead-letter path (D-023): the worker snapshots tasks on their final JetStream delivery to `firstrung.dead.*` (limits-retention stream, 64 MiB / 30 days) before attempting them, and the coordinator runs a durable dead-letter consumer that records exhausted tasks as failed frontier rows with the reason;
- added controlled fixture-server tests: an in-process HTTP server proves the crawler extracts JSON-LD listings through validated redirects and that the production default blocks the loopback fixture entirely.

Verified:

- 42 library tests pass including four new egress policy tests (literal private targets, named localhost opt-in, allowlist label-boundary behavior, unresolvable-host rejection);
- three worker tests pass: chunking under the NATS payload budget plus both fixture-server crawl paths;
- all seven ignored PostgreSQL suites pass sequentially on the disposable database (indexed search, ranking evaluation, two tenancy tests, two workspace tests, migration upgrade, reconciliation x3);
- formatting and strict all-target Clippy pass.

Known limitations / next gate:

- DNS is resolved separately from connect; pinning validated addresses in a custom connector remains open for full rebinding resistance;
- NATS outage/duplicate-delivery drills remain Phase 6 reliability work.

Next:

- Phase 3 is feature-complete against MASTER_PLAN exit criteria except release-build/load benchmark numbers; move to Phase 4 product workflows.

### 100k-row scale point

- the same benchmark harness measured a 100,000-job synthetic corpus (14.5 s seed, debug build): no-query browse 275/324 ms p50/p95, single-term FTS 130/141 ms, multi-term AND 603/627 ms, typo trigram 197/209 ms, country+freshness 69/154 ms;
- recorded as evidence in docs/SEARCH_AND_RANKING.md: the multi-term shape exceeds an interactive budget at 100k rows because trigram scoring runs in both the ranked page and the exact-count CTE — this is the trigger for the planned count-budget pass; 1m rows and concurrent users remain unmeasured.

## 2026-08-23 — Phase 4 résumé hardening and the notification engine

Implemented:

- résumé ingestion now identifies uploads by magic bytes (never MIME or extension), caps PDFs at 12 pages, bounds DOCX member inflation before and after decompression, converts `word/document.xml` to plain text, and returns deterministic recovery messages without leaking parser errors; the upload control accepts `.docx`;
- profile inference handles punctuated skills (C++, C#, Node.js) via lookaround boundaries and derives names/locations from space-joined PDF text runs, with guessed names excluded from location resolution so given names cannot resolve as countries;
- added migration `0017_notification_preferences.sql` (per-user enabled-types map plus weekly-digest flag) and `services/scout/src/notifications.rs`: deterministic generators for follow-up-due reminders, saved-job closure alerts, and unseen strong-match alerts, all dedupe-keyed for exactly-once semantics and gated on stored preferences with enabled-by-default fallbacks;
- workspace hydration now runs generation as its tick: every product read leaves alerts current without a separate scheduler.

Verified:

- seven new fixture tests cover fake/scanned/oversized PDFs, unicode DOCX résumés, XML entity stripping, and a declared bomb-size rejection using hand-built minimal PDF and stored-ZIP fixtures (no new dependencies);
- web gates: typecheck, lint (zero warnings), format check, and all 83 unit/rendered tests pass;
- Rust gates: fmt, strict all-target Clippy, and 42 library tests pass; a new ignored PostgreSQL suite proves generation is idempotent within a day, tenant-scoped, preference-gated, and covers follow-up/closure/strong-match types — wired into CI's ignored-suite list.

Known limitations / next gate:

- email delivery abstraction, weekly digest build, and coverage-degradation alerts remain open notification work;
- agentic triage/research tools and application reminder surfacing in the UI are next Phase 4 items.

### Weekly digest and email channel

- migration `0018_digest_scheduling.sql` adds `last_digest_sent_at` to preferences as the outbox marker;
- `lib/notifications/digest.ts` composes a plain-text weekly briefing (follow-ups due, saved-role changes, unseen strong matches) as a pure function; `lib/notifications/email.ts` provides a capture transport for development/tests and an SMTP transport for production with Mailpit local capture;
- `POST /api/notifications/digest` claims the send under a row lock inside one transaction: the sent-marker commits only after a confirmed delivery, so SMTP failure leaves the gate open for retry and two tabs cannot double-send; unconfigured deployments get an explicit 503 instead of silent pretending;
- five delivery tests cover digest copy, pluralization, capture recording, SMTP failure reporting, and message-id propagation.

### Repeatable agent evaluation suite

- added `tests/agent-evaluation.test.ts`: a scenario corpus drives the deterministic planner across three discovery goals and gates on registered-tool-only routes, dependency-DAG integrity, bounded shortlists ($take <= 5) and retry budgets, and a zero unnecessary-tool rate (no writes, artifacts, or external tools in discovery plans);
- an adversarial policy battery proves unregistered tools, schema-invalid arguments, arbitrary source IDs, admin-only boundaries, and every missing/expired/mismatched approval shape are blocked while one fresh exact-call approval authorizes exactly that call;
- injection resistance: hostile listing text stays searchable data but cannot become a tool name or fabricate observation evidence (`resolvePlanInput` returns nothing for missing paths and clamps $take to 100);
- recovery: re-planning after a strategy failure drops the failed step's dependencies instead of rescheduling it blindly;
- the suite prints a per-scenario summary table with an unnecessary-tool-rate floor of zero, mirroring the ranking evaluation's evidence style.

### Phase 5 editorial foundation and first component extractions

- design tokens rewritten around D-024: warm-paper light default, warm-ink dark theme, oxblood accent, serif (Newsreader) display voice; the dot-matrix display font and its ROND axis are retired; body copy at a comfortable 15px;
- console micro-typography replaced across navigation, pills, chips, cards, and forms with sentence-case sans at readable sizes; job results restyled as hairline-rule clippings with serif titles; the home signal block's dot ornament is retired in favor of the serif figure;
- discover filters now disclose behind a labelled toggle with an active-count badge (progressive disclosure), and the dashboard grid drops to results+rail at every breakpoint;
- extracted app/components/ui.tsx (SelectMenu, Checkbox, MatchRing, labels, cx) and app/components/JobCard.tsx from the 2,234-line client monolith, which drops to ~2,010 lines with imports rewired;
- fixed a real theme bug surfaced during browser verification: Chromium cannot reliably interpolate background-color driven by custom-property swaps, so theme flips left the canvas stuck at the previous theme; only color transitions now.

Verified: typecheck, lint (zero warnings), format check, 86 unit tests, 8 rendered/source pins updated to guard the new component files and editorial tokens; live computed-style checks on the running dev server for palette, serif headings, clipping layout, filter disclosure, and both themes.

## 2026-08-24 — Session recovery, bundle reduction (D-025), and the geography split

Context: the prior session died on a forced machine shutdown that also left NTFS corruption. This session verified the repaired tree end to end, fixed the one lint regression it had introduced, then closed the long-standing 1.06 MB main-chunk warning.

Completed:

- baseline re-verified after the corruption repair: typecheck, lint, format, 86 unit tests, production build all green; committed fd30c62 fixing a synchronous setState-in-effect (and a stale-response race) in the rebuilt subdivisions fetch;
- root-caused the oversized chunk: shared/geography.ts statically imports countries.json (381 KB) and subdivisions.json (932 KB), so any client import of resolveCountry/countryByCodeValue embedded both datasets in first paint;
- added countries-lite.json (29 KB, generated by scripts/generate-geography.mjs: ISO code + display name + bounded Latin-script aliases) and shared/geography-lite.ts with exact-match resolution and server-shaped diacritic folding;
- rewired every client component (RoleAtlasApp, DailyWorkspaces, OnboardingFlow, candidateProfile) onto the lite module; job country labels now trust Scout's server-normalized value;
- the résumé route returns server-resolved locationCountryCode/locationTimezone so buildCandidateProfile keeps full-corpus accuracy without shipping the corpus;
- new authenticated GET /api/geography/resolve endpoint gives the browser one-shot access to full-corpus resolution for free-text locations (401 anonymous, 200-char bound);
- profile-review confirm uses a lite fast-path and falls back to the resolve endpoint only when exact match fails.

Verified:

- main chunk 1,064,998 → 225,417 bytes (−79%); programmatic probe of every emitted client chunk finds zero multilingual-corpus or subdivision markers;
- 90 TypeScript unit tests pass, including four new geography-boundary regression tests (dataset completeness, exact-match semantics, code round-trips, and a guard forbidding client value-imports of the heavy barrel while allowing erased type-only imports);
- lint (zero warnings), format check, registry validation (16 sources), production build, and all 8 rendered/site tests pass;
- live dev-server checks: /sign-in renders clean with no console errors; /api/geography/resolve and /api/geography/subdivisions both return 401 to anonymous callers; lite resolver resolves "Bharat"/"BHĀRAT"/"USA"/"IND" exactly, rejects free-text phrases, and the server resolver still returns IN/Asia/Kolkata for "Bengaluru, India".

Commits: fd30c62, e4aae2e, D-025 decision record, 452128a.

Known limitations / next gate:

- authed dashboard verification (country picker datalist, onboarding resume flow end-to-end, subdivisions dropdown) still requires PostgreSQL; Docker Desktop cannot start on this machine until an NTFS-level orphaned entry at %LOCALAPPDATA%\Docker\run\dockerInference is cleared by `chkdsk C: /f` at reboot ("The file cannot be accessed by the system" crashes com.docker.backend.exe on launch); WSL has no PostgreSQL and sudo requires interactive authentication;
- Phase 5 component extraction from the ~2,010-line monolith continues next.

## 2026-08-25 — Entity-API ownership boundary, production tooling, and frontend decomposition

Context: continuing Phase 5–7 toward the completion audit. Three landed commits this session: aa39cf8 (component extraction + URL addressing), 1da4cb3 (CI/release/ops tooling), 961420d (entity-API authority).

Completed:

- fixed a silent data-loss bug: the whole-workspace PUT deleted and re-inserted applications on every save, so migration 0013's composite FK (`generated_application_artifacts → applications(user_id,id) ON DELETE CASCADE`) handed applications fresh UUIDs and cascaded their generated artifacts away. One tab's stale snapshot could also clobber another tab's writes (D-026);
- narrowed `user_workspace::sync_entities` to strategies/revisions, feedback, and recent views; saved jobs, applications, and notification acks are now owned by dedicated entity writers (POST/DELETE /api/saves, PUT /api/applications/{ref}, POST /api/notifications/ack) that update rows in place so artifact parentage survives;
- application patches are field-level with honest date semantics: absent key keeps the stored value, explicit JSON null clears it (SQL CASE branches, not COALESCE); stage transitions auto-append exactly one deduped stage_changed activity; contacts replace wholesale; empty patches rejected;
- client mutations moved onto the entity APIs via app/entitySync.ts with a per-job 400 ms trailing debounce coalescing keystrokes; each debounced send carries current local field values, and the client adopts the server's canonical record so auto-generated activities appear without reload; degraded-mode messaging is truthful ("kept in this browser for now… Retrying usually fixes it") because the PUT no longer catches up;
- extracted ProviderModal and AiActionPreviewModal from RoleAtlasApp.tsx (2,234 → 1,204 lines across ten components total); added ?view=/?job= URL addressing with replaceState-only semantics (no history spam per click) covered by tests/workspace-url.test.ts;
- CI expanded to four jobs — web typecheck/lint/test/build; Rust fmt/clippy/unit plus all nine ignored PostgreSQL suites run serially against a service container; a production compose smoke build; a blocking npm-audit job (red baseline recorded as D-027 until Next.js ≥16.3.2 ships);
- release tooling: tag-triggered release workflow (SBOM via CycloneDX, artifact attach, rollback checklist from OPERATIONS.md), scripts/sbom.sh, OPERATIONS.md covering deploy/backup/restore/rollback.

Verified:

- web gates green: format check, lint (zero warnings), tsc, 93 unit tests, production build (main chunk steady at ~225 KB), 8 rendered/site tests;
- Rust gates green: fmt, clippy -D warnings (all targets), 48 unit tests; ignored suites against the disposable integration PG: entity_writes 3/3, daily_workspace 2/2, tenancy 2/2, notifications 1/1, reconciliation, search_sessions, search_index, ranking_evaluation, migration_upgrade — all passing;
- new boundary proof in daily_workspace.rs: PUT payload carrying savedJobs/applications rows asserts they are NOT materialized, sibling saves/applications survive a second strategies-only save, and both write paths stay tenant-isolated across two users;
- null-clear proof in entity_writes.rs: explicit `"applicationDate": null` clears the stored date, and a later patch without the key leaves it cleared.

Commits: aa39cf8, 1da4cb3, 961420d (all pushed to codex/production-readiness).

Known limitations / next gate:

- Playwright E2E stack remains unbuilt (Phase 1/7 gap); browser coverage is rendered-HTML tests plus manual live verification.
- npm audit red until the next ≥16.3.2 bump (D-027 baseline).
- docs/ci.md stale (two suites listed, nine exist); OnboardingFlow.tsx duplicates the shared ResumeProfile type.
- Compose smoke unexercised locally — Docker Desktop still blocked by the pending NTFS chkdsk repair.
- Next: Phase 8 adversarial audit of production readiness.

## 2026-08-25 — Phase 8 adversarial audit and first remediations

Method: six independent read-only auditors over disjoint attack surfaces (tenant isolation, web API authz, identity/secrets, crawler egress/SSRF, evidence honesty, deployment/compose) produced 32 raw findings; every finding ranked medium-or-above (8) was then attacked by a separate skeptical verifier instructed to refute it — none was refuted outright, though two had severity reduced on review (the SSRF class to medium because readback is extraction-gated; the compose-drill contradiction to high-and-confirmed by git archaeology).

Confirmed findings and disposition:

1. Crawler egress misses 100.64.0.0/10 (cloud metadata/Tailscale), 198.18.0.0/15, TEST-NETs, 240/4, 224/4, NAT64 ::/96 and IPv4-compatible IPv6 — single-shot SSRF without rebinding; the project's own providerFetch.ts blocks strictly more classes. Fix in progress in egress.rs.
2. Evidence contradiction: commit bba7b1a claimed a production smoke + restore drill ran while docs said Docker Desktop was blocked. Resolution this session: Docker works again (29.3.1); the drill is being re-run under audit supervision rather than argued about historically.
3. D-027's premise was wrong: next@16.3.2 exists inside the existing ^16.2.6 range. Bumped next→16.3.2, react/react-dom/react-server-dom-webpack→19.2.8 (GHSA-wx67-qw84-cm4g lockstep), eslint-config-next→16.3.2. npm audit now reports ZERO vulnerabilities; D-027 rewritten as "no standing exceptions" (6600c2d).
4. /api/local-scout health|jobs|job and registry pass through unauthenticated by design (public discovery surface) but undocumented — decision record pending.
5. Dev-compose default SCOUT_INTERNAL_SECRET satisfies the ≥32-byte gate while api publishes 8080 — forged-admin risk on default-booted stacks. Remediation pending.
6. DNS-rebinding TOCTOU is real (validated addresses never pinned to connect) — already documented as residual limitation in D-023; remains open.
7. robots.txt fetched via response.text() with no byte cap — fix in progress.
8. Unbounded extracted job fields (title/company/skills/location) defeat chunk budget; publish error kills worker process — fixes in progress.

Also fixed from the plausible list: SBOM format corrected to SPDX JSON in docs; stale ledger rows removed; ResumeProfile dedupe and ci.md refresh landed earlier (4aecf55).

Verified: dependency bump passed format/lint/tsc/93 unit/build gates; largest chunk ~230 KB with zero geography corpus markers.

### Smoke drill executed (same session, later)

Docker Desktop works again (29.3.1) — the NTFS blocker from 2026-08-24 is cleared. The full production-topology drill was run under audit supervision, and it caught a real deployment bug:

- the Scout Dockerfile pinned `rust:1.87-bookworm`, but let-chains stabilized in ≥1.88 — container builds failed with E0658 while local builds (rustc 1.98) passed. Compose silently kept serving pre-built images from before the entity-API commit, so any "verified in compose" claim made after ad186b4 was running stale binaries. Fixed: builder bumped to rust:1.98-bookworm; all four app images rebuilt from HEAD.
- full battery then passed against the rebuilt stack: all 7 services reach healthy under `up --wait`; Caddy routes :3100 with nosniff/DENY/strict-origin headers and no Server leak; scout api/postgres/nats unreachable from the host but reachable over the internal network; sign-up → sign-in → workspace PUT → POST /api/saves → PUT /api/applications (auto `created` activity) all verified through the edge, including Better Auth correctly rejecting a missing-Origin POST with 403 MISSING_OR_NULL_ORIGIN.
- backup script produced a validated 156 KB dump + sha256 sidecar; restore.sh dropped the schema, restored all 46 tables, and the drill user's strategy/save/application survived — read back through the live authenticated API after restore.

The bba7b1a-era claims of a prior smoke/restore run could not be reproduced or corroborated (git archaeology shows deploy/ was created wholly in that commit while docs recorded Docker as blocked); today's drill supersedes them with dated, reproducible evidence. The compose comment "verified during the smoke run" for the Postgres capability set is now true again.
