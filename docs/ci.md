# Local CI equivalents

CI does not use provider credentials or live job sources. Run the same checks locally from the repository root:

```powershell
npm ci
npm run format:check
npm run lint
npm run typecheck
npm run registry:validate
npm test
npm run build
cargo fmt --manifest-path services/scout/Cargo.toml --check
cargo clippy --manifest-path services/scout/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path services/scout/Cargo.toml
$env:DATABASE_URL = "postgres://firstrung:firstrung@127.0.0.1:5432/firstrung"
cargo test --manifest-path services/scout/Cargo.toml --test reconciliation -- --ignored --test-threads=1
cargo test --manifest-path services/scout/Cargo.toml --test search_sessions -- --ignored --test-threads=1
cargo test --manifest-path services/scout/Cargo.toml --test search_index -- --ignored --test-threads=1
cargo test --manifest-path services/scout/Cargo.toml --test ranking_evaluation -- --ignored --test-threads=1
cargo test --manifest-path services/scout/Cargo.toml --test notifications -- --ignored --test-threads=1
cargo test --manifest-path services/scout/Cargo.toml --test tenancy -- --ignored --test-threads=1
cargo test --manifest-path services/scout/Cargo.toml --test daily_workspace -- --ignored --test-threads=1
cargo test --manifest-path services/scout/Cargo.toml --test migration_upgrade -- --ignored --test-threads=1
cargo test --manifest-path services/scout/Cargo.toml --test entity_writes -- --ignored --test-threads=1
```

The nine ignored-by-default integration suites require PostgreSQL (the development compose binds its cluster to loopback 127.0.0.1:5432; the disposable integration container used in earlier sessions listened on 127.0.0.1:15432 — set `DATABASE_URL` to whichever is running). `connect_database` applies pending migrations before the tests run, so they validate migration execution and the persisted flows. Suites must run serially (`--test-threads=1`) because they share fixture rows. Registry and provider tests use committed fixtures or mocks and must never require network credentials.

The GitHub Actions workflow (`.github/workflows/ci.yml`) mirrors these gates in four jobs: web (typecheck/lint/format/tests/build), Rust plus all nine serial ignored suites against a PostgreSQL service container, a production-compose smoke build, and a deliberately blocking dependency/secret audit.
