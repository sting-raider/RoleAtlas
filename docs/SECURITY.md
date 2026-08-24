# Security policy

RoleAtlas is a self-hosted job-discovery workspace: a Next.js web application backed by PostgreSQL 17 and an internal Rust Scout service that crawls public job boards through NATS JetStream. This document describes how to report security issues, what is in scope, and how reports are handled.

## Supported versions

There are no tagged releases yet, so no historical version line receives patches. Security fixes land on the `master` branch and operators track it by commit. When release tags exist, this section will name the branches or tags that receive fixes.

## Reporting a vulnerability

**Report channel: REPLACE-ME — set up a real inbox (for example `security@your-domain.example`) or a private advisory tracker before operating any instance reachable by other people, then replace this paragraph.**

Until that channel exists, use GitHub's private vulnerability reporting on [sting-raider/RoleAtlas](https://github.com/sting-raider/RoleAtlas) if it is enabled for the repository.

Please include:

- the affected component (web app, Scout API/coordinator/worker, Compose files) and commit hash;
- the steps or proof-of-concept needed to reproduce;
- the impact you believe it enables;
- whether you want credit and under which name.

Do not open a public issue for something you believe is exploitable.

## What we need from you

- Give us a reasonable window to fix before any public disclosure. We will agree on a disclosure date with you.
- Do not access, modify, or exfiltrate data that is not yours. A proof-of-concept against your own account or test data is sufficient.
- Do not run denial-of-service load, spam campaigns, or social-engineering attacks.
- Only test instances you own or have explicit permission to test.

## Response targets

These are targets, not guarantees; the project currently has no paid on-call rotation.

- Acknowledgement: within 7 days of a report arriving at the configured channel.
- Triage decision (accepted / wontfix with reasons): within 14 days.
- Fix or mitigation for accepted reports: within 90 days, coordinated with you for anything requiring user action.

## Scope: in

- The Next.js web application in `app/` and `lib/`, including authentication flows (`lib/auth.ts`), session handling, account export/deletion routes, and AI provider proxying.
- The Rust Scout service in `services/scout/src`, including its HTTP API (`bin/api.rs`), signed internal assertions, egress policy, robots handling, and extraction pipeline.
- The Docker Compose definitions and migration files as shipped.
- Cross-tenant isolation failures: one account reading or writing another account's profiles, saved jobs, applications, workspaces, notifications, AI history, or agent records.

## Scope: out

- Vulnerabilities in dependencies; report those upstream first, then tell us so we can track the upgrade.
- The static GitHub Pages tour under `site/` — it contains no backend and no user data by design.
- Self-inflicted compromise of your own host: exposed database ports, leaked `.env` files, disabled TLS, or running containers you did not build from this repository.
- Missing hardening features that are documented as not implemented, such as encrypted server-side storage of provider keys (BYOK keys are supplied per request and never stored server-side).
- Reports from automated scanners without a demonstrated impact path; include evidence that the issue is real.

## Design invariants worth testing against

`AGENTS.md` records the product invariants. The ones most relevant to security review, all enforced in code today, are:

- Never trust a browser-supplied user ID. Web routes derive identity server-side from the Better Auth session; Scout independently verifies short-lived HMAC-SHA256 assertions over timestamp, method, exact path, user ID, and role using the shared `SCOUT_INTERNAL_SECRET`. Assertions expire after 60 seconds and cannot be replayed for another path, method, role, or user.
- Jobs and source runs are shared infrastructure; candidate records are user-owned. Ownership is re-checked in repository SQL, not only at the route layer, and unknown IDs owned by someone else return "not found" rather than a permission error that confirms existence.
- Scout is an internal service. Its API must not be published publicly; the signature layer is defense in depth, not a substitute for network isolation.
- AI is optional and sandboxed by policy: it cannot decide eligibility, trust or enqueue sources, alter confirmed facts without approval, or submit applications.
- Logs never contain résumé contents, credentials, authorization headers, profiles, notes, or prompts.

## Hardening checklist for operators

Before exposing an instance beyond your own machine:

1. Generate unique `BETTER_AUTH_SECRET` and `SCOUT_INTERNAL_SECRET` values with at least 32 random bytes each; Scout refuses to start with a shorter internal secret.
2. Terminate TLS before the web service and keep PostgreSQL, NATS, Mailpit, and Scout off the public internet.
3. Set `AUTH_REQUIRE_EMAIL_VERIFICATION=true` and configure a real SMTP relay instead of Mailpit.
4. Leave `SCOUT_ALLOW_PRIVATE_HOSTS` unset so crawler egress cannot reach private or loopback addresses, and consider `SCOUT_EGRESS_ALLOWLIST`.
5. Review `docs/PRIVACY.md` for where user data lands, and `docs/OPERATIONS.md` for backup/restore and monitoring.
