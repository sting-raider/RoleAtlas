# Privacy

> **Template — owner review required.** This file describes what the software does with data as built. Before operating any instance where other people can create accounts, a human owner must review this document against the actual deployment (hosting, SMTP relay, backups, log retention) and take responsibility for the privacy claims. Nothing here is legal advice or a GDPR/CCPA compliance statement.

## What RoleAtlas is

A self-hosted, qualification-first job discovery workspace: a Next.js web application backed by PostgreSQL 17 and an internal Rust Scout service that crawls public job boards through NATS JetStream. You (or your organization) run it; there is no central RoleAtlas service collecting user data.

## Data inventory

The application stores exactly the following categories of personal data in PostgreSQL:

- **Account data**: name, email address, email-verification state, optional profile image URL, role (`user`/`admin`), creation/update timestamps (`roleatlas_users`). Password accounts store only Better Auth's password hash (`auth_accounts.password`); GitHub OAuth accounts store provider account IDs and OAuth tokens (`auth_accounts`).
- **Session metadata**: session tokens with expiry, IP address, and user agent (`auth_sessions`), plus database-backed authentication rate-limit counters (`auth_rate_limits`). IP addresses are read from the header named by `AUTH_CLIENT_IP_HEADER`, which must be a header written by your trusted ingress.
- **Candidate-authored product records**, all owned by one user and never shared across accounts:
  - candidate profiles and reviewed search plans (`candidate_profiles`, `search_plans`);
  - search sessions, per-result feedback, search strategies and their revisions (`search_sessions`, `search_feedback`, `search_strategies`, `search_strategy_revisions`);
  - daily workspace state (`daily_workspaces`);
  - saved jobs with snapshots, saved/dismissed feedback, recently viewed jobs (`saved_jobs`, `user_job_feedback`, `recently_viewed_jobs`);
  - applications, activities, contacts, notifications, and notification preferences (`applications`, `application_activities`, `application_contacts`, `user_notifications`, `user_notification_preferences`);
  - generated artifacts such as tailored resumes and cover letters you asked the AI to draft (`generated_application_artifacts`);
  - agent runtime records for runs you started (`agent_runs`, `agent_plan_revisions`, `agent_steps`, `agent_tool_calls`, `agent_approvals`, `agent_workers`, `agent_run_events`).
- **AI activity records** (`ai_activity`): per-request action, provider, model, public endpoint origin, timestamps, outcome, token usage, error messages, and coarse *categories* of what was sent (for example "résumé text", "optional constraints", "candidate job summaries"). These are category labels, not the content itself; prompts and model outputs are not persisted.
- **Audit events** (`audit_events`): account created/updated/deleted, session created/revoked, export performed. Deletion events retain a one-way SHA-256 subject fingerprint instead of the email or user UUID.

### Not collected

Verified against the code on 2026-08-25:

- No third-party analytics, telemetry, advertising, or tracking scripts exist anywhere in `app/`, `lib/`, `shared/`, or the static tour under `site/`. The web server sends nothing to any analytics vendor.
- Provider API keys are supplied by the browser per request ("bring your own key"), held in memory or opt-in browser storage on your own device, forwarded to the chosen model provider, and never written to PostgreSQL, exports, logs, or server-side storage.
- Raw resume text stays in browser session storage during an AI action; the structured profile derived from it is what gets persisted.

## Where data lives

| Location | Contents |
| --- | --- |
| PostgreSQL tables (`roleatlas_users`, `auth_*`, `candidate_profiles`, `search_plans`, `search_sessions`, `daily_workspaces`, `saved_jobs`, `applications`, `application_*`, `user_notifications`, `ai_activity`, `agent_*`, `audit_events`, and related) | All of the inventory above |
| Docker volume `postgres_data` | The raw database files behind those tables |
| Docker volume `nats_data` | JetStream crawl work queue and dead-letter payloads — public job listings and crawl tasks, not user-authored content |
| Browser storage on the user's device | Opt-in remembered AI keys, current-session raw resume text |

Crawled job listings themselves (titles, descriptions, URLs from public boards) are shared canonical data, not personal data about users.

## Sharing

Data goes to two places and nowhere else:

1. Your own infrastructure: PostgreSQL, NATS, Mailpit (local development email capture), and backups you make.
2. The AI model provider the user explicitly configures: when the user invokes an AI action, the server forwards the request — including résumé-derived text and job content — to that provider using the user's own key. Which provider receives data is the user's choice per configuration; no default provider exists and AI is entirely optional.

Transactional email (verification, password reset) goes through the SMTP relay the operator configures. In development that is Mailpit, which captures mail locally and sends nothing.

## Retention and deletion

- Sessions expire after seven days; expired rows persist until the operator prunes them.
- Everything else persists until the user deletes it or deletes their account.
- **In-product export**: `GET /api/account/export` returns a complete JSON snapshot of the signed-in user's owned records (schema version 3) as a download.
- **In-product deletion**: the Settings page requires typing `DELETE` (and the password for password accounts). Deleting the account cascades through all owned tables via foreign keys — authentication, profiles, plans, sessions, searches, workspaces, saved jobs, feedback, applications, contacts, activities, notifications, AI history, agent records, provider configuration metadata, and generated artifacts — while shared canonical jobs and crawler history remain. The deletion audit event keeps only the anonymized subject fingerprint.
- Operators should also delete or rotate backups containing erased accounts according to their own retention policy; the cascade above cannot reach backup archives.

## Your responsibilities as an operator

This is self-hosted software. When you run an instance for other people you become the data controller for whatever it collects:

- Publish and maintain your own privacy notice based on this document plus your deployment specifics (hosting country, backup location, SMTP provider, TLS termination).
- Secure the instance per the checklist in [SECURITY.md](SECURITY.md); leaked databases expose everything listed above.
- Honor deletion requests made outside the product (for example by restoring from backup exclusions) within whatever timeline your jurisdiction requires.
