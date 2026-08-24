#!/usr/bin/env bash
# Logical backup of the production PostgreSQL database.
#
# Requires the production stack to be RUNNING:
#   docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.production up -d
#
# Writes backups/postgres-YYYYmmdd-HHMMSS.dump (custom format) plus a .sha256
# sidecar, keeping only the newest --keep dumps. Works under Git Bash on
# Windows; paths are handled in POSIX form and handed to docker as-is.

set -euo pipefail

COMPOSE_FILE="deploy/docker-compose.prod.yml"
ENV_FILE="deploy/.env.production"
KEEP=7

usage() {
	echo "usage: $0 [--env-file PATH] [--keep N]" >&2
	exit 2
}

while [[ $# -gt 0 ]]; do
	case "$1" in
	--env-file)
		[[ -n ${2:-} ]] || usage
		ENV_FILE="$2"
		shift 2
		;;
	--keep)
		[[ -n ${2:-} ]] || usage
		KEEP="$2"
		shift 2
		;;
	*)
		usage
		;;
	esac
done

[[ $KEEP =~ ^[1-9][0-9]*$ ]] || {
	echo "backup: --keep must be a positive integer (got '$KEEP')" >&2
	exit 2
}
[[ -f $COMPOSE_FILE ]] || {
	echo "backup: run from the repository root; missing $COMPOSE_FILE" >&2
	exit 2
}

command -v docker >/dev/null || {
	echo "backup: docker CLI not found" >&2
	exit 2
}

compose() {
	if [[ -f $ENV_FILE ]]; then
		docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"
	else
		echo "backup: missing $ENV_FILE — needed for POSTGRES_PASSWORD" >&2
		exit 2
	fi
}

# Fail before touching disk if the stack is not up.
if ! compose ps --status running --services | grep -qx postgres; then
	echo "backup: production postgres is not running." >&2
	echo "start it first: docker compose -f $COMPOSE_FILE --env-file $ENV_FILE up -d" >&2
	exit 1
fi

BACKUP_DIR="backups"
mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
# Dump to a hidden partial and rename only after validation, so a failed run
# can never leave a truncated file wearing the final timestamped name.
DUMP="$BACKUP_DIR/postgres-$STAMP.dump"
PARTIAL="$BACKUP_DIR/.postgres-$STAMP.partial"

echo "backup: dumping to $DUMP"
# -T so progress bars from pg_dump cannot corrupt the file through a TTY;
# -U pins the role (the container would otherwise fall back to root).
if ! compose exec -T postgres pg_dump -U firstrung -Fc --no-owner --no-privileges \
	-d firstrung >"$PARTIAL"; then
	echo "backup: pg_dump failed" >&2
	rm -f "$PARTIAL"
	exit 1
fi

[[ -s $PARTIAL ]] || {
	echo "backup: dump is empty; refusing to keep it" >&2
	rm -f "$PARTIAL"
	exit 1
}

# Custom-format archives start with PGDMP; a truncated stream does not.
if [[ "$(head -c 5 "$PARTIAL")" != "PGDMP" ]]; then
	echo "backup: dump lacks the custom-format magic; refusing to keep it" >&2
	rm -f "$PARTIAL"
	exit 1
fi

mv "$PARTIAL" "$DUMP"
sha256sum "$DUMP" >"$DUMP.sha256"
echo "backup: wrote $DUMP ($(wc -c <"$DUMP") bytes)"

# Retention: prune oldest beyond --keep, newest N survive. Nullglob keeps this
# safe when no dumps exist yet.
shopt -s nullglob
# Hidden .partial files never match this glob, so a failed run's debris cannot
# skew retention counting.
dumps=("$BACKUP_DIR"/postgres-*.dump)
if (( ${#dumps[@]} > KEEP )); then
	# Timestamped names sort chronologically.
	for victim in "${dumps[@]:0:$(( ${#dumps[@]} - KEEP ))}"; do
		echo "backup: pruning $victim"
		rm -f "$victim" "$victim.sha256"
	done
fi

echo "backup: done (keeping $KEEP most recent)"
