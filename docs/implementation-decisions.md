# Implementation decisions

## 2026-07-15 — Work Order 1

1. PostgreSQL is the canonical identity boundary because it is the only durable job index in the running architecture. The unused D1 scaffold is not extended.
2. Identity priority is source-scoped job ID, canonical apply/listing URL, then a fingerprint of normalized company, title, location, and posting date. Company/title alone is never sufficient.
3. Provider source IDs include the board namespace (for example `lever:company`) because ATS job IDs may only be unique within a tenant.
4. Tracking parameters and fragments are removed from canonical URLs, while identity-bearing parameters such as `gh_jid` are retained.
5. Database uniqueness is enforced by application-level resolution plus indexed lookup rather than a unique canonical-URL constraint. This avoids an irreversible merge when a source incorrectly reuses an apply URL.
6. Every observation is retained in `job_source_references`; merges are explainable through `job_merge_audit`.
7. Source-run status, lifecycle reconciliation, candidate profiles, search plans, and search sessions are deliberately deferred to their ordered work orders.
