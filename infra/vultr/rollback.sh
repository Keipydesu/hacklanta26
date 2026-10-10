#!/usr/bin/env bash
# Restart the previous known-good release (application images, proxy config and its tiles) and
# probe it. The data volume is kept and the database is NOT rolled back: if the failed release ran
# a migration the old code cannot read, fix forward or restore a backup deliberately.
#   infra/vultr/rollback.sh deploy@HOST [--profile routing] [--profile automation]
# NOT YET RUN against a real host.
set -euo pipefail
. "$(dirname "$0")/../lib.sh"
TARGET="${1:-}"; [ -n "$TARGET" ] || die "usage: $0 deploy@HOST [--profile NAME]..."
shift
PROFILES=(--profile https)
while [ $# -gt 0 ]; do
  case "$1" in
    --profile) case "${2:-}" in routing|automation) PROFILES+=(--profile "$2") ;; *) die "profile must be routing or automation" ;; esac; shift 2 ;;
    *) die "unknown option $1" ;;
  esac
done
ssh "$TARGET" "flock -n /opt/campus/deploy.lock bash -s -- ${PROFILES[*]@Q}" <<'REMOTE'
set -euo pipefail
PROFILES=("$@")
ROOT=/opt/campus; ENV_FILE="$ROOT/shared/.env"
die() { echo "error: $*" >&2; exit 1; }
[ -L "$ROOT/previous" ] || die "no previous release recorded on this host"
OLD="$(readlink -f "$ROOT/previous")"; FAILED="$(readlink -f "$ROOT/current" 2>/dev/null || echo none)"
started="$(date +%s)"
docker compose --env-file "$ENV_FILE" -f "$OLD/infra/docker-compose.yml" "${PROFILES[@]}" up -d --build --wait --remove-orphans
HOST="$(grep -E '^PRODUCT_HOSTNAME=' "$ENV_FILE" | tail -n 1 | cut -d= -f2-)"
"$OLD/infra/check_stack.sh" "https://$HOST" || die "the previous release is running but its probes fail"
ln -sfn "$OLD" "$ROOT/current"
printf '%s rollback to %s from %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(cat "$OLD/RELEASE")" "$FAILED" >> "$ROOT/deployments.log"
echo "rolled back to $(cat "$OLD/RELEASE") in $(( $(date +%s) - started )) s. The database was not changed."
REMOTE
