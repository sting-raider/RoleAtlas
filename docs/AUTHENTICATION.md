# Authentication and tenant isolation

RoleAtlas uses Better Auth 1.6 with PostgreSQL-backed sessions on the canonical Next.js runtime. The web application is the public authentication boundary; Scout is an internal service that independently verifies short-lived signed assertions.

## Supported account flows

- Email/password signup and sign-in.
- Email verification when `AUTH_REQUIRE_EMAIL_VERIFICATION=true`.
- Password-reset email.
- Sign-out and database-session revocation.
- Optional GitHub OAuth when both GitHub client variables are configured.
- Authenticated JSON data export.
- Permanent account deletion.

Development email is captured by Mailpit. Tests and local development do not send real mail.

## Session model

Better Auth owns password hashing and token generation; RoleAtlas implements no custom password cryptography. Sessions are stored in `auth_sessions`, use HTTP-only cookies, expire after seven days, rotate/update after one day, and require a fresh session for Better Auth operations that demand it. Production runtime cookies are secure. Trusted origins come from `AUTH_TRUSTED_ORIGINS` and default to the configured public URL.

Authentication endpoints use database-backed rate limits. Sign-in, signup, and password reset have stricter per-path limits than the global authentication limit.

## Request trust boundary

Private Next.js routes call `sessionPrincipal(request.headers)` and derive a stable `userId` and role from the Better Auth session. They never accept a browser-provided user ID as ownership evidence.

For Scout requests, `app/api/scoutProxy.ts` signs:

- timestamp;
- HTTP method;
- exact path and query;
- authenticated user UUID;
- authenticated role.

Scout validates the HMAC using `SCOUT_INTERNAL_SECRET`, rejects stale or malformed assertions, and applies the user ID again in repository SQL. An assertion cannot be replayed for another path, method, role, or user. Manual source seeding and operator metrics require an authenticated `admin` assertion.

Scout should be reachable only from the private application network in production. Its signed assertion is defense in depth, not permission to expose it publicly.

## Tenant enforcement

Isolation is enforced at three layers:

1. Next.js session checks on every private browser API.
2. Scout assertion validation and user-scoped repository methods.
3. PostgreSQL non-null owners, owner-first indexes, and composite same-user foreign keys.

Unknown or guessed UUIDs are treated as absent when the authenticated account does not own them. Shared canonical jobs remain queryable without exposing saved state, profiles, feedback, applications, AI history, or provider metadata from another account.

## Account export

`GET /api/account/export` requires an authenticated session and reads a repeatable, read-only PostgreSQL snapshot. Schema version 2 includes account metadata and all current user-owned product collections. It sets `Cache-Control: private, no-store` and an attachment filename. Provider configuration export contains metadata only; it does not contain raw API keys.

The export action is audited after the snapshot is committed. Export history associated with a subsequently erased user loses its direct user references through `ON DELETE SET NULL`.

## Account deletion

The Settings UI requires the user to type `DELETE`; password accounts also provide their password to Better Auth. Better Auth invokes the deletion hook immediately before erasure. The hook records a one-way subject fingerprint, not the user's email or raw UUID.

Deleting the account cascades through authentication, profile, search, workspace, saved-job, feedback, application, notification, AI, provider-metadata, and artifact tables. Shared canonical jobs and crawler history remain.

After success, account-scoped browser keys are removed and the browser returns to sign-in.

## Provider credentials

Provider keys are not written to `localStorage`, workspace JSON, provider configuration rows, AI activity, artifacts, logs, or account exports. The current application keeps a supplied key in memory/session scope only. Persisted provider configuration contains provider, model, validated base URL, profile note, verification metadata, and an optional non-secret future credential reference.

Encrypted server-side long-lived BYOK storage and a deployment secret-manager integration are not implemented yet and must not be implied by the UI or documentation.

## Configuration

Required runtime values:

- `DATABASE_URL`
- `BETTER_AUTH_SECRET` with production entropy
- `BETTER_AUTH_URL` or `ROLEATLAS_PUBLIC_URL`
- `SCOUT_INTERNAL_SECRET` with at least 32 bytes

Relevant optional values:

- `AUTH_TRUSTED_ORIGINS`
- `AUTH_REQUIRE_EMAIL_VERIFICATION`
- SMTP variables used by `lib/auth-email.ts`
- `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`
- `AUTH_CLIENT_IP_HEADER`, set only to a header written by the trusted ingress

Production must terminate TLS before the web service and must not publish PostgreSQL, NATS, or Scout directly.

## Verification evidence

Current automated and runtime coverage includes:

- signature-binding unit tests;
- anonymous/private and owner-scoped route behavior in source and integration coverage;
- PostgreSQL adversarial tests for cross-user search IDs, feedback, parent links, application activities, and generated artifacts;
- fresh and upgrade migration tests;
- a two-account browser check that restored one account's state without exposing it to another;
- a live export/deletion scenario proving schema-v2 export, raw-key exclusion, a 20-table erasure cascade, preserved canonical jobs, and a surviving anonymized deletion audit fingerprint.

Playwright authentication and account-lifecycle coverage is still required before final production readiness. Current runtime evidence must not be mistaken for the Phase 7 browser regression suite.
