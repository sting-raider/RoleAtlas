# Work Order 6 verification report

Date: 2026-07-22

Branch: `workorder-6-daily-usable-product`

Baseline: `82af73d` (`master`, Work Order 5 merged)

## Delivered behavior

The verified daily path is:

```text
Open RoleAtlas
→ resume or manual onboarding
→ review inferred and confirmed evidence
→ confirm goals, mobility, and hard constraints
→ inspect/edit a deterministic strategy
→ search the existing full index immediately
→ watch selected verified sources expand progressively
→ evaluate explicit eligibility, match evidence, and uncertainty
→ save, dismiss/undo, or prepare an application
→ return to persisted searches, notifications, and application actions
```

Before Work Order 6, most of these capabilities existed as disconnected engine routes, modals, browser-only state, or infrastructure-oriented controls. The application now exposes them through Home, Discover, Searches, Saved, Applications, Profile, Sources, and Settings while preserving the Work Order 1–5 canonical identity, reconciliation, eligibility, registry, orchestration, and provider-security boundaries.

## Implementation evidence

- Onboarding supports PDF resume and fully manual entry, is skippable/resumable/backward-navigable, labels inferred evidence, and works without AI.
- Candidate facts, goals, constraints, preferences, mobility, and search strategy are separate additive models. Sensitive facts are not inferred.
- Strategies support edit, deterministic regenerate, save revision, duplicate, pause, archive, rerun, and compare. AI suggestions require approval.
- Home uses persisted sessions/jobs/workspace state for matches, new counts, searches, coverage issues, saved closures, due application actions, recent views, weekly summary, and notifications.
- Discover keeps an active persisted session authoritative even at zero results. Cards and drawers expose eligibility, uncertainty, hard disqualifiers, score evidence, missing requirements, source freshness/confidence, original employment label, canonical URL, last verification, compensation, similar roles, and preparation.
- Feedback reasons, dismissal, undo, explanation, safe strategy suggestions, and reset-learned-preferences persist without changing hard facts.
- Searches exposes persisted server execution and source-expansion counts. Saved/Application workspaces retain the complete requested stages and activity metadata. No application submission exists.
- Sources shows the trusted configured registry and current evidence without claiming whole-market coverage. Settings shows provider previews/activity and complete/reduced service state.
- Dialogs/drawers use shared focus management. Closed mobile navigation is absent from the accessibility tree; phone and tablet layouts avoid horizontal overflow; reduced-motion CSS disables nonessential transitions.

## Migrations

Work Order 6 adds only `services/scout/migrations/0010_daily_workspace.sql`.

- Fresh installation: an empty disposable PostgreSQL database applied migrations 0001–0010; `_sqlx_migrations` contained 10 successful rows and `daily_workspaces` existed.
- Upgrade: a second disposable database applied 0001–0009, received representative profile, plan, source, source run, job, source reference, source-run observation, search session/query/result/match/feedback/source-selection records, then applied 0010. All 14 representative records remained and a schema-version-1 workspace was inserted successfully.
- Both disposable databases were dropped after verification. The retained QA database was not reset.

## Automated verification

The following exact commands passed on the final code:

```powershell
npm run format:check
npm run lint
npm run typecheck
npm run registry:validate
npm test
C:\Users\aliza\.cargo\bin\cargo.exe fmt --manifest-path services/scout/Cargo.toml --all -- --check
C:\Users\aliza\.cargo\bin\cargo.exe clippy --manifest-path services/scout/Cargo.toml --all-targets -- -D warnings
C:\Users\aliza\.cargo\bin\cargo.exe test --manifest-path services/scout/Cargo.toml
$env:DATABASE_URL='postgres://firstrung:firstrung@127.0.0.1:5432/firstrung'
C:\Users\aliza\.cargo\bin\cargo.exe test --manifest-path services/scout/Cargo.toml -- --ignored
docker compose up --build -d
docker compose ps
npm run doctor
```

Results:

- 44 TypeScript unit tests passed.
- The production web build passed; 5 rendered-HTML tests passed.
- Registry validation passed for 16 enabled verified sources: 6 Ashby and 10 Greenhouse.
- Rust formatting and strict all-target Clippy passed.
- 24 Rust library tests and 1 worker test passed.
- PostgreSQL `daily_workspace`, `reconciliation`, and `search_sessions` integration tests passed.
- The six Compose services were up; PostgreSQL was healthy.
- Doctor reported Web UI, Scout API/crawler queue, registry, PostgreSQL via API, and NATS monitor available.

The only build diagnostic is the existing non-failing warning that a minified client chunk exceeds 500 kB.

## Manual production checks

These checks were performed against the running Docker production build:

- Completed manual onboarding with a synthetic universal profile; reviewed facts/goals/mobility/constraints and ran the generated strategy.
- Reran a persisted full-index search, observed source selection/coverage and role-level results, inspected job provenance/eligibility/compensation/source detail, saved a job, dismissed another with `Wrong location`, undid the dismissal, and prepared an application.
- Added an application next action/contact/notes and confirmed the state returned after reload.
- Rendered all 16 trusted sources with structured company metadata.
- Verified Settings reports the complete stack and treats AI as optional.
- Opened NVIDIA NIM settings: initial focus entered the dialog, Shift+Tab wrapped within it, Escape closed it, and focus returned to the opener. The request preview showed provider, model, purpose, data categories, local/external state, RoleAtlas proxy path, and estimated input size.
- Stopped Scout API and confirmed the product changed to reduced-mode messaging instead of implying durable discovery. Restarted it and confirmed the complete-stack doctor result.
- At 390 × 844: the closed sidebar was hidden from the accessibility tree; opening moved focus to Close navigation; Escape restored focus to Open navigation; no horizontal overflow occurred.
- At 820 × 1024: the compact 76 px navigation and main content had no horizontal overflow.

No external AI request was sent, no user credential was used, no arbitrary careers URL was submitted, and no real application status was fabricated.

## Screenshots

- `docs/screenshots/workorder-6-home.png`
- `docs/screenshots/workorder-6-home-restoring.png`
- `docs/screenshots/workorder-6-discover.png`
- `docs/screenshots/workorder-6-searches.png`
- `docs/screenshots/workorder-6-searches-final.png`
- `docs/screenshots/workorder-6-applications.png`
- `docs/screenshots/workorder-6-mobile-ai-settings.png`

Screenshots contain synthetic QA state, not a user profile or real application.

## Disconnected functionality and known limitations

- The verified crawler registry is intentionally limited to 16 boards and at most 12 selections per search. It is not global job-market coverage.
- Arbeitnow, Remotive, Jobicy, Himalayas, and Remote OK remain transient supplemental feeds outside canonical reconciliation.
- Resume onboarding and inferred/confirmed behavior pass automated tests, but the final manual pass did not upload a synthetic PDF.
- A real NVIDIA NIM, DeepSeek, or other provider connection needs a user credential and was not attempted. AI remains optional.
- The browser test surface could not emulate the OS reduced-motion preference; CSS and rendered tests verify the override, while phone/tablet runtime behavior was checked directly.
- Notification delivery is in-app only. Email and push belong to a later work order.
- RoleAtlas prepares application material and tracks activity but does not auto-submit applications.
- The retained local synthetic QA profile/search/application is intentionally preserved; destructive cleanup was not authorized.
- The original `ROLEATLAS_REBUILD_PLAN.md` was not present in the repository or accessible Downloads path during final recovery. The complete Work Order 6 request, repository code, audit, progress, decisions, and historical handoff were used as the implementation contract.

## Recommended Work Order 7

Focus on verified source scale and operations: additional ATS adapters, a larger evidence-backed registry, scheduled refresh/retry/reliability tooling, a deliberate plan for reconciling public feeds, bundle code-splitting, and notification delivery beyond the app. Do not reopen canonical identity, reconciliation, global eligibility, opportunity taxonomy, source trust, provider security, or persisted search sessions without a reproducible tested defect. Never bulk-import questionable sources, auto-trust model-generated URLs, claim whole-market coverage, or auto-submit applications.
