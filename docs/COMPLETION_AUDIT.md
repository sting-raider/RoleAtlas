# Completion audit

This matrix is intentionally conservative. `Complete` requires direct current implementation and verification evidence. Documentation, schema-only groundwork, or a plausible UI is not enough.

| Requirement group | Status | Current evidence | Missing proof/work |
| --- | --- | --- | --- |
| Account creation/sign-in/verification/reset/OAuth | Partial | Better Auth routes and account UI; Mailpit/GitHub configuration; production build passes | Full-stack browser verification and E2E fixtures |
| Secure sessions, logout, revocation, rotation | Partial | Database sessions, secure-cookie configuration, expiry/freshness, sign-out UI, auth rate limits | Browser revocation/rotation and invalid-session tests |
| Tenant ownership and isolation | Partial | Migration 0011; signed internal assertions; owner predicates; Rust adversarial test added | Run PostgreSQL adversarial test and two-account HTTP/browser suite |
| Account export/deletion and audit | Complete for current Phase 2 model | Schema-v3 export includes owned agent history; Better Auth deletion; live export/key-exclusion/erasure/canonical-job-retention/anonymized-audit proof | Repeat the erasure proof after final Phase 2 worker records and encode it in Playwright in Phase 7 |
| Canonical jobs and deduplication | Complete for current adapters | Migrations 0003–0004; reconciliation tests | Re-audit after ownership/search changes |
| Deterministic geography/eligibility | Complete for current fixtures | Migration 0007; unit/integration tests | Expand adversarial listing fixtures later |
| Normalized durable user product data | Complete for current product entities | Migrations 0012–0013; normalized authoritative reads; same-user FKs; revision-checked transactional writes; fresh/upgrade/container migration proofs | Replace the bounded snapshot compatibility write with dedicated incremental APIs as domains move into agent tools |
| API authentication/authorization | Partial | Private Next routes require sessions; Scout validates signed principals; admin crawler controls | Full-stack anonymous/cross-tenant browser/API tests |
| CORS/CSRF/rate limits/body limits/errors/request IDs | Partial | Scout permissive CORS removed; Better Auth origin/CSRF and database rate limits; public errors redacted | General API limits, request IDs, rate limits, and explicit production allow-list evidence |
| Résumé PDF/manual workflow | Partial | PDF text extraction and manual onboarding | Signatures, DOCX, page/decompression limits, fixture suite |
| Indexed paginated search | Complete for Phase 3 lexical retrieval | Migration 0016; shared FTS/trigram engine; filter-bound cursors; compact list/detail API; agent integration; bounded indexed session candidates; batch persistence; fresh/upgrade PostgreSQL tests | Re-audit after ranking and scale work; production online-index rollout remains an operational limitation |
| Measured ranking quality | Partial | `rank_eval.rs` metrics plus the ignored curated-corpus PostgreSQL evaluation; 2026-08-23 re-run under `ts_rank` retrieval scoring: baseline NDCG@10 0.876 (up from 0.810 under `ts_rank_cd`), zero leakage, duplicate and unknown-evidence gates pass (D-020) | Stable improvement across expanded corpora before any default switch; latency cost check at scale |
| Search performance/scale | Partial | 4,033-job GIN query plan at 1.939 ms; bounded pages; cancelled stale client requests; batch session writes; 2026-08-23 synthetic 10k-job benchmark: all five shapes ≤104 ms p95 (debug), ~120 KB compact pages, repeatable harness committed | Release-build numbers; 100k/1m, concurrent-user, crawler-worker, reconciliation, and browser benchmarks |
| Source identity/reconciliation/coverage honesty | Complete for current adapters | Source runs, lifecycle tests, registry policy | Re-audit adapter expansion and outages |
| ATS adapter breadth | Partial | Lever/Greenhouse/Ashby/JSON-LD | Evidence-based adapter evaluation/fixtures |
| Responsible crawling | Partial | Robots, pacing, cap, retry; agent scan accepts only an enabled compiled-registry ID and uses bounded NATS dispatch | Redirect/DNS/egress/DLQ/fixture-server hardening |
| Saves/dismiss/restore | Partial | Owned normalized saved/feedback tables, undo state, authoritative hydration, two-account browser isolation | Dedicated write APIs and automated cross-browser regression tests |
| Applications/timeline | Partial | Owned normalized applications, activities, contacts, artifacts, and schema-v2 export | Dedicated APIs, reminders, and end-to-end browser coverage |
| Notifications/outbox/email abstraction | Partial | Durable owned in-app notification records and dedupe state | Scheduler, outbox, preferences, email abstraction/delivery tests |
| Agent runtime and tool policy | Complete for deterministic Phase 2 core | Persistent plans/steps/calls/approvals/events/workers; typed effect policy; bounded parallel delegation; one-attempt exact approvals; budgets, in-flight cancellation, timeouts, recovery, loop and injection tests; live search, worker, approval and async approved-source scan runs | Production model planner/evals and plan/activity/approval UI remain later phase requirements |
| Optional AI independence | Partial | Deterministic agent planner and tools; owned AI activity/provider metadata/artifacts; raw keys stripped from persistence/export | Encrypted secret storage, production model planner/router, provider outage E2E |
| Frontend architecture | Missing | 1.06 MB client chunk; monolithic client | Route/domain split and typed query layer |
| UI visual quality | Partial | Distinctive themes/screenshots; onboarding progress rail uses a labelled navigation landmark with no native/ARIA list markers plus a defensive `::marker` fallback and regression coverage | Full workspace redesign and visual approval |
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

