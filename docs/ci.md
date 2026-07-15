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
```

The two ignored-by-default integration suites require PostgreSQL. `connect_database` applies pending migrations before the tests run, so they validate migration execution and the persisted Work Order 1–4 flows. Registry and provider tests use committed fixtures or mocks and must never require network credentials.
