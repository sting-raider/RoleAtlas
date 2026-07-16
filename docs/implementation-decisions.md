# Implementation decisions

## 2026-07-15 — Work Order 1

1. PostgreSQL is the canonical identity boundary because it is the only durable job index in the running architecture. The unused D1 scaffold is not extended.
2. Identity priority is source-scoped job ID, canonical apply/listing URL, then a fingerprint of normalized company, title, location, and posting date. Company/title alone is never sufficient.
3. Provider source IDs include the board namespace (for example `lever:company`) because ATS job IDs may only be unique within a tenant.
4. Tracking parameters and fragments are removed from canonical URLs, while identity-bearing parameters such as `gh_jid` are retained.
5. Database uniqueness is enforced by application-level resolution plus indexed lookup rather than a unique canonical-URL constraint. This avoids an irreversible merge when a source incorrectly reuses an apply URL.
6. Every observation is retained in `job_source_references`; merges are explainable through `job_merge_audit`.
7. Source-run status, lifecycle reconciliation, candidate profiles, search plans, and search sessions are deliberately deferred to their ordered work orders.

## 2026-07-15 — Work Order 2

1. A source run is complete only for a recognized public Lever, Greenhouse, or Ashby board endpoint. HTML pages and arbitrary career sites are always partial because absence from one fetched page is not proof that a posting closed.
2. Failed and partial runs never change job lifecycle state. One complete successful absence marks a job `possibly_closed`; a second complete successful absence marks it `closed`. Reappearance restores `active`.
3. Chunked NATS results carry `chunk_index` and `chunk_count`; reconciliation occurs only after the final chunk so large boards cannot close jobs observed in an earlier chunk.
4. `is_active` remains as a compatibility column, while `lifecycle_status` is the explainable source of truth. It will be removed only in a later, explicitly destructive migration.
5. API job totals use `COUNT(*) OVER()` before pagination. The response separately reports `returned` and source coverage, preventing a 400/1,000-row client limit from masquerading as the total index size.
6. “No results” is presented with successful/configured source counts. It is not described as proof that no job exists globally.

## 2026-07-15 — Work Order 3

1. PostgreSQL persists only the structured candidate profile, field evidence/confidence, and search plan. Raw résumé text remains in browser session storage and is sent to a configured model only after an explicit user action.
2. Résumé upload never calls an LLM. It deterministically extracts a draft, opens a review editor, and waits for confirmation. “Confirm and find roles” is the explicit action that may start AI-assisted ranking.
3. Extraction confidence is confidence in the parser, not a score of the candidate. Every inferred name, location, skill, target role, and experience level carries evidence and a confirmation flag.
4. The deterministic search plan is separate from the visible filter controls. This preserves the product requirement that filters are not silently preselected while still giving the upcoming search-session executor a persisted plan.
5. A new résumé creates a new profile record; edits update the same profile and replace its active plan. Older profiles remain auditable rather than being destructively overwritten.

## 2026-07-15 — Work Order 4

1. Every execution stores an immutable plan snapshot, individual query records, deduplicated result ranks, per-query match reasons, and a complete/partial coverage snapshot. Refreshing the browser reads history; it does not erase the session.
2. Plan queries execute against the full PostgreSQL index, not the browser’s current array. The browser receives up to 1,000 persisted results, which is enough to discover roles it had never loaded.
3. Matching is deterministic and inspectable: normalized query terms, location/type/experience/degree constraints, title-term hits, and the `postgresql_jobs` index name are stored as provenance. The score is a retrieval rank, not a hiring probability.
4. Explicit AI matching may expand the confirmed role-query set. Expanded queries are persisted and immediately execute as a new search session, so model output can drive retrieval rather than merely annotate loaded cards.
5. Search feedback records viewed, saved, and applied actions. Dismissed is supported by the API/schema but awaits a dedicated UI control.
6. Source expansion is conservative: sessions expose configured sources without a successful run as expansion candidates. Model-proposed arbitrary URLs are not auto-enqueued because that could violate source policies or crawl unintended targets.
7. Docker builds use persistent package/compiler caches to keep the required rebuild verification practical. The final strict Clippy gate also replaces a redundant timestamp closure and names the robots parser's group tuple; neither cleanup changes crawler behavior.

## 2026-07-16 — Work Order 5 (global geography foundation)

1. Country, subdivision, region, city-alias, and timezone normalization is a shared generated data contract under `shared/geography/`. The web application and Rust crawler consume those same checked-in records; neither layer maintains its own country list.
2. ISO 3166-1 countries, ISO 3166-2 subdivisions, and IANA timezones come from versioned maintained packages. Organizational and operational regions are declared once in the generator with explicit membership and definitions; region membership never uses substring guesses.
3. A small city-alias layer is intentionally limited to globally distributed, validated hiring hubs. An unknown city remains unknown instead of being assigned to a country from weak evidence.
4. Explicit region language wins over an unanchored subdivision-name collision. For example, `Remote — APAC` is the Asia Pacific region, not the APAC district in Uganda; a country signal is required before the subdivision interpretation can win.
5. `WORLDWIDE` is a remote-scope declaration, not a derived geographic membership. A country can belong to APAC, EMEA, or another deterministic region without being silently labelled worldwide.
6. Geographic eligibility is evaluated by one Rust engine in the crawler/search service. TypeScript renders the persisted policy and decision but does not maintain a competing parser. Cross-boundary JSON uses a versioned, camel-case contract backed by the shared geography records.
7. An unspecified `remote` listing remains `unclear`; it is never promoted to worldwide. Explicit country, region, subdivision, authorization, sponsorship, timezone, hybrid, and office evidence is stored alongside the employer wording.
8. Candidate residence may be inferred from an explicit résumé location and is visibly marked inferred. Citizenship, work authorization, and sponsorship needs are always initialized empty and require user confirmation.
9. Explicit geographic exclusions and timezone mismatches are removed before ranking. Confirmed geographic eligibility can improve retrieval rank, while unclear/sponsorship/relocation/office-attendance outcomes remain visible with conservative penalties and evidence.
10. Migration 0007 is additive. It backfills all historical jobs in place on first upgraded service connection, preserves legacy `country` and `remote` fields for compatibility, and stores structured policy plus per-session eligibility without changing canonical identity or reconciliation.
11. International opportunity classification is driven by `shared/taxonomy/opportunity-types.json`, consumed by both web and crawler runtimes. Structured source labels win over title rules, title rules win over description rules, and unresolved listings retain their original label instead of being forced into an early-career category.
12. Ambiguous localized terms can be marked title-only in the shared dictionary. In particular, French `stage` is useful in a job title but is not matched in an arbitrary English description, where it would create false internships.
13. Migration 0008 adds and backfills opportunity classification independently from geographic normalization. Existing employment labels remain intact, and search uses the canonical classification so international terms such as `Werkstudent`, `alternance`, co-op, and placement year can satisfy early-career plans.
14. The source catalog is a schema-validated JSON registry because both Node validation and Rust orchestration can consume it without a generated second representation. The text seed file is checked for exact equality with verified auto-enqueued endpoints.
15. The initial global registry contains only employer-controlled public ATS boards with a recorded successful complete scan and at least one observed job. Unsupported company pages and currently failing boards were removed from defaults instead of being counted as coverage.
16. Hiring-country and hiring-region metadata reflects current listing evidence, not employer headquarters. Registry and API wording explicitly describes configured/checked source coverage and never total country or market coverage.
17. AI-proposed sources are schema-supported only as experimental or disabled records with automatic enqueue off. Validation rejects any model proposal that attempts to enter the verified trusted set directly.
18. Search-specific source expansion is a persisted state machine, separate from local-index retrieval. A session returns indexed eligible results first, then selects at most twelve verified registry sources from the confirmed geography, opportunity type, work mode, current source health, and evidence history.
19. A source is fresh for six hours after its last successful complete run. Fresh results are reused; stale or unscanned verified endpoints are queued through NATS; an already-running source run is shared rather than duplicated. Selection reasons and every queue/run outcome remain attached to the search session.
20. NATS is optional for the API process. When it is unavailable, profile, history, and full-index search remain usable, expansion is marked `deferred`, and explicit crawl requests return HTTP 503. The API never disguises a deferred scan as checked coverage.
21. Search sessions are reranked in place after an attached source run completes. The immutable plan snapshot and feedback history remain stable while query/result rows are rebuilt from the updated canonical index; canonical job identity and source reconciliation are unchanged.
22. Coverage counters are scoped to the validated registry and the sources selected for the current search. Legacy source rows do not inflate configured coverage, and zero matching registry sources produces an explicit partial state instead of a false complete result.
23. Generated aliases are deduplicated per canonical country or subdivision before ambiguity checks. Repeated aliases for one record must not make an exact place name ambiguous; genuinely shared aliases across different records remain unresolved.
24. NVIDIA NIM is a first-class OpenAI-compatible provider alongside DeepSeek, OpenAI, Anthropic, and Ollama. Provider URLs are normalized centrally; hosted providers require HTTPS, loopback HTTP is allowed only for local Ollama/NIM, and private-network endpoints are rejected to prevent server-side request forgery.
25. A configured model is labelled verified only after RoleAtlas calls its real model-list endpoint and confirms the configured model. Merely entering an API key is shown as untested. The browser keeps a redacted activity trail with provider, model, purpose, timestamp, status, and the categories of data sent; API keys are never included.
26. API keys are proxied through the user's RoleAtlas instance so browser requests do not call model vendors directly. Browser persistence is opt-in through `Remember key on this device`; the default is session-only memory. Raw résumé text remains browser-session data and is sent only for an explicit profile, ranking, or preparation action.
27. AI may expand a confirmed query set and prepare application material, but deterministic geography decides eligibility and only the validated source registry can direct the crawler. Model-generated URLs cannot cross that trust boundary.
28. Source expansion is progressive in the UI. Existing indexed results remain visible while a persisted search session is polled for selected, checked, scanning, deferred, and failed sources; the status language describes only the current configured-source check and never implies total market coverage.
29. The geographic acceptance matrix is an executable Rust test rather than a documentation-only checklist. It covers onsite country, multi-country region, worldwide and restricted remote, country and subdivision exclusions, authorization, both sponsorship outcomes, relocation, timezone mismatch, and hybrid attendance through the same production parser and evaluator.
30. A reviewed persisted profile and confirmed search plan can rerun deterministic index/source search after a browser restart without reuploading the résumé. Raw résumé text is still required for AI ranking or application preparation and remains session-only. General job-index health counters use only enabled IDs from the validated registry, so historical source rows cannot inflate the UI.

## 2026-07-16 — Work Order 5 review fixes

31. An unresolved opportunity classification has the explicit `Unknown` employment type across the shared taxonomy, browser job model, filter model, persisted search-plan contract, and crawler output. Explicit structured labels such as `Permanent`, `Part-time`, and `Contract` remain authoritative. Normalization version 3 reclassifies existing records additively at service startup; no schema migration is required.
32. Registry geography is source-selection evidence only. It can justify scanning a board for a country or region, but it never contributes evidence to the listing-level eligibility evaluator. A regression test fixes this trust boundary: an APAC-tagged source is selected for a New Zealand plan, while a location-unspecified remote listing remains `unclear`.
33. Custom AI provider endpoints are validated at the server boundary. RoleAtlas resolves customized hostnames, rejects any non-public answer, handles redirects manually, revalidates each target, blocks cross-origin credential forwarding, and rejects authenticated redirects that would rewrite the method. Official built-in provider origins retain their HTTPS allowlist and skip application DNS preflight.
34. Application-level DNS checks reduce SSRF exposure but do not eliminate DNS rebinding because the validated address is not pinned to the fetch socket. Loopback Ollama/NIM is an intentional exception, and deployment proxies or resolvers may alter routing. These limits and recommended egress controls are documented in `docs/ai-provider-security.md` rather than implied to be solved completely.
35. Supplemental public feeds have a one-second per-request and per-source settlement budget during server rendering. A slow feed is reported as failed/partial instead of blocking the page; the persistent PostgreSQL index and crawler load independently. This is deliberately a responsiveness boundary, not a claim that every transient feed will be represented on every page load.
