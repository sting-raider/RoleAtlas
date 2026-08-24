#!/usr/bin/env bash
# Restore a backup produced by scripts/backup.sh into the production stack.
#
#   scripts/restore.sh backups/postgres-YYYYmmdd-HHMMSS.dump [--force]
#                       [--pause] [--resume] [--env-file deploy/.env.production]
#
# Safety model:
#   - refuses to clobber a database that already contains tables unless --force
#   - --pause stops writers first (worker, coordinator, api, web), restores,
#     and leaves them stopped; follow with --resume to bring them back
#   - without --pause/--resume the restore runs against the live stack (fine
#     for a drill on an idle stack; use --pause for a real incident)
#
# Works under Git Bash on Windows.

set -euo pipefail

COMPOSE_FILE="deploy/docker-compose.prod.yml"
ENV_FILE="deploy/.env.production"
WRITERS=(worker coordinator api web)
FORCE=0
DO_PAUSE=0
DO_RESUME=0
DUMP=""

usage() {
	cat >&2 <<'EOF'
usage: scripts/restore.sh DUMP_FILE [--force] [--pause] [--resume] [--env-file PATH]

  DUMP_FILE  path to a pg_dump custom-format archive from scripts/backup.sh
  --force    restore even if the target database is non-empty (DESTRUCTIVE)
  --pause    stop web/api/coordinator/worker before restoring; leave them down
  --resume   start web/api/coordinator/worker after restoring
EOF
	exit 2
}

while [[ $# -gt 0 ]]; do
	case "$1" in
	--force)
		FORCE=1
		shift
		;;
	--pause)
		DO_PAUSE=1
		shift
		;;
	--resume)
		DO_RESUME=1
		shift
		;;
	--env-file)
		[[ -n ${2:-} ]] || usage
		ENV_FILE="$2"
		shift 2
		;;
	-*)
		usage
		;;
	*)
		[[ -z $DUMP ]] || usage
		DUMP="$1"
		shift
		;;
	esac
done

[[ -n $DUMP ]] || usage
[[ -f $DUMP ]] || {
	echo "restore: dump file not found: $DUMP" >&2
	exit 2
}
[[ -f $COMPOSE_FILE ]] || {
	echo "restore: run from the repository root; missing $COMPOSE_FILE" >&2
	exit 2
}
command -v docker >/dev/null || {
	echo "restore: docker CLI not found" >&2
	exit 2
}

compose() {
	if [[ -f $ENV_FILE ]]; then
		docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"
	else
		echo "restore: missing $ENV_FILE — needed for POSTGRES_PASSWORD" >&2
		exit 2
	fi
}

if ! compose ps --status running --services | grep -qx postgres; then
	echo "restore: production postgres is not running." >&2
	echo "start it first: docker compose -f $COMPOSE_FILE --env-file $ENV_FILE up -d" >&2
	exit 1
fi

if [[ $(head -c 5 "$DUMP") != "PGDMP" ]]; then
	echo "restore: $DUMP does not look like a pg_dump custom-format archive" >&2
	exit 1
fi

psql_exec() {
	compose exec -T postgres psql -v ON_ERROR_STOP=1 -U firstrung -d firstrung "$@"
}

existing_tables() {
	psql_exec -Atc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'" 2>/dev/null
}

TABLES_BEFORE="$(existing_tables)"
echo "restore: target currently holds $TABLES_BEFORE public table(s)"

if (( TABLES_BEFORE > 0 )) && (( ! FORCE )); then
	echo "restore: refusing to overwrite a non-empty database." >&2
	echo "re-run with --force if you really mean it (all current data will be replaced)." >&2
	exit 1
fi

stop_writers() {
	echo "restore: stopping writers: ${WRITERS[*]}"
	compose stop "${WRITERS[@]}"
}

start_writers() {
	echo "resume: starting ${WRITERS[*]}"
	compose up -d --no-deps "${WRITERS[@]}"
}

TRAP_CLEANUP=0
cleanup() {
	(( TRAP_CLEANUP )) || return 0
	echo "restore: interrupted — writers left as-is; inspect with: docker compose -f $COMPOSE_FILE ps" >&2
}
trap cleanup EXIT

(( DO_PAUSE )) && stop_writers

echo "restore: dropping existing public schema objects"
# Drop-and-recreate the whole schema: pg_restore -C cannot be used because the
# dump was taken with a database name baked in, and per-table drops would
# tangle on circular foreign keys.
psql_exec <<'SQL'
DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
GRANT ALL ON SCHEMA public TO firstrung;
GRANT ALL ON SCHEMA public TO public;
SQL

echo "restore: running pg_restore from $DUMP"
if ! compose exec -T postgres pg_restore -U firstrung --no-owner --no-privileges --exit-on-error \
	-d firstrung <"$DUMP"; then
	echo "restore: FAILED — the schema may be partially restored. Re-run with a known-good dump." >&2
	TRAP_CLEANUP=1
	exit 1
fi

ROWS_JOBS="$(psql_exec -Atc 'SELECT count(*) FROM jobs' 2>/dev/null || echo unavailable)"
USERS="$(psql_exec -Atc 'SELECT count(*) FROM roleatlas_users' 2>/dev/null || echo unavailable)"
SAVED="$(psql_exec -Atc 'SELECT count(*) FROM saved_jobs' 2>/dev/null || echo unavailable)"
TABLES_AFTER="$(existing_tables)"

cat <<VERIFICATION

--- post-restore verification -------------------------------------
tables in public : $TABLES_AFTER
SELECT count(*) FROM jobs           -> $ROWS_JOBS
SELECT count(*) FROM roleatlas_users -> $USERS
SELECT count(*) FROM saved_jobs      -> $SAVED
-------------------------------------------------------------------

VERIFICATION

if [[ $TABLES_AFTER -eq 0 ]]; then
	echo "restore: WARNING — no tables found after restore; verify the dump." >&2
	TRAP_CLEANUP=1
	exit 1
fi

(( DO_RESUME )) && start_writers

if (( DO_PAUSE && ! DO_RESUME )); then
	echo "restore: writers remain stopped (--pause given without --resume)."
	echo "bring them back with:"
	echo "  docker compose -f $COMPOSE_FILE --env-file $ENV_FILE up -d --no-deps worker coordinator api web"
fi

echo "restore: done"
