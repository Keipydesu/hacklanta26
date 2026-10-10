# Shared helpers for the infra scripts. Source it; do not execute it.
# shellcheck shell=bash
INFRA_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$INFRA_DIR/.." && pwd)"
ENV_FILE="${ENV_FILE:-$INFRA_DIR/.env}"

die() { echo "error: $*" >&2; exit 1; }
note() { echo "==> $*" >&2; }

require_env_file() {
  [ -f "$ENV_FILE" ] || die "$ENV_FILE not found. Copy infra/.env.example and replace the placeholders."
}

# Read one value from the env file without sourcing it (values are never echoed by callers).
env_value() {
  local line
  line="$(grep -E "^$1=" "$ENV_FILE" | tail -n 1 || true)"
  printf '%s' "${line#*=}"
}

# Fail if any of the named settings is missing or still a placeholder. Prints names only.
require_real_values() {
  local name value
  for name in "$@"; do
    value="$(env_value "$name")"
    [ -n "$value" ] || die "$name is empty in $ENV_FILE"
    case "$value" in replace-*) die "$name in $ENV_FILE is still a placeholder" ;; esac
  done
}

compose() {
  require_env_file
  docker compose --env-file "$ENV_FILE" -f "$INFRA_DIR/docker-compose.yml" "$@"
}

# Destructive and seeding commands only run where the operator has said this is demo data.
require_demo_environment() {
  [ "${DEMO_ENVIRONMENT:-}" = "yes" ] || die "refusing: set DEMO_ENVIRONMENT=yes to confirm this is a demo environment, not production"
}

db_admin() { compose exec -T db psql -v ON_ERROR_STOP=1 --username product "$@"; }
