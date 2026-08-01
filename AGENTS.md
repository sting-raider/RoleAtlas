# RoleAtlas engineering guide

## Product invariants

- Eligibility is deterministic and separate from match quality.
- Unknown evidence remains unknown.
- Registry geography can select a source but cannot confirm a candidate's listing eligibility.
- Jobs/source runs are shared; all candidate/product records are user-owned.
- Never trust a browser-supplied user ID or model-generated URL.
- AI is optional and cannot determine eligibility, trust/enqueue sources, mutate confirmed facts without approval, or submit applications.
- Preserve existing development data through additive migrations; never edit an applied migration.
- GitHub Pages under `site/` is an illustrative tour, not the live application.

## Required checks

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

Run ignored PostgreSQL integration tests with a disposable/controlled `DATABASE_URL`. New migrations must be tested from an empty database and from the representative pre-change schema.

## Change discipline

- Keep each phase runnable and commit logical slices.
- Update `docs/PROGRESS.md`, `docs/DECISIONS.md`, and `docs/COMPLETION_AUDIT.md` with implementation and verification evidence.
- Use fixture endpoints in CI; live ATS checks are manual and never required for a green build.
- Do not expose PostgreSQL, NATS, or Scout publicly in production.
- Do not log résumé contents, credentials, authorization headers, profiles, notes, or prompts.
- Do not claim coverage, performance, security, deployment, or accessibility without direct evidence.
