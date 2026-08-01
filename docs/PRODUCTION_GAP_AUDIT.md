# Production gap audit

Status: Phase 0 baseline, 2026-08-01

Branch: `codex/production-readiness`

Baseline commit: `7167fd1`

This audit treats the running repository as authoritative. Earlier work-order documents are historical evidence, not proof of production readiness.

## Executive finding

RoleAtlas currently demonstrates a thoughtful single-user product and a credible crawler/index core, but it is not a secure multi-user application. The highest-risk gap is not visual polish: every private record is effectively global, the web proxy and Rust API have no authenticated user boundary, and administrative crawler actions are public. The next implementation phase must establish identity, ownership, and authorization before adding product scale.

## Reproduced baseline

The following checks passed on Windows 11 with Node 22, Rust 1.87, Docker Desktop, PostgreSQL 17, and NATS 2.12:

- `npm run format:check`
- `npm run lint`
- `npm run typecheck`
- `npm run registry:validate` — 16 enabled registry entries
- `npm test` — 45 TypeScript unit tests, production build, and 8 rendered/static-site tests
- `cargo fmt --manifest-path services/scout/Cargo.toml --all -- --check`
- `cargo clippy --manifest-path services/scout/Cargo.toml --all-targets -- -D warnings`
- `cargo test --manifest-path services/scout/Cargo.toml` — 24 library tests and 1 worker test passed; 3 PostgreSQL tests ignored by the default command
- `cargo test --manifest-path services/scout/Cargo.toml -- --ignored --test-threads=1` with `DATABASE_URL` configured — daily workspace, reconciliation, and search-session integration tests passed

The complete Compose stack was started with the web bound to port 3101 because another user process occupied port 3000. Web, API, coordinator, worker, PostgreSQL, and NATS were all running; `/`, `/health`, and NATS monitoring returned HTTP 200.

## Measured baseline

Measurements are local warm-request observations, five requests per URL, not production claims.

| Surface | Minimum | Average | Maximum | Response bytes |
| --- | ---: | ---: | ---: | ---: |
| `/` | 59.3 ms | 87.6 ms | 190.6 ms | 25,491 |
| `/api/jobs` | 12.5 ms | 12.7 ms | 13.1 ms | 284 |
| `/api/local-scout?action=jobs&limit=400` | 2,529.5 ms | 2,669.1 ms | 3,058.2 ms | 5,411,123 |
| `/api/workspace` | 15.0 ms | 15.7 ms | 16.3 ms | 9,139 |
| `/api/search-sessions` | 15.0 ms | 17.6 ms | 21.6 ms | 5,447 |

PostgreSQL executed the representative unfiltered 400-job query in 4.644 ms over 3,513 jobs. The browser-facing delay is therefore dominated by serialization, a 5.4 MB response containing full descriptions, client normalization, and hydration rather than database execution.

The built `dist/` tree contains 7,464,567 bytes: 7,113,851 bytes of JavaScript and 145,160 bytes of CSS. The main browser chunk is 1,056,362 bytes uncompressed. The build emits the existing chunk-size warning. `RoleAtlasApp.tsx` remains a large client monolith and the browser became non-responsive enough to miss repeated 3-second automation input/DOM deadlines after loading the full index.

## Architecture and runtime

| Area | Evidence | Classification |
| --- | --- | --- |
| Canonical jobs, source references, run reconciliation, lifecycle history | PostgreSQL migrations 0001–0010 and passing Rust integration tests | Complete for the current source model |
| Geographic/eligibility model | Central Rust geography/eligibility modules and shared generated standards data | Complete for current tests; production API ownership still absent |
| Web runtime | `vinext@0.0.50` plus Vite/Cloudflare plugin while the actual data plane is self-hosted PostgreSQL/Rust | Partial and strategically inconsistent |
| Static showcase | `site/` and Pages workflow are separate illustrative assets | Complete as a showcase, not an application deployment |
| Production deployment | One development Compose file with published database, NATS, and internal API ports | Missing/hard blocker |
| Authentication | No auth dependency, routes, sessions, login UI, or user model | Missing/hard blocker |
| Tenant isolation | Global latest-record queries and global `workspace_key='local'` | Missing/hard blocker |

The canonical application runtime will be a supported self-hosted Next.js Node runtime behind a reverse proxy, with PostgreSQL as the durable product database and the Rust Scout API reachable only on the internal network. The GitHub Pages site remains a separate static tour. Migration away from the experimental Vinext compatibility runtime is scheduled with identity work because production auth must be built on the runtime that will actually ship.

## Data ownership audit

The database has 18 application tables and 40 indexes. Existing development data contains one profile, one plan, one workspace, three search sessions, seven feedback records, 3,513 jobs, and 32 source rows.

No table has a production user owner. Current unsafe paths include:

- `GET /api/candidate-profile` selects the globally latest profile.
- active-plan resolution can select the globally latest active plan.
- search-session list/get/rerun endpoints do not scope by owner.
- feedback accepts session/job identifiers without an authenticated owner.
- daily workspace always reads and updates `workspace_key='local'`.
- browser-supplied profile and plan UUIDs are accepted as record identity.
- saves, applications, notifications, recently viewed records, dossiers, provider activity, and parts of onboarding live in a shared JSON document and/or browser storage.

Required correction: additive user/auth tables, stable ownership foreign keys, a bootstrap-account migration for existing development records, normalized durable entities, repository methods that require a server-derived user ID, optimistic revision checks, and adversarial cross-user tests.

## API and security audit

### Critical

- Rust uses `allow_origin(Any)`, `allow_headers(Any)`, and `allow_methods(Any)`.
- Rust routes and Next proxies have no authentication or authorization middleware.
- `/api/seeds` and careers-URL submission expose administrative crawler actions to any caller.
- the internal Scout API is published on host port 8080; PostgreSQL and NATS are also published.
- raw `anyhow`, SQLx, JSON, provider, DNS, and upstream error strings can reach clients.

### High

- no CSRF/origin enforcement for state-changing routes;
- no request IDs or stable public error codes;
- no general request-body limits, query limits, idempotency controls, or application-level rate limiting;
- no audited admin role boundary;
- resume validation trusts MIME/extension and has no page-count cap, DOCX path, decompression-bomb controls, or deterministic temporary-file lifecycle;
- AI credentials can be stored in browser local storage and are sent through unauthenticated public routes;
- AI activity is browser-held, not an owned audit record;
- custom provider SSRF defenses perform DNS validation before a separate fetch resolution and therefore retain a time-of-check/time-of-use rebinding gap.

### Existing positives

- custom provider URLs require HTTPS except loopback Ollama/NIM;
- private literal/DNS addresses and cross-origin redirects are rejected;
- model output is parsed as JSON and normalized rather than rendered as HTML;
- crawler requests honor robots rules, per-host delay, timeouts, response-size caps, and bounded retry counts;
- AI remains optional for deterministic search and eligibility.

## Search and performance audit

Search-session retrieval uses broad `ILIKE` conditions, scans at most 5,000 candidates, inserts results and match rows one at a time, ranks with fixed constants, returns up to 1,000 results, and exposes no cursor. The general jobs endpoint returns up to 1,000 rows including full descriptions and performs a window count on every row. Indexes exist for lifecycle, lowercase title/company, geography JSON, remote policy, and opportunity category, but there is no PostgreSQL full-text search, trigram index, cursor contract, offline evaluation suite, or synthetic scale benchmark.

Required correction: tsvector/trigram indexes, structured filters, cursor pagination, compact summaries, detail-by-ID, batched persistence, cancellation, bounded page sizes, explainable feature scoring, and a fixture-based evaluation harness measuring relevance, disqualifier leakage, duplicate rate, unknown treatment, and latency.

## Source and crawler audit

The trusted registry is deliberately small and honest: 16 enabled Greenhouse/Ashby boards, with the database currently retaining 32 source rows from history. Lever, Greenhouse, Ashby, and JSON-LD paths exist. Workday, SmartRecruiters, Teamtailor, Recruitee, BambooHR, and Jobvite are not implemented. Supplemental feeds remain transient and outside reconciliation.

Crawler strengths include durable JetStream consumers, per-host pacing, robots checks, response caps, chunking below the NATS payload limit, stable identity, source runs, and two-run lifecycle reconciliation. Gaps include eight allowed redirects without per-target DNS/approved-origin enforcement in the worker, no egress policy, no dead-letter stream/operator workflow, limited backpressure controls, no controlled HTTP fixture server, and no adapter-contract/load suite.

## Product and UI audit

Home, Discover, onboarding, Searches, Applications, Sources, Settings, and representative job cards were inspected from the running build or screenshots generated from the baseline commit. The current Nothing-inspired direction is distinctive, but it overuses black surfaces, tiny uppercase labels, low-contrast secondary text, and system-monitor vocabulary. Workspaces still live inside one client route and one large state owner.

The live 1440×900 Home view had no horizontal overflow. The UI loaded 401 display jobs, but hydrated from 3,137 matching crawler rows. Automated navigation then missed input/DOM deadlines, consistent with the 5.4 MB payload and oversized client chunk. Existing responsive screenshots cover 390×844, and CSS includes 1280/980/760/480 breakpoints, but this is not sufficient proof of WCAG 2.2 AA or all required viewports.

Known gaps: no account surface, no URL-addressable workspaces/job details, incomplete server-backed paging, no real E2E/a11y/visual regression stack, insufficient dialog semantics in some overlays, no skip link, no automated zoom/text-scaling checks, and no reliable restoration from another browser because identity does not exist.

## Operations, reliability, and legal audit

Missing or incomplete:

- hardened production Compose, reverse proxy, TLS guidance, internal networks, non-root web runtime, read-only filesystems, capability drops, resource limits, migration job, health dependencies;
- structured JSON logs, metrics, tracing, dashboards, alerts;
- queue/dead-letter visibility and poison-message handling;
- tested PostgreSQL/NATS outage behavior, duplicate delivery, concurrent workspace writes, migration failure, backup, and restore;
- privacy/terms/cookie/security/crawler/abuse contact templates;
- root `LICENSE` despite crate metadata claiming MIT;
- dependency/container/secret/license audits, SBOM, Playwright, Axe, visual regression, Compose smoke, migration-upgrade, release and rollback workflows.

## Priority backlog

1. Establish a supported Next.js Node runtime, Better Auth, user/identity/session records, and a bootstrap ownership migration.
2. Require server-derived ownership in every private API/repository method and prove cross-user isolation.
3. Normalize durable user entities and harden proxy/Rust API contracts.
4. Replace oversized client retrieval with indexed, paginated search and measurable ranking.
5. Complete production product workflows and secure optional AI credentials/activity.
6. Split the frontend by workspace, remove legacy storage authority, and complete accessible responsive visual review.
7. Harden deployment, observability, resilience, backup/restore, CI, release, and documentation.

No production-readiness claim is justified until every item in `docs/COMPLETION_AUDIT.md` has direct implementation and test evidence.
