# Work Order 5 baseline audit

Baseline: `06fa197a534781b363bad08ef9583d736213f2f2` on `master`, identical to `origin/master` when fetched on 2026-07-15.

## Confirmed implementation state

- Work Orders 1–4 are present in code and history. Canonical identity, reconciliation, trustworthy crawler counts, reviewed profiles/plans, and persistent search sessions all have executable tests.
- Migrations 1–6 are applied successfully in the existing PostgreSQL volume.
- The live Docker stack contained 3,154 historical job records, 96 source runs, and no verification profiles or sessions before Work Order 5 changes.

## Untouched baseline checks

The following passed before the Work Order 5 branch was created:

- `npm run typecheck`
- `npm run lint`
- `npm test`
- `cargo fmt --manifest-path services/scout/Cargo.toml --check`
- `cargo clippy --manifest-path services/scout/Cargo.toml --all-targets -- -D warnings`
- `cargo test --manifest-path services/scout/Cargo.toml`
- `cargo test --manifest-path services/scout/Cargo.toml --test reconciliation -- --ignored --test-threads=1`
- `cargo test --manifest-path services/scout/Cargo.toml --test search_sessions -- --ignored --test-threads=1`

## Documentation-to-code discrepancies

1. `docs/current-architecture.md` still describes several pre-Work-Order-1 failures as current even though crawler identity, reconciliation, counts, and query execution were subsequently implemented.
2. `app/liveJobs.ts` still injected the fictional `JOBS` fixture whenever every public feed failed. Those records were labelled verified and entered live counts, despite the rebuild plan and progress notes requiring truthful degraded mode.
3. Public-feed identity reused canonical URL utilities but its fingerprint omitted employment type and used a moving relative-age bucket rather than the posting date. Requisition identity was not represented in the browser job model.
4. Geography was implemented independently in `app/liveJobs.ts`, `app/FirstRungApp.tsx`, `services/scout/src/extract.rs`, migration 0002, and SQL `ILIKE` filters. It was name/string based rather than ISO-code based and had no shared region, subdivision, timezone, mobility, or eligibility model.
5. Search-session coverage counted every enabled source globally. It did not select or report sources relevant to the candidate's requested geography.
6. `services/scout/default_seeds.txt` was an unvalidated flat list. It had no verified/experimental state, hiring geography, remote/opportunity history, health metadata, or contribution validation.
7. Provider configuration considered non-empty fields a successful connection. `README.md` and the provider modal said keys were forwarded “only” to the provider, although browser requests first pass through RoleAtlas server routes.
8. Ollama behavior was inconsistent: preparation allowed a local endpoint while match and analysis routes rejected it.

No Work Order 1–4 behavior needs replacement. Work Order 5 extends the existing paths additively and retains the original regression suites.
