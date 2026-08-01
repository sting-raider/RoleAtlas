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
