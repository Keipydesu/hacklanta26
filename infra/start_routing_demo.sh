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
# Ask the running service: Compose applies shell overrides and dotenv interpolation itself.
published="$(compose --profile routing port api 8000)" || die "could not resolve the API published address"
addresses="$(python3 - "$published" <<'PY'
import ipaddress, sys
try:
    host, port = sys.argv[1].strip().rsplit(':', 1)
    address = ipaddress.ip_address(host.strip('[]'))
    port = int(port)
    if not 1 <= port <= 65535:
        raise ValueError('invalid port')
except ValueError:
    sys.exit('Compose returned an invalid API published address')
def url(ip):
    host = f'[{ip}]' if ip.version == 6 else str(ip)
    return f'http://{host}:{port}'
probe = ipaddress.ip_address('::1' if address.version == 6 else '127.0.0.1') if address.is_unspecified else address
phone = f'http://YOUR_LAN_IP:{port}' if address.is_unspecified else ('-' if address.is_loopback else url(address))
print(url(probe), phone)
PY
)" || die "could not resolve the API published address"
base="${addresses%% *}"
phone="${addresses#* }"
ok=0
for _ in $(seq 1 30); do
  if "$INFRA_DIR/check_stack.sh" "$base" --expect-routing valhalla --probe-route; then ok=1; break; fi
  sleep 2
done
[ "$ok" = 1 ] || die "routing demo did not pass; inspect: docker compose --env-file $ENV_FILE -f $INFRA_DIR/docker-compose.yml --profile routing logs api valhalla"
echo "Routing demo ready at $base."
if [ "$phone" = - ]; then
  echo "API is bound to loopback only; set API_BIND to a LAN address and rerun before connecting a phone."
else
  echo "Set EXPO_PUBLIC_API_URL=$phone for the phone."
fi
