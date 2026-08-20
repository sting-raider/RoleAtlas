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

- removed the browser-native ordered-list markers that duplicated the custom onboarding step indices;
- replaced anonymous step text with explicit `01`–`08` index and label elements for stable alignment and wrapping;
- retained ordered-list semantics and hid the decorative index text from accessible button names.

Verified:

- formatting, lint, TypeScript, and the Next.js production build passed;
- rebuilt the web container and visually confirmed one aligned step-number column in the running onboarding dialog;
- confirmed the semantic browser snapshot exposes each step once without duplicate numbering.

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
