#!/usr/bin/env bash
# Local SBOM generation for both RoleAtlas images.
#
# Mirrors what .github/workflows/release.yml does with anchore/sbom-action:
# writes SPDX JSON for the web and scout images into dist/sbom/. Requires syft
# on PATH (https://github.com/anchore/syft). Works under Git Bash on Windows;
# paths stay POSIX so docker/syft see them unmodified.

set -euo pipefail

OUT_DIR="dist/sbom"
COMPOSE_FILE="docker-compose.yml"
WEB_IMAGE="firstrung-web:latest"
SCOUT_IMAGE="firstrung-api:latest"

usage() {
	echo "usage: $0 [--out DIR]" >&2
	exit 2
}

while [[ $# -gt 0 ]]; do
	case "$1" in
	--out)
		[[ -n ${2:-} ]] || usage
		OUT_DIR="$2"
		shift 2
		;;
	*) usage ;;
	esac
done

command -v syft >/dev/null 2>&1 || {
	echo "syft is not installed." >&2
	echo "Install it first:" >&2
	echo "  macOS/Linux: curl -sSfL https://raw.githubusercontent.com/anchore/syft/main/install.sh | sh -s -- -b /usr/local/bin" >&2
	echo "  Windows:     scoop install syft   (or download a release from https://github.com/anchore/syft/releases)" >&2
	echo "Then re-run: $0" >&2
	exit 127
}

command -v docker >/dev/null 2>&1 || {
	echo "docker is not installed; both images must exist locally to be scanned." >&2
	exit 127
}

mkdir -p "$OUT_DIR"

# Build only if an image is missing; rebuild explicitly with
#   docker compose build web api
if ! docker image inspect "$WEB_IMAGE" >/dev/null 2>&1; then
	echo "$WEB_IMAGE not found locally; building via compose..."
	docker compose -f "$COMPOSE_FILE" build web
fi
if ! docker image inspect "$SCOUT_IMAGE" >/dev/null 2>&1; then
	echo "$SCOUT_IMAGE not found locally; building via compose..."
	docker compose -f "$COMPOSE_FILE" build api
fi

for pair in "web:$WEB_IMAGE" "scout:$SCOUT_IMAGE"; do
	name=${pair%%:*}
	image=${pair#*:}
	target="$OUT_DIR/$name.spdx.json"
	echo "Generating SBOM for $image -> $target"
	syft "$image" -o spdx-json >"$target"
done

echo "SBOMs written:"
ls -l "$OUT_DIR"/*.spdx.json
