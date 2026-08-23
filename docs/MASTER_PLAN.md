# Production master plan

This is the execution plan for converting RoleAtlas from a local single-user product into a deployable multi-user service. Phases are gated; a passing unit suite is not by itself a phase exit.

## Phase 0 — Audit and baseline

Status: complete and baseline-verified; completion matrix remains live

- Reproduce all existing web, Rust, PostgreSQL, registry, and full-stack checks.
- Record runtime, data ownership, API, bundle, request, query, crawler, UI, deployment, CI, and documentation gaps.
- Maintain the requirement-by-requirement evidence matrix in `docs/COMPLETION_AUDIT.md`.

Exit evidence: `docs/PRODUCTION_GAP_AUDIT.md`, reproducible commands, measured values, and an ordered backlog.

## Phase 1 — Identity and tenancy

Status: complete for the current model; Phase 7 browser regression remains

- Move the canonical web runtime from Vinext compatibility mode to supported Next.js Node self-hosting.
- Integrate maintained Better Auth with PostgreSQL database sessions, secure cookies, email/password, verification/reset delivery abstraction, configurable GitHub OAuth, revocation, and abuse protection.
- Add users, roles, audit events, export/deletion requests, and ownership columns.
- Migrate existing records to an explicit bootstrap account without data loss.
- Enforce ownership in web proxy routes and Scout repository queries; never trust a browser user ID.
- Add logout/all-session revocation, account export, account deletion, and cross-user adversarial tests.

Exit evidence: anonymous denial, two-user isolation tests for profiles/sessions/applications/workspaces, bootstrap-upgrade test, session rotation/revocation tests, and complete account export/deletion tests.

## Phase 2 — Agentic core

Status: complete for the deterministic runtime foundation; model routing, evaluation, scheduler, and UI continue in their planned later phases

- Persist tenant-owned runs, plans, steps, tool calls, observations, approvals, workers, and events.
- Implement a provider-independent plan → act → observe → re-plan loop with typed schemas, effect policy, budgets, cancellation, timeouts, retries, loop prevention, leases, resumability, and untrusted-content boundaries.
- Expose the safe canonical search, strategy, coverage, source-scan, job-analysis, preparation, application, follow-up, and notification tool set.
- Connect approved-source scan requests through stable registry IDs while Scout retains URL resolution, trust, quarantine, and NATS admission authority.
- Execute independent shortlist work through bounded persistent parallel workers and prove concurrency plus tenant isolation.

Exit evidence: adversarial policy tests, exact-call approval proof, budget/timeout/cancellation/recovery tests, persistent restart/resume, parallel-worker isolation, approved source dispatch and terminal observation, deterministic AI-outage behavior, and complete same-user export/erasure coverage.

## Phase 3 — Search and source engine

Status: pending

- Add PostgreSQL full-text/trigram retrieval, structured filters, stable cursor pagination, compact result DTOs, detail endpoints, batch writes, and cancellation.
- Build deterministic ranking features and a curated offline evaluation harness before changing defaults.
- Profile 10k/100k/1m synthetic datasets where practical and concurrent users/workers.
- Resolve supplemental-feed lifecycle boundaries; add supported ATS adapters only with fixtures, terms evidence, complete-board semantics, and reconciliation tests.
- Add source operations, quarantine, failure classification, retry/dead-letter state, egress protections, and controlled crawler fixture servers.

Exit evidence: evaluation metrics, EXPLAIN plans, latency/payload budgets, load results, adapter contracts, and crawler failure/recovery tests.

## Phase 4 — Product workflows

Status: pending

- Harden PDF/DOCX/manual résumé ingestion and deterministic cleanup.
- Complete durable saves, dismiss/restore, applications/timeline/contacts/notes/reminders, notifications/outbox/digest, and portable export.
- Move AI activity and generated artifacts to owned durable records.
- Replace raw browser credential persistence with encrypted server-side or explicitly ephemeral per-user handling and preserve deterministic fallbacks.

Exit evidence: cross-browser restoration, malformed/scanned/long résumé fixtures, end-to-end saved/application/notification flows, outbox failure recovery, and AI-failure independence tests.

## Phase 5 — Frontend architecture and visual rebuild

Status: pending (direction locked 2026-08-23: editorial-magazine styling, simplicity-first progressive disclosure — D-024)

- Split the monolithic client into URL-addressable workspaces, typed clients, bounded query caches, domain components, and route-level loading/error boundaries.
- Establish one token/component system around the editorial-magazine direction (serif display type, generous whitespace, restrained palette) and remove compatibility CSS/storage authority.
- Simplify every primary surface to a few clear actions; move advanced controls behind explicit disclosure points so users opt into density instead of receiving option walls.
- Redesign every candidate and admin workspace for daily job seeking rather than system monitoring.
- Finish deliberate light/dark themes, responsive behavior, keyboard/focus semantics, Axe checks, and visual regression.
- Remove the oversized bundle warning and enforce performance budgets.

Exit evidence: browser E2E, visual baselines, all required viewports/themes, WCAG 2.2 AA checks, no overflow/console errors, and bundle/performance budgets.

## Phase 6 — Platform hardening

Status: pending

- Add production images, reverse proxy, TLS/secret guidance, internal networks, non-root/read-only runtimes, health checks, resource controls, migration job, structured logs, metrics, tracing, and alerts.
- Add backup/restore, disaster recovery, outage/duplicate/poison/restart tests, and reliable graceful shutdown.
- Complete remaining FirstRung naming migration compatibly.

Exit evidence: clean production deployment, exposure check, backup/restore proof, resilience matrix, and operations runbooks.

## Phase 7 — Quality, release, and documentation

Status: pending

- Expand CI with PostgreSQL upgrade migrations, Playwright, Axe, visual, Compose smoke, tenant isolation, load tests, dependency/Rust/container/secret/license audits, SBOM, and production validation.
- Add semantic versioning, changelog, migration notes, image tags, deployment/rollback checklist, and dependency update automation.
- Replace historical architecture claims with current operator/product documentation and add legal/privacy/security templates plus root licensing.

Exit evidence: all CI jobs green from a clean checkout and complete operator handoff documentation.

## Phase 8 — Independent completion audit

Status: pending

Attempt to disprove readiness across every definition-of-done item, attack ownership and request boundaries, exercise outages and recovery, inspect all UI sizes/themes, deploy from clean state, and restore a backup. Fix every repository-controlled critical/high issue before marking completion.
