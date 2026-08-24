# Operations runbook

Practical runbook for running RoleAtlas. Every command below is copy-runnable from the repository root on Linux, macOS, or Git Bash on Windows.

## Architecture

```text
browser
  |
  v
caddy  (TLS termination, deploy/Caddyfile; only service on the public "edge" network)
  |
  v
web  (Next.js 16 standalone, Dockerfile.web; private "internal" network)
  |  SCOUT_API_URL + HMAC-signed internal assertions (SCOUT_INTERNAL_SECRET)
  v
scout api  (services/scout, bin/api.rs)
  |
  +--> postgres 17 (canonical jobs, source runs, all user-owned records; migrations embedded in the binaries)
  +--> nats 2.12 with JetStream (crawl work queue: firstrung.crawl.pending / .result, DLQ firstrung.dead.*)
           ^                          |
           | publish tasks            | results
      coordinator (bin/coordinator.rs, seeds frontier, reconciles results into postgres)
      worker(s)   (bin/worker.rs, fetch pages honoring robots.txt and per-host delay, extract listings)
```

The web tier never talks to PostgreSQL as an authority for crawler state or to NATS directly. Scout API is the only component besides coordinator/worker that touches both stores. In the production composition, api/coordinator/worker/postgres/nats join only an `internal: true` Docker network with no host route, and Caddy proxies nothing but `web`; Scout's signed assertions are defense in depth, not a substitute for that isolation.

## Environments

| File | Purpose |
| --- | --- |
| `docker-compose.yml` | Development/full-local stack: web, api, coordinator, worker, postgres, nats, mailpit. Builds images locally, publishes every port on localhost, uses Mailpit for email. |
| `deploy/docker-compose.prod.yml` | Production composition: Caddy edge + everything else on a private `internal` network. Run it with an explicit env file (`--env-file deploy/.env.production`, created from `.env.production.example`) because secrets use `${VAR:?}` hard-fail interpolation. A smoke overlay (`deploy/compose.smoke.yml` + `deploy/env.production.smoke`) exercises the topology on HTTP port 3100 without publishing real services. |

### Production backup/restore scripts

Both run from the repository root against the production stack and require it to be up.

- **`scripts/backup.sh [--env-file PATH] [--keep N]`** — `pg_dump -Fc` of the production database into `backups/postgres-YYYYmmdd-HHMMSS.dump`, plus a `.sha256` sidecar; keeps only the newest `N` dumps (default 7) and refuses to keep an empty or truncated archive. Exits early if production postgres is not running.
- **`scripts/restore.sh DUMP_FILE [--force] [--pause] [--resume] [--env-file PATH]`** — restores a dump produced by the backup script. It refuses to clobber a non-empty database unless `--force` (destructive); `--pause` stops the writer services (worker, coordinator, api, web) first and leaves them down — follow with `--resume` after verifying the restore. Without those flags it restores against the live stack, acceptable only for drills on an idle stack.

## Environment and secrets

Copy `.env.example` to `.env` for local runs. Compose reads it automatically.

| Variable | Used by | Required | Notes |
| --- | --- | --- | --- |
| `DATABASE_URL` | web, scout api/coordinator/worker | yes | PostgreSQL connection string. Web falls back to a local default only for bare-metal dev. |
| `BETTER_AUTH_SECRET` | web | yes in production | Session signing. Must have production entropy; web refuses to boot without it when `NODE_ENV=production`. |
| `SCOUT_INTERNAL_SECRET` | web, scout api/coordinator/worker | yes | HMAC key for internal assertions. Scout API requires at least 32 bytes or exits at startup. |
| `ROLEATLAS_PUBLIC_URL` / `BETTER_AUTH_URL` | web | yes in production | Public base URL; also drives secure-cookie decisions. |
| `AUTH_TRUSTED_ORIGINS` | web | recommended | Comma-separated origins allowed for auth redirects. Defaults to the public URL. |
| `AUTH_REQUIRE_EMAIL_VERIFICATION`, `AUTH_EMAIL_FROM`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD` | web | production | Verification/reset mail through a real relay. Compose dev defaults route to Mailpit (`http://localhost:8025`). |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | web | optional | Enables GitHub OAuth sign-in when both are set. |
| `AUTH_CLIENT_IP_HEADER` | web | optional | Header your trusted ingress sets for client IP; defaults to `x-real-ip`. Set it only to a header written by trusted infrastructure. |
| `AUTH_SECURE_COOKIES` | web | optional | Force secure cookies on/off; otherwise derived from URL scheme. |
| `SCOUT_API_URL` | web | yes in compose | Internal Scout base URL (`http://api:8080`). |
| `NATS_URL` | scout | yes | e.g. `nats://nats:4222`. |
| `SCOUT_SEEDS` | coordinator | optional | Comma-separated seed URLs; empty uses the maintained registry endpoints. |
| `RECRAWL_INTERVAL_SECS` | coordinator | optional | Registry revisit cadence, default 21600 (6 h). |
| `CRAWL_DELAY_MS` | worker | optional | Per-host pacing, default 1500. |
| `REQUEST_TIMEOUT_SECS` | worker | optional | Fetch timeout, default 25 (compose sets 40). |
| `MAX_BODY_BYTES` | worker | optional | Response size cap, default 5 MiB (compose sets 12 MiB). |
| `SCOUT_USER_AGENT` | worker | recommended | Crawler identity advertised to sites. Change the domain to yours in production. |
| `SCOUT_ALLOW_PRIVATE_HOSTS` | worker | leave unset | Blocks private/loopback/link-local crawl targets. Only enable for local fixture testing. |
| `SCOUT_EGRESS_ALLOWLIST` | worker | optional | Comma-separated host suffix allowlist; when set nothing else is crawled. |
| `RUST_LOG` | scout services | optional | Tracing filter, default `firstrung_scout=info,tower_http=info`. |
| `AGENT_TOOL_TIMEOUT_MS` | web | optional | Wall-time budget per registered agent tool, default 20000. |
| `SCOUT_API_PORT` | scout api | optional | Listen port override, default 8080. |

Generate secrets once and store them properly; never commit `.env` (it is gitignored):

```bash
openssl rand -base64 48   # BETTER_AUTH_SECRET
openssl rand -hex 32      # SCOUT_INTERNAL_SECRET (>= 32 bytes enforced)
```

## Start and stop

Development stack (builds local images):

```bash
docker compose up --build -d        # start everything
docker compose logs -f web          # follow one service
docker compose stop                 # stop, keep containers
docker compose down                 # stop and remove containers (volumes survive)
docker compose down -v              # stop and delete postgres_data/nats_data too — destructive
```

Scale workers if crawl throughput needs it:

```bash
docker compose up --scale worker=4 -d
```

Endpoints after startup: web `http://localhost:3000`, scout api `http://localhost:8080`, NATS monitor `http://localhost:8222`, Mailpit `http://localhost:8025`, PostgreSQL `localhost:5432`.

Production: deploy with `deploy/docker-compose.prod.yml` and its env file rather than the development file:

```bash
cp .env.production.example deploy/.env.production   # then fill in every value
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.production up -d
```

Caddy publishes no host ports by default (the operator binds 80/443 via firewall, load balancer, or a ports override); the smoke overlay uses port 3100 instead. Do not publish PostgreSQL, NATS, Mailpit, or Scout ports publicly — only Caddy faces the internet.

## Logging

- Rust services log structured text through `tracing`; tune with `RUST_LOG` (for example `RUST_LOG=firstrung_scout=debug,tower_http=info`). The default filter is `firstrung_scout=info,tower_http=info`.
- Read container logs with `docker compose logs --tail=200 -f api coordinator worker web`.
- Next.js writes request/error output to stdout; view it with `docker compose logs web`.
- Never-log rule from `AGENTS.md`: no résumé contents, credentials, authorization headers, profiles, notes, or prompts may appear in logs. Scout API returns a generic message for internal errors precisely so error details stay server-side. If you add logging anywhere, keep that invariant.

## Metrics and health

Health endpoints are unauthenticated and safe to expose to internal monitoring:

```bash
curl -fsS http://localhost:3000/api/health     # web liveness -> {"service":"roleatlas-web","status":"ok"}
curl -fsS http://localhost:8080/health         # scout: checks PostgreSQL, reports crawler_queue available/unavailable
```

Operational metrics require authentication. `/api/metrics` and `/api/stats` on Scout are **admin-gated**: the request extractor in `bin/api.rs` first verifies a signed internal assertion (HMAC-SHA256 over timestamp, method, path, user ID, role using `SCOUT_INTERNAL_SECRET`, rejecting anything older than 60 seconds) and then calls `require_admin()`, which rejects authenticated non-admin users with 403. There is no unauthenticated metrics endpoint and no Prometheus scrape path. Read them through the signed web proxy while logged in as an admin user — the proxy signs the assertion for you:

```text
GET /api/local-scout?action=metrics   # admin session required; proxies scout /api/metrics
```

Source-level health (last run status, observed jobs, errors per enabled source): `/api/source-health`, surfaced in the app's Sources workspace.

JetStream queue inspection:

```bash
curl -s http://localhost:8222/jsz | head -40   # stream/consumer state via the NATS monitoring HTTP port mapped in docker-compose.yml
```

## Upgrades

Migrations are embedded in the Scout binaries (`sqlx::migrate!("./migrations")`) and run automatically whenever `connect_database` executes — meaning at **scout-api and scout-coordinator boot** (the worker does not connect to PostgreSQL; it publishes results over NATS). Migrations are additive by policy; applied migrations are never edited.

Recommended order, and why:

1. Back up first: `scripts/backup.sh` (or a manual `pg_dump`) — the restore point predates any schema change.
2. Pull the new revision and build images.
3. Stop the old containers but keep PostgreSQL and NATS volumes: `docker compose down` (no `-v`). Draining workers mid-task is safe — unacked tasks redeliver.
4. Start `postgres` and `nats` first, wait healthy.
5. Start **coordinator next** (it runs migrations and recreates/updates JetStream streams), then `api`, then `worker`s, then `web`. If you start api before any migration-bearing binary ran against a newer schema, api would still migrate on its own boot — the ordering simply guarantees one migration owner at a time and lets the queue come up before workers ask for work.
6. Verify: `/health` on both tiers, one search, Sources workspace showing recent successful source runs.

Rollback: redeploy the previous image tag. Because migrations are additive, an older binary works against the newer schema. Rolling forward again after restoring an old dump is fine; re-running migrations is idempotent.

## Backup and restore

Prefer the scripts above (`scripts/backup.sh`, `scripts/restore.sh`); they add integrity checks, retention pruning, and writer-quiescing. Equivalent manual commands against the development stack, for when the scripts are unavailable:

```bash
# Backup (dev stack; the production script does the same with --no-owner --no-privileges):
docker compose exec -T postgres pg_dump -U firstrung -d firstrung -Fc > "backup-$(date +%Y%m%d-%H%M%S).dump"

# Restore:
docker compose exec -T postgres pg_restore -U firstrung -d firstrung --clean --if-exists < backup-YYYYMMDD-HHMMSS.dump
```

What backups capture: every PostgreSQL table including all user-owned data and audit events. They do **not** capture NATS JetStream contents — acceptable because canonical jobs, source runs, and frontier state live in PostgreSQL; the queue is rebuilt from seeds on coordinator boot. Back up the `nats_data` volume separately only if you need dead-letter payloads for forensics. Test restores periodically; an untested backup is a hope, not a plan.

## Failure playbook

### Host port collision on startup

Symptom: `bind: address already in use` for 3000/5432/4222/8222/8025/8080, or a second RoleAtlas checkout fighting a native PostgreSQL on 5432.

Fix without rebuilding: override the host side only.

```bash
# Scout API's in-container listen port is deployment-configurable; pass it
# through the service environment, e.g. in a compose.override.yml:
#   services.api.environment.SCOUNT_API_PORT=9090
# For published host ports, edit the compose `ports:` left-hand side
# (e.g. "15432:5432") or add the override in compose.override.yml too.
docker compose up -d api
```

### JetStream legacy stream-migration refusal

Scout's `ensure_stream` replaces an old limits-retention `FIRSTRUNG_CRAWL` stream with a bounded work queue, but only when it is fully drained. On boot you may see:

- `legacy crawl stream still has pending work for scout-workers; drain it before migrating`
- `legacy crawl stream still has pending work for scout-coordinator; drain it before migrating`

Both come from `migrate_drained_legacy_stream`: if pending or unacknowledged messages exist for either durable consumer, migration aborts rather than deleting undelivered work. Fix: start the previous-version worker and coordinator and let them consume until the consumers show zero pending and matching ack/delivered sequences, then restart the new version. A third error — `unexpected subject ... cannot be migrated safely` — means the old stream carries subjects beyond the known two; do not force-delete it without confirming nothing else publishes there. Once drained, migration deletes and recreates the stream; acknowledged history is redundant because PostgreSQL holds the canonical state.

Check consumer state during draining:

```bash
curl -s "http://localhost:8222/jsz?consumers=true" | grep -A4 '"name":"scout-workers"'
```

### Docker Desktop on Windows will not start

Known on this project's dev machine: NTFS corruption can wedge Docker Desktop (`com.docker.backend.exe` crashing on launch; an orphaned entry under `%LOCALAPPDATA%\Docker\run\dockerInference` that only `chkdsk C: /f` at reboot clears). Recorded in `docs/PROGRESS.md`. Until repaired, web-only gates (`npm run lint`, typecheck, unit tests) remain runnable; PostgreSQL integration tests and container verification must be rerun once Docker Desktop is healthy — do not mark them done from memory.

### NATS or PostgreSQL unavailable at boot

Scout api degrades deliberately: it logs `NATS unavailable; indexed search remains online`, keeps serving indexed search, and reports `crawler_queue: unavailable` on `/health`; enqueue actions return 503. Coordinator exits if it cannot reach PostgreSQL (it must own migrations); retry with the dependency healthy. Web labels persisted features reduced instead of pretending saves worked.

### Crawler hammering a source or failing wholesale

Check `/api/source-health` for per-source status and errors. Lower concurrency by scaling workers down (`--scale worker=1`), raise `CRAWL_DELAY_MS`, and confirm `robots.txt` compliance is intact. Dead-lettered tasks accumulate in `FIRSTRUNG_CRAWL_DLQ` (30-day retention) — inspect via the NATS monitor or accept automatic expiry.

## Incident checklist

1. **Stabilize**: `docker compose ps` — what is restarting? Check `/health` on web and scout api first.
2. **Scope**: is it one user, all users, or crawl-only? `crawler_queue: unavailable` on scout `/health` means search still works; crawl actions are degraded.
3. **Logs**: `docker compose logs --tail=500 <service>`; look for the warn paths named above (`NATS unavailable`, legacy-stream refusal, bind failures).
4. **Database**: `docker compose exec postgres pg_isready -U firstrung -d firstrung`; check disk space — JetStream and PostgreSQL both fail ugly when full.
5. **Data risk?** If user data may be affected, snapshot immediately: run a backup before any repair attempt.
6. **Communicate**: if you operate for others, tell users what broke, what leaked (if anything), and when it was fixed. Security incidents additionally follow [SECURITY.md](SECURITY.md).
7. **Afterwards**: record timeline, root cause, and detection gap in your incident notes; fix the monitoring that missed it. Product docs (`docs/PROGRESS.md`) are updated by the main workflow, not ad hoc.
