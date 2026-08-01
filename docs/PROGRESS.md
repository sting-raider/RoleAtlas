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
