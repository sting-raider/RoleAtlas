# Completion audit

This matrix is intentionally conservative. `Complete` requires direct current implementation and verification evidence. Documentation, schema-only groundwork, or a plausible UI is not enough.

| Requirement group | Status | Current evidence | Missing proof/work |
| --- | --- | --- | --- |
| Account creation/sign-in/verification/reset/OAuth | Missing | No auth dependency or routes | Phase 1 implementation and browser tests |
| Secure sessions, logout, revocation, rotation | Missing | None | Database sessions and adversarial tests |
| Tenant ownership and isolation | Missing | Global latest-record queries | Ownership migration and two-user tests |
| Account export/deletion and audit | Missing | None | Durable requests/events and erasure tests |
| Canonical jobs and deduplication | Complete for current adapters | Migrations 0003–0004; reconciliation tests | Re-audit after ownership/search changes |
| Deterministic geography/eligibility | Complete for current fixtures | Migration 0007; unit/integration tests | Expand adversarial listing fixtures later |
| Normalized durable user product data | Missing | One JSON workspace plus browser storage | Phase 2/4 tables and migration |
| API authentication/authorization | Missing | Public proxies and Scout routes | Phase 1/2 middleware and route tests |
| CORS/CSRF/rate limits/body limits/errors/request IDs | Missing/partial | Provider-specific controls only | Phase 2 hardening |
| Résumé PDF/manual workflow | Partial | PDF text extraction and manual onboarding | Signatures, DOCX, page/decompression limits, fixture suite |
| Indexed paginated search | Missing | Broad `ILIKE`, 5,000 candidate cap, 1,000 response cap | FTS/trigram/cursor/batch APIs |
| Measured ranking quality | Missing | Fixed heuristic and match reasons | Offline evaluation and comparison |
| Search performance/scale | Missing | Small local timing baseline | 10k/100k/1m and concurrent load suites |
| Source identity/reconciliation/coverage honesty | Complete for current adapters | Source runs, lifecycle tests, registry policy | Re-audit adapter expansion and outages |
| ATS adapter breadth | Partial | Lever/Greenhouse/Ashby/JSON-LD | Evidence-based adapter evaluation/fixtures |
| Responsible crawling | Partial | Robots, pacing, cap, retry | Redirect/DNS/egress/DLQ/fixture-server hardening |
| Saves/dismiss/restore | Partial | Workspace JSON and feedback | Owned normalized persistence and cross-browser tests |
| Applications/timeline | Partial | Workspace JSON UI | Owned normalized records, reminders, export |
| Notifications/outbox/email abstraction | Partial/missing | In-app JSON records | Durable normalized records, scheduler/outbox/local capture |
| Optional AI independence | Partial | Deterministic fallbacks exist | Owned audit, secure secrets, injection/schema/failure tests |
| Frontend architecture | Missing | 1.06 MB client chunk; monolithic client | Route/domain split and typed query layer |
| UI visual quality | Partial | Distinctive themes/screenshots | Full workspace redesign and visual approval |
| WCAG 2.2 AA/responsive coverage | Missing | Some semantics/CSS breakpoints | Axe, keyboard, zoom, all viewport/theme evidence |
| Browser E2E/visual regression | Missing | Rendered HTML tests only | Playwright/Axe/visual stack |
| Production images/networking | Missing | Development Compose publishes internals | Hardened production Compose/reverse proxy |
| Observability | Missing | Human-formatted tracing only | JSON logs, metrics, traces, dashboards/alerts |
| Reliability/outage recovery | Missing/partial | JetStream durability and degraded UI | Formal outage, DLQ, restart, concurrency tests |
| Backup/restore | Missing | None | Commands, encryption guidance, successful restore test |
| Privacy/legal/license | Missing/partial | Third-party notices only | Root license and policy/contact templates |
| CI/supply chain/release | Missing/partial | Basic web/Rust workflow | Full required jobs, SBOM, scans, releases/rollback |
| Documentation/operator handoff | Missing/partial | Historical work-order docs | Current production document set |
| Clean production deployment | Missing | Development stack only | Phase 6/8 clean-machine proof |

## Final audit gate

Before completion, every row above must be `Complete` with exact code, test, runtime, or operational evidence. Phase 8 must attempt to break cross-user access, sessions, uploads, requests, crawler boundaries, outage behavior, concurrent edits, all required viewports, deployment, and backup restoration. Any uncertain row remains incomplete.
