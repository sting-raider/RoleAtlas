# Production decisions

## D-001 — PostgreSQL remains the canonical product database

Decision: keep one PostgreSQL cluster for authentication, user-owned product state, and the shared Scout index. Use schemas/table prefixes and least-privilege roles rather than introducing D1 as a second authority.

Why: the running application, ten migrations, reconciliation engine, and search sessions already depend on transactional PostgreSQL behavior. Splitting identity/product state into D1 would make ownership joins, account erasure, backups, and local deployment harder.

Rejected: browser storage as durable authority; Cloudflare D1 for auth while Scout remains PostgreSQL; replacing PostgreSQL with a new service.

## D-002 — Supported Next.js Node self-hosting is the canonical web runtime

Decision: migrate `dev`, `build`, and `start` from Vinext/Vite compatibility mode to the supported Next.js 16 Node runtime and self-host it behind a reverse proxy. Keep `site/` as the independent static GitHub Pages showcase.

Why: production authentication, PostgreSQL drivers, secure server-only credential handling, upload limits, observability, and a hardened Docker deployment need one supported runtime. The current `vinext@0.0.50` path is experimental and the Cloudflare D1 scaffolding is unused by the real data plane.

Rejected: treating GitHub Pages as the application; building auth on the experimental compatibility layer; moving the entire Scout/data plane to Cloudflare in this project.

## D-003 — Better Auth provides authentication primitives

Decision: use maintained Better Auth with PostgreSQL-backed database sessions. Enable email/password with verification/reset delivery adapters and configurable GitHub OAuth. Keep provider credentials optional so local development can use captured email and password auth without third-party services.

Why: it supplies password hashing, sessions, secure cookies, verification/reset flows, OAuth, revocation, and rate limiting without custom cryptography, and its official integration supports Next.js 16 and PostgreSQL.

Rejected: custom password/session cryptography; Auth.js Credentials plus a custom password lifecycle; a mandatory hosted identity vendor.

## D-004 — Web is the public trust boundary; Scout is internal

Decision: browsers authenticate to the Next.js web application. Web derives the user from the session and forwards an authenticated internal identity assertion to Scout over a private network. Scout validates the assertion and enforces ownership again in repository queries. Administrative endpoints additionally require an admin role.

Why: this keeps public cookies and CSRF handling out of crawler services while still providing defense in depth at the data layer. Browser-supplied user IDs are never authoritative.

Rejected: exposing Scout directly with permissive CORS; trusting only frontend visibility; placing user identity in query/body parameters.

## D-005 — Existing development data belongs to an explicit bootstrap account

Decision: additive migrations create a deterministic bootstrap user and assign all current unowned profile/plan/session/workspace/feedback records to it. Fresh installations also have a documented optional bootstrap flow. Jobs and source-run data remain shared.

Why: it preserves current user data and gives every private row a non-null owner before authorization enforcement.

Rejected: deleting local data, leaving null owners indefinitely, or silently assigning old data to the first person who signs in.

## D-006 — Search quality changes require evaluation evidence

Decision: retain deterministic eligibility as a separate gate. Add indexed retrieval and explicit ranking features alongside the current heuristic, then compare both on curated fixtures before switching defaults.

Why: higher counts or plausible-looking cards are not evidence of better relevance. Unknown eligibility cannot become positive evidence.

Rejected: LLM-only ranking; embeddings as a hard dependency; replacing the heuristic without measured precision, recall, NDCG, MRR, disqualifier leakage, duplicate rate, and latency.

## D-007 — Internal identity assertions are signed and independently authorized

Decision: Next.js derives the principal from Better Auth and signs a short-lived HMAC assertion over timestamp, HTTP method, path and query, user UUID, and role. Scout rejects missing, stale, malformed, or invalid assertions and still includes `user_id` in every private query. Administrative operations check the signed role separately.

Why: a plain forwarded `x-user-id` header would become an authorization bypass if Scout were accidentally reachable or another internal caller were compromised. Signing the exact request prevents a valid assertion from being replayed against a different path, method, user, or role, while repository predicates provide a second isolation boundary.

Rejected: browser-supplied identity headers; a static bearer token plus unsigned user ID; relying only on the Next.js UI/API layer; sharing Better Auth cookies with Scout.

## D-008 — Historical data is preserved but not silently claimed

Decision: migration 0011 owns existing local records with a deterministic bootstrap user that has no credential account. It cannot sign in. A future operator-only claim flow may explicitly transfer that data, but creating the first normal account never inherits it automatically.

Why: automatic first-user adoption is surprising and unsafe on a reused database, while deletion would violate the preservation requirement. A visible, non-login owner makes the migration reversible and auditable.

Rejected: a known bootstrap password; first-signup ownership takeover; null owners; destructive cleanup.

## D-009 — Onboarding progress stays semantic while visual indices stay explicit

Decision: expose onboarding steps as a labelled navigation landmark and render a single two-digit index inside each step button. Do not use native or ARIA list semantics when the product already renders its own indices: Chromium and assistive-browser styles can surface an additional marker column for list items. The visual index is decorative; the button's accessible name remains the step title and `aria-current="step"` identifies the active step.

Why: the labelled navigation landmark and named buttons preserve a clear keyboard and screen-reader experience while making it structurally impossible for browser marker placement to create a second, misaligned number column.

Rejected: relying only on marker-suppression CSS; showing both native and custom numbering; positioning native markers with fragile offsets. Marker suppression remains as a defensive hydration fallback, while the component structure is the primary guarantee.

## D-010 — Normalized entities are authoritative behind a compatibility workspace bridge

Decision: store saved jobs, strategies, revisions, feedback, applications, timelines, contacts, notifications, recent views, AI activity, provider metadata, and artifacts in normalized tables. Continue accepting the versioned workspace snapshot temporarily, but hydrate business collections from normalized rows and require an expected revision for writes.

Why: this preserves existing daily-use behavior and development data while making business state queryable, tenant-owned, exportable, and ready for dedicated agent tools. Optimistic concurrency prevents simultaneous tabs from silently overwriting one another.

Rejected: leaving the JSON workspace as the durable authority; a destructive one-shot client rewrite; maintaining two independent authorities indefinitely.

## D-011 — Same-user parentage is a database invariant

Decision: add composite `(user_id, id)` candidate/profile/session/application keys and use composite foreign keys for every user-owned parent relationship.

Why: route and repository checks are mandatory but are not sufficient defense against a future write path accidentally attaching one tenant's child to another tenant's parent. PostgreSQL can reject that state before it exists.

Rejected: relying only on UUID uniqueness; triggers that duplicate ordinary foreign-key behavior; postponing parent integrity until row-level security.

## D-012 — Provider keys remain session-only until encrypted server storage exists

Decision: strip raw keys from browser persistence, workspace snapshots, PostgreSQL provider rows, AI activity, artifacts, exports, and logs. Persist only provider/model/endpoint/verification metadata and keep a supplied key in the current session.

Why: durable plaintext browser storage is not acceptable, and pretending that a database field is a secret manager would create a worse security boundary. Session-only keys provide safe reduced convenience until envelope encryption or a deployment secret manager is implemented.

Rejected: localStorage persistence; plaintext PostgreSQL credentials; misleading `remember key` behavior.

## D-013 — Deletion audits retain a one-way subject fingerprint

Decision: before account erasure, store a truncated SHA-256-derived fingerprint of a domain-separated user UUID in audit metadata. User foreign keys are set to null by the cascade and neither email nor raw UUID is retained.

Why: operators need evidence that an erasure action occurred, but the audit trail must not recreate the deleted identity. Domain separation and one-way hashing make the residual identifier useful for event correlation without being a login or ownership key.

Rejected: retaining the email; retaining the raw UUID in JSON; deleting the audit event entirely.

## D-014 — Crawl messages are bounded work, not historical storage

Decision: use JetStream work-queue retention with a 128 MiB byte limit, seven-day age limit, and discard-new backpressure. Migrate a legacy limits-retention stream only after both the pending-task and result consumers prove that every message is acknowledged.

Why: crawl payloads can contain large ATS boards, while PostgreSQL is already the durable authority for canonical jobs, source runs, reconciliation history, and frontier state. Retaining acknowledged queue payloads indefinitely consumed 1.44 GB and prevented new work from being published.

Rejected: treating JetStream as a second historical database; silently deleting a stream with pending deliveries; increasing disk limits without bounding retention; discarding the oldest unprocessed work.

## D-015 — The career agent is a persistent policy runtime

Decision: model providers may propose bounded plans and typed tool arguments, but a server-side runtime owns leases, budgets, validation, authorization, execution, observations, retries, approvals, and audit history. Every external result is persisted as data-only evidence before another action can depend on it.

Why: prompt endpoints cannot safely resume work, enforce exact-call approvals, prevent duplicate non-idempotent actions, or prove what happened. A provider-independent deterministic planner keeps the core useful while model routing is unavailable.

Rejected: one giant career prompt; browser-only agent state; raw database/NATS/HTTP tools; treating tool output as new instructions; allowing the model to enforce its own budget or permissions.

## D-016 — Agent-requested crawling resolves stable IDs inside Scout

Decision: `request_source_scan` carries only a stable registry source ID and an internal idempotency key. Scout independently verifies that the source is compiled, verified, auto-enqueue enabled, and not database-disabled before it resolves the endpoint and publishes a retry-stable task to NATS.

Why: keeping the URL behind the deterministic Scout boundary makes a model-proposed arbitrary URL structurally incapable of becoming crawler work. A stable source-run receipt lets the agent wait, resume, and observe without claiming that queued work already succeeded.

Rejected: allowing the agent or web executor to translate arbitrary URLs; trusting registry geography as listing eligibility; returning success before JetStream acknowledges; completing the agent run while a source scan is still running.

## D-017 — Parallel career analysis is persisted bounded delegation

Decision: represent shortlist fan-out as the registered read-only `analyze_jobs_parallel` capability. The coordinator creates same-user worker records and lets each worker invoke only `analyze_job`; the parent run's concurrency, step, tool-call, retry, timeout, cancellation, policy, and audit controls remain authoritative.

Why: independent job analyses benefit from concurrency, but unconstrained sub-agents would create a second authorization and budget system. Persisted workers make partial results, interruption recovery, ownership, and actual concurrency inspectable across restarts.

Rejected: in-memory `Promise.all` without worker records; a raw generic sub-agent prompt; allowing workers to choose arbitrary tools or HTTP targets; counting only the parent delegation call while hiding child budget use; discarding successful analyses when one worker fails.

## D-018 — Human approval is a one-attempt capability

Decision: an approval is bound to one persisted tool-call ID and is atomically marked consumed when the runtime takes that call for execution, before the external effect begins. Policy requires the approved ID to equal the executing call ID and requires an unexpired record.

Why: consuming only after success would let a failed, timed-out, or interrupted external call replay on the next resume with stale authorization. One-attempt consumption makes the failure mode conservative and auditable; uncertain non-idempotent outcomes pause instead of retrying.

Rejected: reusable approval windows; matching only by tool name; consuming after a successful response; allowing a new argument payload to reuse an earlier approval ID.

## D-019 — One indexed lexical engine serves discovery, agents, and persisted searches

Decision: make the Scout PostgreSQL full-text/trigram query the canonical lexical retrieval boundary for public discovery, the registered `search_jobs` agent tool, and persisted search-session candidate selection. Use filter-bound stable cursors, a compact preview response plus an on-demand detail endpoint, bounded 100-row pages, and batched session persistence. Keep the existing ranking heuristic until the offline evaluation proves a replacement.

Why: leaving the new index beside the old 5,000-row `ILIKE` session scan would create two search products with different recall, latency, and failure behavior. A shared retrieval implementation makes query limits and filter semantics enforceable in one place, while preserving the deterministic eligibility layer and avoiding an unsupported ranking-quality claim.

Rejected: keeping the direct agent SQL search; loading full descriptions in every result card; offset pagination over a changing index; N+1 result/provenance writes; replacing the baseline rank before precision, recall, MRR, NDCG, leakage, duplicate, unknown-evidence, and latency evidence exists.

## D-020 — Exact count CTE plus `ts_rank` retrieval scoring

Decision: compute the canonical search page as a bounded top-N ranked CTE paired with an exact filtered-count CTE that share one admission/filter predicate constant, and score retrieval with `ts_rank(..., 32)` instead of `ts_rank_cd(..., 32)`. The synthetic 10k benchmark (`tests/search_benchmark.rs`) is added alongside as the repeatable measurement harness for these shapes.

Why: the previous `COUNT(*) OVER()` window forced every matching row to be produced before LIMIT could trim a page — the exact pattern the Phase 0 audit criticized. The shared-predicate pair keeps page and total consistent without copy-paste drift, at the cost of evaluating the filter twice per request; the benchmark records that cost at 10k jobs (all shapes ≤ 104 ms p95, debug build). The scoring swap was measured on the curated corpus before being kept: baseline-heuristic NDCG@5 rose from 0.788 to 0.870 because heuristic-tied listings now order by retrieval relevance rather than job-ID, with zero disqualifier leakage and unchanged duplicate/unknown handling.

Rejected: keeping the window count (materializes the whole match set per request); an approximate or cached count (breaks honest totals for a changing index); reverting to `ts_rank_cd` (strictly worse tie ordering on measured evidence); bundling further ranking-feature changes into this switch (kept isolated so the evaluation attributes cleanly). Cursor caveat recorded: cursors minted before deployment keep validating because the filter hash does not cover the scoring formula, so scores shift meaning once across the upgrade boundary — accepted as a one-time continuation hiccup rather than versioning cursors.
