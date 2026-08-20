# RoleAtlas data model

This document describes the live PostgreSQL model after migrations 0011–0013. It is an implementation record, not a future schema proposal.

## Ownership boundary

RoleAtlas has two deliberately different data classes:

- **Shared index data** — canonical jobs, source references, source runs, observations, reconciliation history, registry evidence, geography, and eligibility evidence. These records are not candidate data and remain available while individual accounts are deleted.
- **User-owned product data** — accounts, candidate profiles, search plans and sessions, feedback, saved jobs, applications, notifications, provider metadata, AI activity, generated artifacts, and workspace preferences. Every live row has a non-null `user_id` or belongs to a parent that is constrained to the same user.

The authenticated server session supplies the user ID. Browser-supplied IDs are not ownership evidence.

## Shared entities

Migrations 0001–0010 define the shared crawler and search index. The important ownership invariant is that deleting a user never deletes `jobs`, `job_source_refs`, `sources`, `source_runs`, observations, or job lifecycle history. User tables reference canonical jobs with `ON DELETE SET NULL` where retaining the user's historical snapshot is useful.

## Identity and authentication

Migration `0011_auth_and_tenancy.sql` adds:

| Table | Purpose | Deletion behavior |
| --- | --- | --- |
| `roleatlas_users` | Stable account identity and role | Account erasure root |
| `auth_sessions` | Better Auth database sessions | Cascades with user |
| `auth_accounts` | Credential/OAuth identities | Cascades with user |
| `auth_verifications` | Expiring verification/reset tokens | Expiry-cleaned; not candidate data |
| `auth_rate_limits` | Authentication abuse counters | Operational retention |
| `audit_events` | Sensitive-action evidence | User references become null; deletion fingerprint remains in metadata |
| `data_export_requests` | Reserved asynchronous export lifecycle | Cascades with user |
| `account_deletion_requests` | Reserved asynchronous deletion lifecycle | Cascades with user |

Existing records are assigned to the non-login bootstrap user `00000000-0000-4000-8000-000000000001`. The bootstrap identity has no credential account and is never silently claimed by the first signup.

## User-owned career data

Migration 0011 adds non-null ownership to existing entities:

- `candidate_profiles`
- `search_plans`
- `search_sessions`
- `search_feedback`
- `daily_workspaces`

Migration `0012_normalized_user_product_entities.sql` adds normalized business entities:

| Table | Primary identity | Notes |
| --- | --- | --- |
| `saved_jobs` | `(user_id, job_ref)` | Snapshot and archived state are durable |
| `search_strategies` | `(user_id, id)` | Active, paused, archived, or draft strategy |
| `search_strategy_revisions` | `(user_id, strategy_id, id)` | Per-strategy version is unique |
| `user_job_feedback` | `(user_id, id)` | Dismiss/relevance reason and undo state |
| `applications` | UUID plus unique `(user_id, job_ref)` | Current stage and follow-up state |
| `application_activities` | `(application_id, id)` | Ordered application timeline |
| `application_contacts` | `(application_id, position)` | User-entered contacts |
| `user_notifications` | `(user_id, id)` | Per-user dedupe key, read, and dismissed state |
| `recently_viewed_jobs` | `(user_id, job_ref)` | Bounded returning-user context |
| `ai_activity` | `(user_id, id)` | Provider/model/purpose/outcome metadata, never credentials |
| `user_provider_configurations` | `(user_id, provider)` | Non-secret provider metadata and optional future credential reference |
| `generated_application_artifacts` | UUID | User-owned, optionally attached to an application |

Migration `0013_tenant_parent_integrity.sql` adds composite `(user_id, id)` keys and same-user foreign keys. A child cannot point to another account's profile, plan, session, or application even if a future repository method forgets an ownership predicate.

## Workspace compatibility bridge

`daily_workspaces` remains a versioned JSON presentation/preferences document so existing installations and the current client can migrate without losing state. Business entities listed above are authoritative when a workspace is read. `services/scout/src/user_workspace.rs` hydrates the response from normalized tables.

During the compatibility period, a workspace save transaction:

1. locks the account's `local` workspace row;
2. checks `expected_revision`;
3. returns HTTP 409 on a stale revision;
4. replaces that account's bounded normalized collection state from the submitted snapshot;
5. increments the workspace revision atomically.

This prevents simultaneous tabs from silently overwriting one another. The replace-and-reinsert bridge is intentionally temporary; domain-specific incremental APIs should replace it as Phase 2–4 features gain dedicated write paths.

## Erasure and retention

- Deleting `roleatlas_users` cascades through every user-owned and authentication table.
- Shared canonical jobs and source history remain intact.
- `audit_events.actor_user_id` and `subject_user_id` use `ON DELETE SET NULL`.
- The account-deletion hook stores only a one-way, 32-character SHA-256-derived subject fingerprint so an operator can prove an erasure event occurred without retaining the deleted UUID or email.
- Raw résumé files are not persisted by this model.
- Raw AI provider keys are not stored in PostgreSQL or normal browser persistence. Current keys are session-memory only; encrypted long-lived BYOK storage remains future work.

## Indexes and integrity

Owner-first indexes support profile, plan, session, feedback, workspace, strategy, application, notification, AI activity, and provider queries. Partial indexes cover unread notifications, follow-up dates, and canonical job references where present. Check constraints bound enum-like states and JSON shapes.

PostgreSQL row-level security is not currently enabled. The system instead uses three enforced layers: authenticated Next.js routes, signed internal assertions to Scout, and owner predicates/composite tenant foreign keys in PostgreSQL. RLS remains a defense-in-depth candidate after connection-role separation is introduced.

## Migration verification

Migrations are embedded in the Rust binaries. `services/scout/build.rs` invalidates Cargo builds when migration files change, and `services/scout/Dockerfile` copies that build script before compilation.

The 0011–0013 chain has been verified against:

- a completely empty disposable PostgreSQL database;
- a restored representative pre-0013 database;
- the existing development database without discarding prior records;
- a clean database migrated by the built Scout container image.

Do not edit an applied migration. Future changes must be additive.
