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
