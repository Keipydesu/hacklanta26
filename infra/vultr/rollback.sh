#!/usr/bin/env bash
# Restart a known-good release (application images, proxy config and its tiles) and probe it.
# Which one depends on what happened:
#   * a rollout failed (deploy.sh left $ROOT/failed_release): `current` is still the last good
#     release, so it is restarted. This also works after the very first upgrade, when no `previous`
#     exists.
#   * the current release was deployed successfully but is misbehaving: `previous` is restarted.
#   --previous forces the second behaviour; --current forces the first. The data volume is kept and the database is NOT rolled back: if the failed release ran
# a migration the old code cannot read, fix forward or restore a backup deliberately.
#   infra/vultr/rollback.sh deploy@HOST [--current|--previous] [--profile routing] [--profile automation]
# NOT YET RUN against a real host.
set -euo pipefail
. "$(dirname "$0")/../lib.sh"
TARGET="${1:-}"; [ -n "$TARGET" ] || die "usage: $0 deploy@HOST [--profile NAME]..."
shift
PROFILES=(--profile https)
CHOICE=auto
while [ $# -gt 0 ]; do
  case "$1" in
    --profile) case "${2:-}" in routing|automation) PROFILES+=(--profile "$2") ;; *) die "profile must be routing or automation" ;; esac; shift 2 ;;
    --current|--previous) CHOICE="${1#--}"; shift ;;
    *) die "unknown option $1" ;;
  esac
done
QUOTED="$(printf '%q ' "${PROFILES[@]}")"
ssh "$TARGET" "cat > /tmp/campus-rollback.sh && { flock -n /opt/campus/deploy.lock bash /tmp/campus-rollback.sh $CHOICE $QUOTED </dev/null; rc=\$?; rm -f /tmp/campus-rollback.sh; exit \$rc; }" <<'REMOTE'
set -euo pipefail
CHOICE="$1"; shift
PROFILES=("$@")
ROOT=/opt/campus; ENV_FILE="$ROOT/shared/.env"
die() { echo "error: $*" >&2; exit 1; }
FAILED_ROLLOUT="$(cat "$ROOT/failed_release" 2>/dev/null || true)"
[ "$CHOICE" != auto ] || { [ -n "$FAILED_ROLLOUT" ] && CHOICE=current || CHOICE=previous; }
if [ "$CHOICE" = current ]; then
  [ -L "$ROOT/current" ] || die "no known-good release exists on this host (the first deployment failed); fix it and deploy again"
  OLD="$(readlink -f "$ROOT/current")"; FAILED="${FAILED_ROLLOUT:-none}"
else
  [ -L "$ROOT/previous" ] || die "no previous release recorded on this host"
  OLD="$(readlink -f "$ROOT/previous")"; FAILED="$(readlink -f "$ROOT/current" 2>/dev/null || echo none)"
fi
echo "==> restarting $CHOICE release $(cat "$OLD/RELEASE") (failed or replaced: $FAILED)" >&2
started="$(date +%s)"
docker compose --env-file "$ENV_FILE" -f "$OLD/infra/docker-compose.yml" "${PROFILES[@]}" up -d --build --wait --remove-orphans
HOST="$(grep -E '^PRODUCT_HOSTNAME=' "$ENV_FILE" | tail -n 1 | cut -d= -f2-)"
CHECKS=()
case " ${PROFILES[*]} " in *" routing "*) CHECKS+=(--probe-route --expect-routing valhalla) ;; esac
"$OLD/infra/check_stack.sh" "https://$HOST" ${CHECKS[@]+"${CHECKS[@]}"} || die "the previous release is running but its probes fail"
ln -sfn "$OLD" "$ROOT/current"
rm -f "$ROOT/failed_release"
printf '%s rollback to %s from %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(cat "$OLD/RELEASE")" "$FAILED" >> "$ROOT/deployments.log"
echo "rolled back to $(cat "$OLD/RELEASE") in $(( $(date +%s) - started )) s. The database was not changed."
REMOTE
