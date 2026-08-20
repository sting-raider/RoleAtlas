# Completion audit

This matrix is intentionally conservative. `Complete` requires direct current implementation and verification evidence. Documentation, schema-only groundwork, or a plausible UI is not enough.

| Requirement group | Status | Current evidence | Missing proof/work |
| --- | --- | --- | --- |
| Account creation/sign-in/verification/reset/OAuth | Partial | Better Auth routes and account UI; Mailpit/GitHub configuration; production build passes | Full-stack browser verification and E2E fixtures |
| Secure sessions, logout, revocation, rotation | Partial | Database sessions, secure-cookie configuration, expiry/freshness, sign-out UI, auth rate limits | Browser revocation/rotation and invalid-session tests |
| Tenant ownership and isolation | Partial | Migration 0011; signed internal assertions; owner predicates; Rust adversarial test added | Run PostgreSQL adversarial test and two-account HTTP/browser suite |
| Account export/deletion and audit | Complete for current Phase 1 model | Schema-v2 export; Better Auth deletion; live export/key-exclusion/20-table erasure/canonical-job-retention/anonymized-audit proof | Encode the live lifecycle as Playwright regression coverage in Phase 7 |
| Canonical jobs and deduplication | Complete for current adapters | Migrations 0003–0004; reconciliation tests | Re-audit after ownership/search changes |
| Deterministic geography/eligibility | Complete for current fixtures | Migration 0007; unit/integration tests | Expand adversarial listing fixtures later |
| Normalized durable user product data | Complete for current product entities | Migrations 0012–0013; normalized authoritative reads; same-user FKs; revision-checked transactional writes; fresh/upgrade/container migration proofs | Replace the bounded snapshot compatibility write with dedicated incremental APIs as domains move into agent tools |
| API authentication/authorization | Partial | Private Next routes require sessions; Scout validates signed principals; admin crawler controls | Full-stack anonymous/cross-tenant browser/API tests |
| CORS/CSRF/rate limits/body limits/errors/request IDs | Partial | Scout permissive CORS removed; Better Auth origin/CSRF and database rate limits; public errors redacted | General API limits, request IDs, rate limits, and explicit production allow-list evidence |
| Résumé PDF/manual workflow | Partial | PDF text extraction and manual onboarding | Signatures, DOCX, page/decompression limits, fixture suite |
| Indexed paginated search | Missing | Broad `ILIKE`, 5,000 candidate cap, 1,000 response cap | FTS/trigram/cursor/batch APIs |
| Measured ranking quality | Missing | Fixed heuristic and match reasons | Offline evaluation and comparison |
| Search performance/scale | Missing | Small local timing baseline | 10k/100k/1m and concurrent load suites |
| Source identity/reconciliation/coverage honesty | Complete for current adapters | Source runs, lifecycle tests, registry policy | Re-audit adapter expansion and outages |
| ATS adapter breadth | Partial | Lever/Greenhouse/Ashby/JSON-LD | Evidence-based adapter evaluation/fixtures |
| Responsible crawling | Partial | Robots, pacing, cap, retry | Redirect/DNS/egress/DLQ/fixture-server hardening |
| Saves/dismiss/restore | Partial | Owned normalized saved/feedback tables, undo state, authoritative hydration, two-account browser isolation | Dedicated write APIs and automated cross-browser regression tests |
| Applications/timeline | Partial | Owned normalized applications, activities, contacts, artifacts, and schema-v2 export | Dedicated APIs, reminders, and end-to-end browser coverage |
| Notifications/outbox/email abstraction | Partial | Durable owned in-app notification records and dedupe state | Scheduler, outbox, preferences, email abstraction/delivery tests |
| Optional AI independence | Partial | Deterministic fallbacks; owned AI activity/provider metadata/artifacts; raw keys stripped from persistence/export | Encrypted secret storage, agent runtime, injection/schema/failure tests |
| Frontend architecture | Missing | 1.06 MB client chunk; monolithic client | Route/domain split and typed query layer |
| UI visual quality | Partial | Distinctive themes/screenshots; onboarding progress rail uses marker-free semantic list roles plus an explicit `::marker` fallback with regression coverage | Full workspace redesign and visual approval |
| WCAG 2.2 AA/responsive coverage | Missing | Some semantics/CSS breakpoints | Axe, keyboard, zoom, all viewport/theme evidence |
| Browser E2E/visual regression | Missing | Rendered HTML tests only | Playwright/Axe/visual stack |
| Production images/networking | Missing | Development Compose publishes internals | Hardened production Compose/reverse proxy |
| Observability | Missing | Human-formatted tracing only | JSON logs, metrics, traces, dashboards/alerts |
| Reliability/outage recovery | Partial | Bounded JetStream work queue; guarded drained-stream migration; live coordinator recovery; degraded UI | Formal NATS/PostgreSQL outage, DLQ, poison-message, restart, and concurrency tests |
| Backup/restore | Missing | None | Commands, encryption guidance, successful restore test |
| Privacy/legal/license | Missing/partial | Third-party notices only | Root license and policy/contact templates |
| CI/supply chain/release | Missing/partial | Basic web/Rust workflow | Full required jobs, SBOM, scans, releases/rollback |
| Documentation/operator handoff | Missing/partial | Historical work-order docs | Current production document set |
| Clean production deployment | Missing | Development stack only | Phase 6/8 clean-machine proof |

## Final audit gate

Before completion, every row above must be `Complete` with exact code, test, runtime, or operational evidence. Phase 8 must attempt to break cross-user access, sessions, uploads, requests, crawler boundaries, outage behavior, concurrent edits, all required viewports, deployment, and backup restoration. Any uncertain row remains incomplete.
