#!/usr/bin/env bash
# Start the local manual demo with real GSU routing; never report success on fixture routes.
# Requires infra/.env with development credentials. Optional argument builds tiles first:
#   infra/start_routing_demo.sh --campus | EXTRACT.osm.pbf | --geofabrik
# With no argument, reuse the already validated tile set.
set -euo pipefail
. "$(dirname "$0")/lib.sh"
require_env_file
require_real_values PRODUCT_DB_PASSWORD AUTOMATION_PUBLISH_KEY
[ $# -le 1 ] || die "usage: $0 [--campus | EXTRACT.osm.pbf | --geofabrik]"
if [ $# = 1 ]; then "$INFRA_DIR/valhalla/build_tiles.sh" "$1"; fi
for tile in valhalla.json valhalla_tiles.tar; do
  [ -s "$INFRA_DIR/valhalla/custom_files/$tile" ] || die "missing $tile; run $0 --campus to build GSU tiles"
done
# Shell environment overrides even an empty URL in the env file. Apply it to every Compose call
# so the selected profile and API destination cannot drift apart; do not rewrite stored credentials.
export VALHALLA_URL=http://valhalla:8002
note "starting the manual demo and campus routing engine (automation is not required)"
compose --profile routing up -d --build --wait db valhalla api
port="$(env_value API_PORT)"; port="${port:-8000}"
base="http://127.0.0.1:$port"
ok=0
for _ in $(seq 1 30); do
  if "$INFRA_DIR/check_stack.sh" "$base" --expect-routing valhalla --probe-route; then ok=1; break; fi
  sleep 2
done
[ "$ok" = 1 ] || die "routing demo did not pass; inspect: docker compose --env-file $ENV_FILE -f $INFRA_DIR/docker-compose.yml --profile routing logs api valhalla"
echo "Routing demo ready at $base. Set EXPO_PUBLIC_API_URL=http://YOUR_LAN_IP:$port for the phone."
