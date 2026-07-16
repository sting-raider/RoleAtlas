# Work Order 6 handoff

Date: 2026-07-17

Branch: `workorder-6-daily-usable-product`

Baseline: `82af73d` (`master`, Work Order 5 merged)
Current implementation HEAD before this handoff commit: `35b37c4`

## Stop-point status

This is a safe, runnable stop point. Feature work was intentionally stopped at the user's request.

- The complete Docker stack is running: web, API, coordinator, worker, PostgreSQL, and NATS.
- The production app is available at `http://localhost:3000`.
- The temporary development server on port 3001 was stopped.
- The temporary untracked `.env.local` IPv6 override was removed.
- No Work Order 6 commit has been pushed yet.
- The branch has not been merged into `master`.
- The safe-point handoff commit contains this document and the screenshots in `docs/screenshots/`; no feature implementation was added after the stop request.

Do not merge this branch yet. Work Order 6 still needs final documentation, full-suite verification, and a small amount of manual accessibility QA.

## Work completed

### 1. Product-flow audit

`docs/product-flow-audit.md` documents the existing first-launch through returning-user journey, API calls, persistence, confusing states, mobile/accessibility problems, and hidden features.

Commit: `784c1b5` — `docs: audit the daily product journey`

### 2. Migration checkout safety

Added `.gitattributes` so SQLx migration checksums are stable across Windows CRLF checkouts.

Commit: `e3e4157` — `fix: pin sqlx migrations to LF checkouts`

### 3. Durable daily-workspace foundation

Added migration `services/scout/migrations/0010_daily_workspace.sql`, server persistence, Next proxy routes, and additive daily-product models for:

- onboarding progress,
- candidate facts, goals, constraints, preferences, and mobility,
- versioned search strategies,
- saved jobs,
- application records and timelines,
- feedback and learned-preference suggestions,
- persistent notifications,
- recent views and returning-user state.

Commit: `9b5b317` — `feat: add durable daily workspace foundation`

### 4. Daily product experience

Added:

- guided, skippable manual/resume onboarding,
- Home/Radar,
- Discover cards and full job drawer,
- Searches, Saved, Applications, Profile, Sources, and Settings workspaces,
- dismiss reasons and undo,
- AI request previews and activity transparency,
- service status UI,
- reusable visual tokens, responsive layouts, and reduced-motion rules,
- global resume-location inference instead of country-specific UI logic.

Commit: `835b231` — `feat: deliver the daily RoleAtlas experience`

### 5. Persisted search execution detail

Added persisted execution counts, query detail, source-expansion state, and rerun support through `app/api/search-sessions/[id]/rerun/route.ts` and the existing Rust search-session service.

Commit: `ef5daf2` — `feat: expose durable search execution details`

### 6. Search constraint enforcement

The live review proved that saved `freshnessDays`, `excludedTerms`, and `excludedCompanies` were visible but not enforced by server retrieval. They now constrain the PostgreSQL search session and are persisted in query constraints. The integration test covers stale and excluded records.

Commit: `274575f` — `fix: enforce persisted search constraints`

### 7. Trusted search context in the client

Fixed several live-path problems:

- manual onboarding no longer marks empty fields confirmed,
- onboarding moves strategy state atomically instead of losing it between steps,
- the active persisted session scopes Discover and filter counts after refresh,
- session search scores, ranks, provenance, and eligibility are rendered,
- later general-feed refreshes cannot overwrite persisted search evidence during deduplication,
- manual-profile users see a deterministic strategy score instead of an irrelevant “upload resume” prompt,
- Home uses the active session's jobs,
- search results restore after browser refresh.

Commit: `b7e78ec` — `fix: preserve trusted daily search context`

### 8. Complete-stack diagnostics

Added:

- `GET /api/health`,
- `npm run doctor`,
- checks for web, Scout/crawler queue, registry, PostgreSQL through Scout, NATS monitoring, and Docker Compose,
- clear reduced-mode output.

Commit: `1d3277f` — `feat: add complete-stack diagnostics`

### 9. Role-level retrieval evidence

Live QA showed that unrelated titles could be admitted when separate query words appeared anywhere in a description. Retrieval now requires at least one role-query term in the title or the full role phrase in the description. The PostgreSQL integration test covers the weak-description false positive.

Commit: `241e550` — `fix: require role-level search evidence`

### 10. Structured source-registry rendering

Production Sources initially crashed because the API returns structured company metadata (`{ name, domain }`) while the UI expected a string. `app/sourceDisplay.ts` now supports both legacy and structured shapes, with a unit regression.

Commit: `35b37c4` — `fix: render structured source registry metadata`

## Requirement-by-requirement completion matrix

This matrix follows the Work Order 6 implementation order. “Implemented” means a live code path exists. “Verified” is stated separately so the next model does not confuse UI/schema presence with end-to-end completion.

| Work Order 6 area | Implementation state | Verification state | Remaining action |
| --- | --- | --- | --- |
| 1. Product-flow audit | Complete in `docs/product-flow-audit.md`. | Documentation inspected against live routes before implementation. | Reconcile the audit's “target state” notes with the final behavior during documentation closeout. |
| 2. First-run onboarding | Implemented: Welcome, profile source, review facts, career goals, location/eligibility, hard constraints, strategy preview, and first search. It is skippable, resumable, backward-navigable, adaptive, AI-optional, and supports manual/resume sources. | Manual path completed live. Resume path, inferred/confirmed behavior, adaptive questions, and state transitions pass automated tests. | Manually run a synthetic PDF through the complete resume path; perform keyboard/focus QA. |
| 3. Facts/goals/constraints/preferences/mobility separation | Implemented additively in `candidateProfile.ts` and `dailyProduct.ts`; existing profiles remain compatible. Citizenship, authorization, salary, and relocation are not inferred. | Automated inferred-versus-confirmed and persistence tests pass; manual Profile workspace inspected. | Add any final migration-compatibility evidence to the verification report. |
| 4. Search-strategy editor | Implemented: edit, deterministic regenerate, save revision, duplicate, pause, archive, rerun, and compare revisions. AI suggestions remain previews until approval. | Revision/duplicate/rerun metadata automated test passes; rerun worked live. | Manually exercise edit/save/compare/pause/archive without deleting the retained QA strategy. Fix misleading `Open geography` presentation for mobility-based targets. |
| 5. Home/Radar | Implemented with strong matches, new-since-last-visit, expansion observations, active searches, coverage issues, closed saved jobs, due applications, recent views, weekly counts, and notifications. | Dashboard-count tests pass; Home rendered live and screenshot captured. | Consider an explicit restore/loading state to prevent transient count changes while persisted state hydrates. |
| 6. Discover redesign | Implemented information-dense cards, eligibility status, score, reasons, uncertainty, freshness, save/dismiss/open/prepare, full evidence drawer, hard disqualifiers, lifecycle state, source confidence, original label, canonical URL, and similar jobs. Active persisted sessions now scope results and retain server evidence through feed refreshes. | Live search, score/provenance, drawer, eligibility uncertainty, save, and source details verified. Hard-disqualifier count regression passes. | Add a browser-level hard-disqualifier screenshot/check if a safe fixture is available; do not invent one in live data. |
| 7. Dismiss, feedback, and undo | Implemented all requested reasons, persisted feedback, safe strategy suggestions, undo, “Why am I seeing this?”, and reset learned preferences. Hard facts are not silently modified. | Automated persistence/undo test and live Wrong-location/Undo flow passed. | Verify feedback survives a complete browser restart in the final manual pass. |
| 8. Searches workspace | Implemented active/paused/archived strategy states, last run, new count, coverage, failures, version, edit/rerun/history, query details, source expansion, and persisted server execution counts. | Live persisted reruns passed; execution-count and database integration tests passed earlier. | Finish manual edit/compare/status actions and rerun the full PostgreSQL suite. |
| 9. Saved jobs and applications | Implemented all requested stages, dates, next action, follow-up, notes, contacts, document references, interview prep, source-job status, and activity timeline. No auto-submit path exists. | Save, Preparing transition, fields, timeline, and refresh persistence verified live. | Verify remaining stage transitions with local synthetic data or unit tests; do not falsely mark a real application Applied. |
| 10. In-app notifications | Implemented persistent/deduplicated read, dismiss, new-results, expansion, degraded coverage, closing/closed saved job, follow-up, and application-action notifications. No email/push was added. | Notification dedupe/read/dismiss tests pass; live result/application notifications were visible. | Add focused automated cases for closing and follow-up notification generation if coverage is not already explicit enough. |
| 11. Sources and coverage | Implemented trusted source table, adapter, health, last scan, listing count, hiring metadata, failures, coverage explanation, and careers-URL validation submission. Source relevance is explicitly separated from listing eligibility. | Live view rendered all 16 sources after fixing structured company metadata; unit regression passes. | Recheck production, not only HMR/dev, after the final full Docker rebuild; do not submit an arbitrary URL during QA. |
| 12. AI-provider UX | Implemented NVIDIA NIM, DeepSeek/existing providers, Ollama/local providers, model/base URL, verification, privacy text, clear-key control, activity history, and pre-request preview with provider/model/purpose/data/network path/input size. Architecture/security are unchanged. | NVIDIA NIM setup and connection-test preview inspected live. AI preview/provider security tests pass. | No real-key call was made. A live connection test requires explicit user credentials and approval. |
| 13. Focused visual redesign | Implemented reusable warm-neutral tokens, semantic accents, typography, radii, shadows, spacing, navigation, card systems, and responsive/dark-mode foundations in `app/globals.css`. | Major screens captured from the live app; build and rendered tests pass. | Perform the final calm dark-mode visual pass if dark mode is actually exposed; do not expand into decorative work. |
| 14. Functional motion | Implemented subtle transitions for results, save/dismiss, loading, and dialogs, with `prefers-reduced-motion` overrides. | Source assertion confirms reduced-motion CSS exists. | Manually emulate reduced motion and verify no blocking/continuous motion or layout regression. |
| 15. Setup diagnostics | Implemented service detection, complete/degraded/web-only messaging, database/NATS/Scout/crawler/AI state, `/api/health`, and `npm run doctor`. | `npm run doctor` passed with five HTTP targets and six Compose services earlier; Settings showed complete stack live. | Rerun after the final clean Docker rebuild and capture the exact output in the completion report. |
| 16. Accessibility/responsiveness | Semantic roles, labels, dialog headings, focus hooks, 760px layout, mobile navigation, visible focus styles, and reduced-motion CSS are implemented. | Source assertions and sub-760px live screenshots pass. | Keyboard-only, focus-return, screen-reader naming, contrast, explicit 390px, tablet, error recovery, and reduced-motion runtime checks remain. |
| 17. Documentation | Audit and this handoff exist. Screenshots exist. | Handoff reconciled with commits and live checks. | README, progress, decisions, source support, AI security, and final Work Order 6 verification report still require updates. |

## Required-test coverage matrix

| Requested test | Current evidence | Status before final handoff |
| --- | --- | --- |
| Manual onboarding | `tests/daily-product.test.ts`; live manual onboarding | Passing/verified |
| Resume onboarding | `tests/daily-product.test.ts`, `tests/candidate-profile.test.ts` | Automated passing; live PDF pending |
| Inferred versus confirmed | Candidate/daily-product tests | Passing |
| Strategy editing | Daily-product revision test; Searches UI source/render assertions | Passing; broader live actions pending |
| Profile persistence | `services/scout/tests/daily_workspace.rs`; live refresh | Passing earlier/live verified; final DB rerun pending |
| Dashboard counts | Daily-product dashboard test | Passing |
| Discover cards | Rendered source tests plus live browser | Passing/live verified |
| Hard-disqualifier visibility | Dashboard exclusion test and card/drawer implementation | Unit passing; dedicated browser fixture pending |
| Dismiss and undo | Daily-product test and live browser | Passing/live verified |
| Feedback persistence | Daily workspace/search feedback paths and live feedback | Passing earlier; final DB rerun pending |
| Search history | `services/scout/tests/search_sessions.rs`; live Searches history | Passing/live verified |
| Progressive source results | Search-session/source orchestration tests and live session status | Passing earlier/live verified |
| Notifications | Daily-product notification test and live UI | Passing |
| AI request preview | Daily-product/provider-security tests and live modal | Passing/live verified |
| Service-status display | Daily-product service-mode test, `npm run doctor`, live Settings | Passing/live verified |
| Reduced motion | `tests/rendered-html.test.mjs` source assertion | Automated source check only; runtime pending |
| Keyboard navigation | Onboarding focus-source assertion | Incomplete manual coverage |
| Mobile rendering | CSS breakpoint source assertion and sub-760px screenshots | Partial; explicit 390px/tablet pass pending |
| Persistence across refresh | Workspace normalization test, Rust integration, live refresh | Passing/live verified |

## Files changed from `master`

The branch diff currently contains:

```text
.gitattributes
app/DailyWorkspaces.tsx
app/FirstRungApp.tsx
app/OnboardingFlow.tsx
app/api/health/route.ts
app/api/resume/route.ts
app/api/search-sessions/[id]/rerun/route.ts
app/api/workspace/route.ts
app/candidateProfile.ts
app/dailyProduct.ts
app/globals.css
app/jobIdentity.ts
app/jobs.ts
app/layout.tsx
app/sourceDisplay.ts
docs/product-flow-audit.md
package.json
scripts/doctor.mjs
services/scout/migrations/0010_daily_workspace.sql
services/scout/src/bin/api.rs
services/scout/src/search.rs
services/scout/tests/daily_workspace.rs
services/scout/tests/search_sessions.rs
tests/candidate-profile.test.ts
tests/daily-product.test.ts
tests/job-identity.test.ts
tests/rendered-html.test.mjs
tests/source-display.test.ts
```

This handoff and `docs/screenshots/*` belong to the final safe-point documentation commit, separate from the ten implementation commits above.

## Live flow verified

The following was exercised against the running local stack, not inferred from component existence:

1. Completed manual onboarding with a synthetic global profile.
2. Confirmed separate facts, goals, mobility, hard constraints, and a deterministic strategy.
3. Persisted the candidate profile and plan.
4. Ran a full-index search and selected/checked 12 verified sources.
5. Reran the persisted strategy after rebuilding the server.
6. Verified freshness and exclusion enforcement: the old 82-result session became 12 current results.
7. Verified role-evidence tightening: the same session became 2 title-relevant current results.
8. Verified strategy scores, provenance, eligibility uncertainty, original label, canonical URL, last-verified time, and compensation in the job drawer.
9. Saved a job and observed the Saved count update.
10. Dismissed a different result as `Wrong location`; the result disappeared and Undo restored it.
11. Started application preparation; the record appeared in Applications.
12. Added a next action, contact placeholder, and notes.
13. Reloaded the production app and confirmed saved/application state returned.
14. Verified the Sources view after the structured-company fix; all 16 configured sources rendered with adapter, hiring metadata, latest scan, health, and observed-job count.
15. Verified Settings reports the complete stack and treats AI as optional.
16. Opened NVIDIA NIM configuration and verified the connection-test preview shows provider, model, purpose, data categories, external/local status, RoleAtlas network path, and estimated input size before a request.
17. Verified the responsive navigation and AI-provider modal at a sub-760px viewport.

No external AI request was sent and no user API key was used.

## Synthetic QA data retained locally

The browser/database currently contains synthetic verification state. It was left intact because it is useful for the next model's continuation and no destructive cleanup was authorized.

- Profile: `Taylor Jordan`
- Profile ID: `c2a4d8bc-6b16-41cd-a91f-c0be076f0a0f`
- Plan ID: `f28a45d0-060a-4acf-b7ac-f711a0e54bae`
- Search session: `38174ae4-f6de-4a62-9445-92bc8d89b04e`
- Latest result count: 2
- Workspace: one strategy, one saved job, one Preparing application
- Application next action: `Confirm location eligibility before applying.`

Do not mistake this synthetic profile or application for user data. Ask before deleting persisted state.

## Test status at the stop point

Most recent passing frontend checks after the final Sources fix:

```text
npm run typecheck
npm run lint
npm run test:unit       # 40 passed
npm run test:rendered   # 5 passed
npm run build
```

Most recent passing Rust/search checks before the frontend-only Sources fix:

```text
cargo fmt --manifest-path services/scout/Cargo.toml --all
cargo test --manifest-path services/scout/Cargo.toml --lib                 # 24 passed
$env:DATABASE_URL='postgres://firstrung:firstrung@127.0.0.1:5432/firstrung'
cargo test --manifest-path services/scout/Cargo.toml --test search_sessions -- --ignored --nocapture
```

The complete Docker images were rebuilt after the engine changes. The web image was rebuilt after the Sources fix. `npm run doctor` passed earlier with all five HTTP checks and six Compose services available.

The final required Work Order 6 verification matrix has **not** been rerun as one clean end-to-end gate after `35b37c4`. The next model must do that before claiming completion.

## Screenshots

Captured from the live app:

- `docs/screenshots/workorder-6-home.png`
- `docs/screenshots/workorder-6-discover.png`
- `docs/screenshots/workorder-6-searches.png`
- `docs/screenshots/workorder-6-applications.png`
- `docs/screenshots/workorder-6-mobile-ai-settings.png`

The screenshots intentionally use synthetic QA data. The Home screenshot was taken before the final tightened rerun and therefore shows the then-current dashboard counts; Discover and Searches show the persisted-search UI, and Applications proves durable tracking fields.

## Remaining work, in priority order

### A. Finish required verification

Run the complete gate exactly as requested:

```text
npm run format:check
npm run lint
npm run typecheck
npm run registry:validate
npm test
cargo fmt --manifest-path services/scout/Cargo.toml --all -- --check
cargo clippy --manifest-path services/scout/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path services/scout/Cargo.toml
```

Run every ignored PostgreSQL integration target explicitly against a disposable test database:

```powershell
$env:DATABASE_URL='postgres://firstrung:firstrung@127.0.0.1:5432/firstrung'
cargo test --manifest-path services/scout/Cargo.toml --test daily_workspace -- --ignored --nocapture
cargo test --manifest-path services/scout/Cargo.toml --test search_sessions -- --ignored --nocapture
cargo test --manifest-path services/scout/Cargo.toml --test reconciliation -- --ignored --nocapture
```

First inspect `services/scout/tests/` for any additional ignored integration targets and run those too. Do not use the retained QA database for destructive migration tests. Create temporary databases and verify both paths:

1. fresh install: apply migrations 0001 through 0010 to an empty database;
2. upgrade: apply migrations 0001 through 0009, seed representative Work Order 5 profiles, plans, sessions, provenance, feedback, source runs, and job history, then apply 0010 and prove those records remain intact.

Finally rebuild and verify the complete service path:

```powershell
docker compose up --build -d
docker compose ps
npm run doctor
Invoke-RestMethod http://localhost:3000/api/health
Invoke-RestMethod http://localhost:8080/health
Invoke-RestMethod http://localhost:8222/healthz
```

Record exact output, exit codes, service health, and any unavailable check in the final verification report. An unavailable external credential is a documented manual limitation, not a reason to weaken fixture-based CI.

### B. Complete manual accessibility checks

Still required:

- keyboard-only navigation and visible focus through onboarding, nav, cards, dialogs, and feedback menus,
- focus return after closing drawers/modals,
- screen-reader labels on repeated card actions,
- explicit `prefers-reduced-motion` runtime check (source and automated assertions exist),
- a 390px phone pass and a tablet pass after resetting any temporary viewport override,
- loading, empty, and API-error recovery in reduced mode.

The browser automation session became slow on the 600-card production DOM; do not interpret automation timeouts as application failures without checking console logs and a screenshot. The actual Sources crash was separately reproduced, traced, fixed, and regression-tested.

### C. Resolve or document small product gaps

1. The Searches card currently describes geography from `plan.locations`. The verified synthetic plan stored target countries in `mobility.preferredCountryCodes`, so the card displayed `Open geography` even though UK/Germany mobility goals existed. Fix the presentation and, if appropriate, derive plan locations from confirmed mobility without duplicating the canonical eligibility model.
2. Home can briefly render transient public-feed estimates before the asynchronous persisted workspace/session restore finishes. Consider a short restoring state so counts do not visibly jump.
3. The production bundle still emits the existing non-failing >500 kB chunk warning.
4. Resume onboarding is covered by automated tests but was not manually exercised with a synthetic PDF during this pass.
5. No real NVIDIA NIM, DeepSeek, or other provider call was made. Keep tests fixture-based; a live credential check requires the user.
6. The 16-source Work Order 5 registry limitation remains intentional and must be stated accurately.

### D. Finish documentation

Update these files for Work Order 6 before the final branch push:

- `README.md`
- `docs/progress.md`
- `docs/implementation-decisions.md`
- `docs/source-support.md`
- `docs/ai-provider-security.md`

Add a final verification report with exact commands, automated versus manual checks, before/after user journey, disconnected functionality, known limitations, and recommended Work Order 7. Do not claim that schema or components are live unless the complete route was verified.

### E. Final commit and delivery

After all gates pass:

1. Make focused documentation/verification commits.
2. Confirm `git status --short` is empty.
3. Push `workorder-6-daily-usable-product`.
4. Confirm remote HEAD with `git ls-remote`.
5. Do not merge into `master` without explicit user instruction.

## Work Order 7 boundary

Only begin Work Order 7 after Work Order 6 is fully verified, documented, pushed, and explicitly accepted. The recommended scope is source scale and operational reach: additional verified ATS adapters, a broader but evidence-backed source catalog, scheduled refresh orchestration, source reliability tooling, and notification delivery beyond the app. It should not reopen canonical identity, reconciliation, global eligibility, opportunity taxonomy, registry trust, provider security, or persisted search-session architecture without a reproducible tested defect.

Do not add bulk questionable sources, auto-trust AI-generated URLs, auto-submit applications, or claim whole-market/global coverage. Preserve the product rule established in Work Order 5: a smaller verified catalog with honest coverage is better than a large unreliable registry.

## Recommended continuation commands

```powershell
git switch workorder-6-daily-usable-product
git status --short
git log --oneline master..HEAD
docker compose up -d
npm run doctor
```

Then read, in order:

1. `ROLEATLAS_REBUILD_PLAN.md`
2. `docs/WORKORDER_6_HANDOFF.md`
3. `docs/product-flow-audit.md`
4. `docs/progress.md`
5. `docs/implementation-decisions.md`
6. `docs/source-support.md`
7. `docs/ai-provider-security.md`

Inspect the live code paths before trusting this handoff. Preserve the Work Order 1–5 identity, reconciliation, eligibility, registry, provider-security, and search-session architecture unless a tested defect proves a change is needed.
