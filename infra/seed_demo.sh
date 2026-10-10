#!/usr/bin/env bash
# Seed demo data through the public APIs using Lane F's simulator. Never touches a database.
#   DEMO_ENVIRONMENT=yes infra/seed_demo.sh PRODUCT_URL [--automation-url URL] [--at LAT,LON] [--seed N]
# Default: one DEMO-labeled manual report. With --automation-url: also three simulated hard-brake
# events from two rides (scenario demo-seed), then waits for the worker to publish the hazard.
set -euo pipefail
. "$(dirname "$0")/lib.sh"
require_demo_environment
PRODUCT_URL="${1:-}"; [ -n "$PRODUCT_URL" ] || die "usage: DEMO_ENVIRONMENT=yes $0 PRODUCT_URL [--automation-url URL] [--at LAT,LON] [--seed N]"
shift
AUTOMATION_URL="" AT=() SEED=42
while [ $# -gt 0 ]; do
  case "$1" in
    --automation-url) AUTOMATION_URL="${2:?}"; shift 2 ;;
    --at) AT=(--at "${2:?}"); shift 2 ;;
    --seed) SEED="${2:?}"; shift 2 ;;
    *) die "unknown option $1" ;;
  esac
done
[ -d "$REPO_DIR/simulator/src/simulator" ] || die "the simulator (Lane F) is not in this checkout"
export PYTHONPATH="$REPO_DIR/simulator/src"
note "manual report (community source)"
python3 -m simulator.cli manual --product-url "$PRODUCT_URL" --demo-target --seed "$SEED"
if [ -n "$AUTOMATION_URL" ]; then
  note "simulated observations -> worker -> published hazard (evidence: simulated)"
  python3 -m simulator.cli observations --scenario demo-seed --automation-url "$AUTOMATION_URL" \
    --product-url "$PRODUCT_URL" --demo-target --seed "$SEED" --wait 90 "${AT[@]}"
fi
