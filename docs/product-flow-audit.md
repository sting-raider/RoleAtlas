# RoleAtlas product-flow audit

Date: 2026-07-16

Baseline: `master` at `82af73d` (`Merge branch 'workorder-5-global-coverage'`)

Audit scope: the live browser flow, the React client, Next-compatible API routes, Rust scout API, PostgreSQL migrations, and degraded public-feed behavior before Work Order 6 changes.

## Executive finding

The Work Order 5 search engine is present and testable, but the product around it is still a single oversized Discover screen. A new user is automatically prompted for a PDF resume and can only upload it or browse without matching. There is no manual-profile route, no staged onboarding, no Home or Searches workspace, and no clear separation between candidate facts, goals, constraints, preferences, mobility, and search strategy.

The returning-user path also stops short of a daily workflow. Saves, application stages, prepared dossiers, and the AI key are browser-local; the resume is session-only. Search sessions and the structured candidate profile are server-persisted, but their controls are buried in Career profile and cannot be edited, duplicated, paused, archived, rerun, or compared as first-class searches. Feedback is limited to four event names and has no visible controls or undo.

The live full-index screen loaded hundreds of records into one React view during the audit. The visible count remained capped, but the growing in-memory job array triggered expensive global filtering, sorting, deduplication, and rendering updates; browser interactions eventually timed out. This is a daily-use blocker and should be addressed with a bounded display model and progressive server-backed results rather than by weakening the search engine.

## Baseline verification discrepancy

All unchanged baseline checks passed, including TypeScript, rendering tests, registry validation, Rust formatting, clippy, and Rust unit tests. Both ignored PostgreSQL integration tests pass against a fresh database.

The same integration tests failed against the existing Windows development database because migrations 7-9 were checked out with CRLF line endings while SQLx had recorded the LF checksums. Byte-for-byte comparison confirmed that LF-normalizing the checked-out files reproduces the stored checksums. The migration SQL and database state are not divergent; repository line-ending policy is missing. Work Order 6 should add a Git attributes rule that keeps migration files at LF without editing applied migration contents.

## Journey audit

### 1. First launch

- **Current screen:** Discover renders immediately. After 350 ms, a modal titled "Let your resume drive the search" opens when no session resume exists.
- **API calls:** initial public feed loading occurs during server rendering; the client requests `GET /api/candidate-profile`, `GET /api/search-sessions`, `GET /api/local-scout?action=jobs&limit=400`, then polls the local index every 30 seconds.
- **Persisted state:** candidate profile, active search plan, and search sessions may return from PostgreSQL. Saves, applications, dossiers, provider settings, and AI activity are loaded from browser storage. Resume evidence is loaded only from session storage.
- **Confusing behavior:** the modal calls itself one-time setup even though the resume disappears with the browser session. "Required for matching" implies that manual profiles are unsupported. Discover, infrastructure status, and crawler controls compete for attention before the user has stated a goal.
- **Duplicated controls:** resume upload appears in the top bar, automatic modal, Career profile, and job drawers. Provider setup appears in the top bar, Career profile, right rail, and drawers.
- **Missing feedback:** there is no progress indicator showing setup completion or an explanation of which services are needed for durable operation.
- **Blocking states:** no manual onboarding route; no useful guided state when public feeds and the local scout are unavailable.
- **Empty state:** the zero-results card says to broaden filters even when no filters are selected and the real cause is unavailable sources.
- **Mobile:** the large hero precedes the primary task; key top-bar labels disappear; the filter sheet and navigation use separate full-screen overlays.
- **Accessibility:** dialogs have roles and labels, but opening focus is not deliberately moved, closing does not explicitly restore focus, and Escape handling is not evident in the component.
- **Hard to discover:** persisted candidate/search data may already exist, but first launch still centers the missing session resume instead of offering to resume the saved plan.

### 2. Profile creation

- **Current screen:** PDF upload modal only. The alternative is "Browse without matching."
- **API calls:** `POST /api/resume` parses a text-based PDF. No AI request is made at upload time.
- **Persisted state:** extracted resume text is placed in session storage after confirmation; it is not stored in PostgreSQL. A derived structured profile is held in component state until review.
- **Confusing behavior:** the privacy message is accurate, but users are not told that closing the browser loses the evidence used for matching. The product has no fully manual profile form.
- **Duplicated controls:** upload can be launched from four surfaces.
- **Missing feedback:** there is no staged parser progress, scanned-PDF recovery guidance, or manual fallback when extraction is incomplete.
- **Blocking states:** PDF-only and text-PDF-only; no DOCX and no manual creation.
- **Empty state:** browsing is allowed but produces no profile-specific ranking.
- **Mobile:** the upload modal becomes a bottom sheet but still contains the full copy and controls in one step.
- **Accessibility:** the file input has a visible custom label, but validation errors are not connected with `aria-describedby` and no error summary is focused.
- **Hard to discover:** deterministic profile building and search-plan generation happen only after upload and are not explained before the action.

### 3. Resume upload or manual profile

- **Current screen:** resume upload exists; manual profile does not.
- **API calls:** `POST /api/resume`, followed later by `POST /api/candidate-profile` only after review.
- **Persisted state:** raw resume is not persisted; structured evidence is persisted after review.
- **Confusing behavior:** a user cannot start with known facts and goals, or correct a parsing failure without first having a parse result.
- **Blocking states:** manual onboarding is entirely missing.
- **Required correction:** introduce an explicit profile-source choice and make upload and manual entry equal paths.

### 4. Profile review

- **Current screen:** one large `ProfileReviewModal` combines extracted name, preferred location, skills, role searches, experience, work authorization, sponsorship, relocation, opportunity types, and experience ceiling.
- **API calls:** `POST /api/candidate-profile` saves both the profile and plan; `POST /api/search-sessions` immediately runs the confirmed plan.
- **Persisted state:** JSONB `candidate_profiles.profile` and `search_plans.plan`; earlier active plans are marked inactive.
- **Confusing behavior:** resume facts, desired roles, hard eligibility constraints, and ranking preferences are mixed. Confidence is shown for only some fields. Confirmation is applied broadly, including mobility fields, from one submit.
- **Duplicated controls:** opportunity type and experience ceiling also appear as Discover filters.
- **Missing feedback:** there is no field-by-field inferred/confirmed legend, no review checklist, and no indication that search begins immediately.
- **Blocking states:** at least one role query is required; no save-draft path separate from "Review later."
- **Mobile:** the long modal requires extensive scrolling and lacks a persistent step indicator.
- **Accessibility:** native inputs are labelled, but related groups are visual `div` elements rather than fieldsets with legends.
- **Hard to discover:** the existing mobility evidence model is capable of preserving inference provenance, but the screen does not expose it clearly.

### 5. Goals and constraints

- **Current screen:** embedded in profile review and a free-text provider note.
- **API calls:** persisted through `POST /api/candidate-profile`; the provider note stays in browser storage and is sent only during explicit model actions.
- **Persisted state:** goals and constraints are fields inside profile/plan JSON; they do not have a clear product-level separation.
- **Confusing behavior:** the optional AI note appears to be the only home for schedule or industry constraints, even though AI is optional. Citizenship is present in the type but must never be inferred.
- **Missing feedback:** questions are not adaptive; students, senior candidates, remote-only users, relocating users, and licensed professionals see no tailored follow-ups.
- **Blocking states:** constraints cannot be reviewed independently from a search execution.

### 6. Search-plan generation

- **Current screen:** generated silently after resume parsing; a subset is editable inside profile review. Career profile later shows only up to three role queries and a short history list.
- **API calls:** `POST /api/candidate-profile`; optional AI ranking may append role queries and save the plan again.
- **Persisted state:** one active `search_plans` row per profile, plus plan snapshots on every search session.
- **Confusing behavior:** the AI matching path can expand role queries and persist the expanded plan after an explicit match action, but the user does not approve each strategy change. Adjacent roles, synonyms, exclusions, freshness, and ranking priorities are not visible.
- **Missing feedback:** no revision history, compare, duplicate, pause, archive, or save-without-running controls.
- **Hard to discover:** plan snapshots and inactive plans already provide the foundation for revisions, but no workspace exposes them.

### 7. Source expansion

- **Current screen:** the NATS scout card and "Scout control center" modal focus on queue/fetch/index/failure counts and a custom careers URL field.
- **API calls:** `POST /api/search-sessions` selects and queues sources; `GET /api/search-sessions/:id` polls orchestration; crawler health uses `GET /api/local-scout?action=health|stats`; manual URLs use `POST /api/local-scout`.
- **Persisted state:** selected search sources, source runs, progress, and coverage are persisted by Work Order 5.
- **Confusing behavior:** the product says the scout is always on even when the complete stack is unavailable. Infrastructure metrics are more prominent than search relevance and coverage impact.
- **Missing feedback:** the user cannot see which sources were selected for a search, why, which were fresh or stale, or when existing indexed results are already usable.
- **Blocking states:** custom source submission is disabled without the local stack; no validation-pending state is visible.
- **Hard to discover:** source-directed expansion already runs from confirmed plans, but is explained only through status prose.

### 8. Progressive results

- **Current screen:** Discover imports search-session results and polls while stages are active. Separately, it imports up to 400 general index jobs every 30 seconds and performs client filtering/sorting over the merged array.
- **API calls:** `POST /api/search-sessions`, polling `GET /api/search-sessions/:id`, plus `GET /api/local-scout?action=jobs...`.
- **Persisted state:** session results, ranks, matches, queries, coverage, and orchestration progress are persisted server-side.
- **Confusing behavior:** search progress is a sentence banner rather than a durable activity view. The general-index count and the current search-session count are mixed on one screen.
- **Missing feedback:** no "new since last visit," expansion-added, or per-stage counts; no stable loading skeleton.
- **Blocking states:** the live audit became unresponsive as the job array grew, even though only 30 cards were intended to be visible.
- **Hard to discover:** persisted server progress contains richer counts than the client exposes.

### 9. Job details

- **Current screen:** a right-side drawer opened by a card. It shows summary, reasons, one gap, tags, score explanation, AI dossier tabs, status, save, and original listing.
- **API calls:** opening emits `POST /api/search-feedback` with `viewed` only for scout jobs in the active session. Explicit application preparation calls `POST /api/ai/prepare`.
- **Persisted state:** viewed feedback is server-persisted only when an active search session can be associated; dossier is browser-local; selected job is transient.
- **Confusing behavior:** match score and eligibility are adjacent but not cleanly separated. Full provenance, last verification, original employment label, canonical URL, source confidence, similar jobs, and hard-disqualifier details are incomplete or hidden.
- **Missing feedback:** no "Why am I seeing this?" explanation tied to strategy, no important-uncertainty summary, and no explicit closed-job treatment in the drawer flow.
- **Accessibility:** the drawer is a dialog-like overlay but is an `aside` without a dialog role, focus trap, or explicit focus restoration.

### 10. Save or dismiss

- **Current screen:** save buttons exist on cards and drawers. Dismiss does not exist.
- **API calls:** save emits `POST /api/search-feedback` only for eligible scout/session IDs. Unsaving sends no compensating event.
- **Persisted state:** saved IDs live under the legacy key `firstrung-saved-jobs` in local storage; a subset of save events live in PostgreSQL feedback.
- **Confusing behavior:** a saved job can disappear if it is no longer present in the currently loaded in-memory job set. There is no feedback taxonomy or undo.
- **Missing feedback:** all requested reasons—wrong role, seniority, location, eligibility, compensation, company, duplicate, applied, closed, and "show fewer"—are absent.
- **Blocking states:** no reset-learned-preferences action and no strategy-change suggestion flow.

### 11. Application tracking

- **Current screen:** four-column board: Preparing, Applied, Interview, Offer. Job drawers also offer Closed.
- **API calls:** only `applied` feedback is sent to the server; tracking itself has no API.
- **Persisted state:** a map of job ID to stage and generated dossiers are stored in local storage.
- **Confusing behavior:** stages do not cover recruiter screens, assessments, technical/final interviews, rejection, withdrawal, or closed-before-application. There are no dates, next actions, follow-ups, notes, contacts, artifacts, or activity timeline.
- **Empty state:** identical placeholder copy appears in every column and gives no next action.
- **Mobile:** columns collapse into one long vertical page with no stage filter or summary.
- **Hard to discover:** users set application status only inside the job drawer.

### 12. Returning user

- **Current screen:** returns directly to Discover. Browser-local saves/applications/dossiers/provider may reappear; persisted profile and search sessions load asynchronously.
- **API calls:** same boot calls as first launch. There is no last-visit or notification API.
- **Persisted state:** split between PostgreSQL, local storage, and session storage without a visible durability contract.
- **Confusing behavior:** if the session resume is gone, the upload modal opens even though a confirmed structured profile and plan may exist. There is no "what changed" dashboard.
- **Missing feedback:** no new-match count, weekly summary, due follow-up, closed-save warning, recently viewed list, or source degradation alert.
- **Blocking states:** a user cannot continue the daily loop from a single Home view.

## Current API and persistence map

| Concern | Current API | Durable store | Gap |
| --- | --- | --- | --- |
| Resume parsing | `POST /api/resume` | None; text in session storage | No manual path; no cross-session evidence |
| Candidate and active plan | `GET/POST /api/candidate-profile` | PostgreSQL JSONB | Facts/goals/constraints/preferences not visibly separated |
| Search execution/history | `GET/POST /api/search-sessions`, `GET /api/search-sessions/:id` | PostgreSQL | No first-class workspace or editable revisions |
| Search feedback | `POST /api/search-feedback` | PostgreSQL | Only viewed/saved/dismissed/applied; no undo or visible controls |
| General index | `GET /api/local-scout?action=jobs...` | PostgreSQL jobs | Oversized client merge and mixed search context |
| Registry/coverage | `GET /api/registry` and scout source endpoints | Registry plus source runs | No user-facing Sources workspace |
| Saves | None | Local storage | Not durable across browsers/services; closed-state handling absent |
| Applications | None | Local storage | Minimal stages and metadata; no timeline |
| Dossiers | `POST /api/ai/prepare` | Local storage | No artifact references or activity integration |
| Notifications | None | None | Entire feature absent |
| Provider configuration | `POST /api/ai/test`; action routes | Local storage when opted in | No settings workspace or per-action confirmation preview |
| Service status | crawler proxy endpoints | Transient | No consolidated setup/doctor experience |

## Accessibility and responsive summary

Existing positives include labelled primary navigation, labelled search and filter controls, semantic headings, visible focus styles, and a global `prefers-reduced-motion` override. The current CSS has breakpoints at 1280, 980, 760, and 480 pixels.

The main risks are focus management for modal/drawer overlays, missing semantic fieldsets, errors not programmatically associated with fields, icon-only mobile controls losing visible context, dense cards that hide key evidence at narrow widths, and two independent mobile overlay systems. Keyboard and mobile rendering need automated coverage, not only stylesheet inspection.

## Work Order 6 implementation guardrails from the audit

1. Preserve Work Order 5 search execution, orchestration, eligibility, and provenance APIs; expose them through clearer workspaces.
2. Add a reusable onboarding state machine with resume and manual paths, resumable drafts, adaptive questions, and explicit AI consent.
3. Store separated profile sections additively inside compatible JSON documents; never infer authorization, citizenship, salary expectations, or relocation willingness.
4. Use persisted search sessions and server coverage counts for Search and Home displays.
5. Add durable daily-workspace records for saves, applications, notifications, views, strategy revisions, and feedback metadata rather than extending browser-only state.
6. Bound client job rendering and progressive updates to keep the application responsive.
7. Make degraded mode explicit: public-feed-only browsing is transient; full persistence and source expansion require the local services.

8. Keep every AI action optional and preceded by an action-specific request preview.

## Work Order 6 resolution

The audit findings were addressed without replacing the Work Order 1–5 engine. The live journey now begins with resumable resume/manual onboarding, separates inferred evidence from confirmed facts and user goals, previews an editable deterministic strategy, runs persisted full-index searches with progressive source expansion, and returns to a Home dashboard instead of dropping every visit into an unscoped feed.

Discover now preserves the active search session as its authoritative context and exposes eligibility, uncertainty, hard disqualifiers, match evidence, source freshness, canonical source details, save/dismiss/undo, and preparation actions. Searches, Saved, Applications, Profile, Sources, and Settings expose the previously hidden durable capabilities. Notifications, recently viewed jobs, follow-ups, service degradation, provider request previews, keyboard focus handling, reduced-motion rules, and phone/tablet layouts close the principal feedback, accessibility, and returning-user gaps identified above.

The remaining limitations are product boundaries rather than unresolved audit defects: the verified automatic registry is still 16 boards; public feeds remain transient; AI requires an explicitly supplied credential for a real external call; the production client bundle has a non-failing size warning; and no email, push delivery, auto-application, or Work Order 7 source-scale expansion was added.
