#!/usr/bin/env bash
# Deploy one exact commit of main to a prepared host and mark it current only after probes pass.
#
#   infra/vultr/deploy.sh deploy@HOST COMMIT [--profile routing] [--profile automation]
#
# Host layout (created by cloud-init.yaml):
#   /opt/campus/shared/.env        real settings, mode 600, created by the operator on the host
#   /opt/campus/shared/custom_files  routing tiles (optional), uploaded separately
#   /opt/campus/releases/<commit>  an exported copy of that commit, never a working tree
#   /opt/campus/current, previous  symlinks to releases
#
# The https profile is always on. Deployments are serialized with a lock on the host. The database
# is dumped before the new release starts and is never rolled back automatically.
# NOT YET RUN against a real host.
set -euo pipefail
. "$(dirname "$0")/../lib.sh"

TARGET="${1:-}"; COMMIT="${2:-}"
[ -n "$TARGET" ] && [ -n "$COMMIT" ] || die "usage: $0 deploy@HOST COMMIT [--profile NAME]..."
shift 2
PROFILES=(--profile https)
while [ $# -gt 0 ]; do
  case "$1" in
    --profile) case "${2:-}" in routing|automation) PROFILES+=(--profile "$2") ;; *) die "profile must be routing or automation" ;; esac; shift 2 ;;
    *) die "unknown option $1" ;;
  esac
done

note "preflight"
SHA="$(git -C "$REPO_DIR" rev-parse --verify "$COMMIT^{commit}")" || die "unknown commit $COMMIT"
git -C "$REPO_DIR" fetch --quiet origin main
git -C "$REPO_DIR" merge-base --is-ancestor "$SHA" origin/main || die "$SHA is not on origin/main. Deploy only a commit of main that passed CI, never a feature branch."
SHORT="${SHA:0:12}"
ssh -o BatchMode=yes "$TARGET" 'docker compose version >/dev/null && test -d /opt/campus/releases' \
  || die "cannot reach $TARGET, or it is not prepared (see infra/vultr/cloud-init.yaml)"

note "uploading an export of $SHORT"
git -C "$REPO_DIR" archive --format=tar "$SHA" | ssh "$TARGET" "rm -rf /opt/campus/releases/$SHORT.new && mkdir -p /opt/campus/releases/$SHORT.new && tar -x -C /opt/campus/releases/$SHORT.new && echo $SHA > /opt/campus/releases/$SHORT.new/RELEASE"

# Everything below runs on the host under one lock, so two deployments cannot interleave.
# The script is written to a file and run from there: `bash -s` would read it from stdin, and any
# `docker compose exec` inside would inherit that stdin and swallow the rest of the script.
QUOTED="$(printf '%q ' "${PROFILES[@]}")"
ssh "$TARGET" "cat > /tmp/campus-deploy-$SHORT.sh && { flock -n /opt/campus/deploy.lock bash /tmp/campus-deploy-$SHORT.sh '$SHORT' $QUOTED </dev/null; rc=\$?; rm -f /tmp/campus-deploy-$SHORT.sh; exit \$rc; }" <<'REMOTE'
set -euo pipefail
SHORT="$1"; shift
PROFILES=("$@")
ROOT=/opt/campus
ENV_FILE="$ROOT/shared/.env"
die() { echo "error: $*" >&2; exit 1; }
note() { echo "==> $*" >&2; }
value() { grep -E "^$1=" "$ENV_FILE" | tail -n 1 | cut -d= -f2-; }

[ -f "$ENV_FILE" ] || die "$ENV_FILE is missing. Create it on the host from infra/.env.example (mode 600)."
[ "$(stat -c %a "$ENV_FILE")" = "600" ] || die "$ENV_FILE must have mode 600"
for name in PRODUCT_DB_PASSWORD AUTOMATION_PUBLISH_KEY PRODUCT_HOSTNAME; do
  v="$(value "$name")"; [ -n "$v" ] || die "$name is empty in $ENV_FILE"
  case "$v" in replace-*|localhost) die "$name in $ENV_FILE is still a placeholder" ;; esac
done
[ "$(value API_BIND)" = "127.0.0.1" ] || die "set API_BIND=127.0.0.1 in $ENV_FILE so only Caddy is public"
# Passwords go into postgresql:// URLs unescaped, and Docker-published ports bypass ufw.
for name in PRODUCT_DB_PASSWORD OBSERVATIONS_DB_PASSWORD; do
  v="$(value "$name")"
  case "$v" in *[!A-Za-z0-9._~-]*) die "$name must use only letters, digits and . _ ~ - (it is embedded in a database URL)" ;; esac
done
case " ${PROFILES[*]} " in
  *" routing "*) [ -f "$ROOT/shared/custom_files/valhalla_tiles.tar" ] || die "routing profile requested but $ROOT/shared/custom_files has no tiles"
                 [ -n "$(value VALHALLA_URL)" ] || die "routing profile requested but VALHALLA_URL is empty in $ENV_FILE" ;;
esac
case " ${PROFILES[*]} " in
  *" automation "*) for name in OBSERVATIONS_DB_PASSWORD OBSERVATION_HOSTNAME; do [ -n "$(value "$name")" ] || die "$name is empty in $ENV_FILE"; done
                    [ "$(value AUTOMATION_BIND)" = "127.0.0.1" ] || die "set AUTOMATION_BIND=127.0.0.1 in $ENV_FILE: the observation ingress has no authentication and must only be reached through Caddy" ;;
esac
[ "$(df --output=avail -BG "$ROOT" | tail -n 1 | tr -dc 0-9)" -ge 3 ] || die "less than 3 GB free on $ROOT"

# Back up first: redeploying the commit that is already current replaces the very directory the backup runs from.
if [ -L "$ROOT/current" ] && docker compose --env-file "$ENV_FILE" -f "$ROOT/current/infra/docker-compose.yml" ps --status running --services 2>/dev/null | grep -qx db; then
  note "backing up the product database before the new release starts"
  ENV_FILE="$ENV_FILE" "$ROOT/current/infra/backup.sh" product "$ROOT/backups" >/dev/null || die "pre-deploy backup failed; nothing was changed"
fi
NEW="$ROOT/releases/$SHORT"
rm -rf "$NEW"; mv "$NEW.new" "$NEW"
mkdir -p "$ROOT/shared/custom_files"
rm -rf "$NEW/infra/valhalla/custom_files"; ln -s "$ROOT/shared/custom_files" "$NEW/infra/valhalla/custom_files"
compose() { docker compose --env-file "$ENV_FILE" -f "$NEW/infra/docker-compose.yml" "${PROFILES[@]}" "$@"; }

note "building images for $SHORT"
compose build --quiet
case " ${PROFILES[*]} " in
  *" automation "*) cp "$NEW/infra/caddy/automation.caddy" "$NEW/infra/caddy/enabled/automation.caddy" ;;
esac
note "starting"
compose up -d --wait db
case " ${PROFILES[*]} " in
  # The observation role and database must exist before its service starts.
  *" automation "*) ENV_FILE="$ENV_FILE" "$NEW/infra/provision_observation_db.sh" >/dev/null ;;
esac
compose up -d --wait --remove-orphans || die "the stack did not become healthy. Previous release: $(readlink -f "$ROOT/current" 2>/dev/null || echo none). Run infra/vultr/rollback.sh; the database was not rolled back."

HOST="$(value PRODUCT_HOSTNAME)"
note "probing https://$HOST"
ok=0
for _ in $(seq 1 30); do
  if "$NEW/infra/check_stack.sh" "https://$HOST" >/tmp/campus-probe.log 2>&1; then ok=1; break; fi
  sleep 4   # the first certificate can take a little while
done
cat /tmp/campus-probe.log
[ "$ok" = 1 ] || die "acceptance probes failed for $SHORT. current still points at the previous release; run infra/vultr/rollback.sh to restart it."

if [ -L "$ROOT/current" ] && [ "$(readlink -f "$ROOT/current")" != "$NEW" ]; then ln -sfn "$(readlink -f "$ROOT/current")" "$ROOT/previous"; fi
ln -sfn "$NEW" "$ROOT/current"
printf '%s %s profiles=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(cat "$NEW/RELEASE")" "${PROFILES[*]}" >> "$ROOT/deployments.log"
echo "deployed $(cat "$NEW/RELEASE") at https://$HOST (previous: $(readlink -f "$ROOT/previous" 2>/dev/null || echo none))"
REMOTE
