#!/usr/bin/env bash
# Empty ONE demo dataset. Stops the service that owns it, recreates its database, and starts the
# service again so its own migrations rebuild the schema. Never resets both, never without the flag.
#   DEMO_ENVIRONMENT=yes infra/reset_db.sh product|observations --yes-delete-demo-data
set -euo pipefail
. "$(dirname "$0")/lib.sh"
DATASET="${1:-}"; CONFIRM="${2:-}"
case "$DATASET" in
  product) SERVICE=api OWNER=product PROFILE=() ;;
  observations) SERVICE=automatic OWNER=observations PROFILE=(--profile automation) ;;
  *) die "usage: DEMO_ENVIRONMENT=yes $0 product|observations --yes-delete-demo-data" ;;
esac
require_demo_environment
[ "$CONFIRM" = "--yes-delete-demo-data" ] || die "this deletes every row in the '$DATASET' dataset. Re-run with --yes-delete-demo-data"
note "resetting dataset '$DATASET' (service: $SERVICE). The other dataset is not touched."
compose "${PROFILE[@]}" stop "$SERVICE" >/dev/null 2>&1 || true
db_admin --dbname postgres -c "DROP DATABASE IF EXISTS $DATASET WITH (FORCE)" -c "CREATE DATABASE $DATASET OWNER $OWNER" \
  -c "REVOKE CONNECT ON DATABASE $DATASET FROM PUBLIC" >/dev/null
db_admin --dbname "$DATASET" -c 'CREATE EXTENSION IF NOT EXISTS postgis' >/dev/null
compose "${PROFILE[@]}" up -d "$SERVICE"
echo "dataset '$DATASET' is empty; $SERVICE restarted and will recreate its schema"
