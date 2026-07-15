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
