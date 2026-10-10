#!/usr/bin/env bash
# Acceptance probes for a running stack. Read-only by default.
#   infra/check_stack.sh BASE_URL [--automation-url URL] [--write-demo] [--probe-route] [--probe-report] [--expect-storage postgis] [--expect-routing valhalla]
# --probe-route (read-only) requires a real, successful /v1/route response: HTTP 200, not the
# stage 0 fixed-fixture stub, with at least one LineString route. Use it whenever routing is enabled.
# --probe-report writes one DEMO-labeled report, retries it identically and reads it back from the
# feed; it needs DEMO_ENVIRONMENT=yes but not the simulator.
# --write-demo creates one DEMO-labeled manual report (create, identical retry, conflict, read back)
# and requests a route; it needs DEMO_ENVIRONMENT=yes and the simulator from Lane F.
set -euo pipefail
. "$(dirname "$0")/lib.sh"

BASE_URL="${1:-}"; [ -n "$BASE_URL" ] || die "usage: $0 BASE_URL [--automation-url URL] [--write-demo] [--expect-storage NAME] [--expect-routing NAME]"
shift
AUTOMATION_URL="" PROBE_ROUTE=0 PROBE_REPORT=0 WRITE_DEMO=0 EXPECT_STORAGE="" EXPECT_ROUTING=""
while [ $# -gt 0 ]; do
  case "$1" in
    --automation-url) AUTOMATION_URL="${2:?}"; shift 2 ;;
    --write-demo) WRITE_DEMO=1; shift ;;
    --probe-route) PROBE_ROUTE=1; shift ;;
    --probe-report) PROBE_REPORT=1; shift ;;
    --expect-storage) EXPECT_STORAGE="${2:?}"; shift 2 ;;
    --expect-routing) EXPECT_ROUTING="${2:?}"; shift 2 ;;
    *) die "unknown option $1" ;;
  esac
done
BASE_URL="${BASE_URL%/}"
failures=0
pass() { echo "PASS  $*"; }
fail() { echo "FAIL  $*"; failures=$((failures + 1)); }
field() { python3 -c 'import json,sys; print(json.load(sys.stdin).get(sys.argv[1], ""))' "$1"; }

health="$(curl -fsS --max-time 10 "$BASE_URL/healthz" || true)"
if [ "$(printf '%s' "$health" | field status 2>/dev/null)" = "ok" ]; then
  storage="$(printf '%s' "$health" | field storage)"; routing="$(printf '%s' "$health" | field routing)"
  pass "product health ok (storage: ${storage:-unknown}, routing: ${routing:-not reported})"
  [ -z "$EXPECT_STORAGE" ] || { [ "$storage" = "$EXPECT_STORAGE" ] && pass "storage is $EXPECT_STORAGE" || fail "storage is '$storage', expected '$EXPECT_STORAGE'"; }
  [ -z "$EXPECT_ROUTING" ] || { [ "$routing" = "$EXPECT_ROUTING" ] && pass "routing is $EXPECT_ROUTING" || fail "routing is '$routing', expected '$EXPECT_ROUTING'"; }
else
  fail "product health at $BASE_URL/healthz"
fi

feed_type="$(curl -fsS --max-time 10 "$BASE_URL/v1/hazards?bbox=-84.40,33.74,-84.37,33.77" | field type 2>/dev/null || true)"
[ "$feed_type" = "FeatureCollection" ] && pass "hazard feed readable" || fail "hazard feed at $BASE_URL/v1/hazards"

code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 -X PUT -H 'Content-Type: application/json' -d '{}' \
  "$BASE_URL/v1/automatic/hazards/00000000-0000-4000-8000-000000000000" || true)"
[ "$code" = "401" ] && pass "publication without a credential is rejected (401)" || fail "publication without a credential returned $code, expected 401"

case "$BASE_URL" in
  https://*)
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$BASE_URL/" || true)"
    [ "$code" = "404" ] && pass "paths outside the API are not proxied (404)" || fail "GET / returned $code, expected 404" ;;
esac

if [ -n "$AUTOMATION_URL" ]; then
  status="$(curl -fsS --max-time 10 "${AUTOMATION_URL%/}/healthz" | field status 2>/dev/null || true)"
  [ "$status" = "ok" ] && pass "observation service health ok" || fail "observation service health at ${AUTOMATION_URL%/}/healthz"
fi

if [ "$PROBE_ROUTE" = 1 ]; then
  python3 - "$BASE_URL" <<'PY' && pass "real route returned (not the fixed fixture)" || fail "route probe"
import json, sys, urllib.request, urllib.error
base = sys.argv[1]
body = json.dumps({"origin": {"lat": 33.7531, "lon": -84.3853}, "destination": {"lat": 33.7560, "lon": -84.3880}}).encode()
request = urllib.request.Request(base + "/v1/route", body, {"Content-Type": "application/json"})
try:
    with urllib.request.urlopen(request, timeout=30) as response:
        stub, data = response.headers.get("X-Stage-0-Stub"), json.load(response)
except urllib.error.HTTPError as e:
    sys.exit(f"route request returned HTTP {e.code}")
except Exception as e:
    sys.exit(f"route request failed: {e}")
if stub:
    sys.exit(f"route is the fixed stage 0 fixture ({stub}), not real routing")
routes = data.get("routes") or []
if not routes or any(r.get("geometry", {}).get("type") != "LineString" or not r.get("distance_m") for r in routes):
    sys.exit("route response has no usable LineString route")
PY
fi

if [ "$PROBE_REPORT" = 1 ]; then
  require_demo_environment
  python3 - "$BASE_URL" <<'PY' && pass "report probe: create, identical retry, read-back" || fail "report probe"
import json, sys, uuid, urllib.request, urllib.error
from datetime import datetime, timezone
base = sys.argv[1]
body = {"id": str(uuid.uuid4()), "kind": "other", "lat": 33.75312, "lon": -84.38531,
        "observed_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "description": "DEMO deployment acceptance probe"}
def post():
    request = urllib.request.Request(base + "/v1/reports", json.dumps(body).encode(), {"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            return response.status, json.load(response)
    except urllib.error.HTTPError as e:
        sys.exit(f"POST /v1/reports returned HTTP {e.code}")
status, first = post()
if status != 201 or first.get("duplicate") is not False:
    sys.exit(f"first submission: expected 201 duplicate=false, got {status} {first}")
status, again = post()
if status != 200 or again.get("duplicate") is not True or again.get("hazard_id") != first["hazard_id"]:
    sys.exit(f"identical retry: expected 200 duplicate=true with the same hazard, got {status} {again}")
with urllib.request.urlopen(base + "/v1/hazards?bbox=-84.3860,33.7525,-84.3845,33.7540", timeout=15) as response:
    ids = [f["properties"]["id"] for f in json.load(response)["features"]]
if ids.count(first["hazard_id"]) != 1:
    sys.exit(f"the new hazard appears {ids.count(first['hazard_id'])} times in the feed, expected once")
PY
fi

if [ "$WRITE_DEMO" = 1 ]; then
  require_demo_environment
  [ -d "$REPO_DIR/simulator/src/simulator" ] || die "--write-demo needs the simulator (Lane F) in this checkout"
  export PYTHONPATH="$REPO_DIR/simulator/src"
  python3 -m simulator.cli manual --product-url "$BASE_URL" --demo-target >/dev/null \
    && pass "manual report: create, identical retry, conflict and read-back" || fail "manual report scenario"
  python3 -m simulator.cli routes --product-url "$BASE_URL" --demo-target | tail -n 3 \
    && pass "route response shape (see output for whether routing is real or the fixed example)" || fail "route probe"
fi

[ "$failures" = 0 ] || die "$failures probe(s) failed"
echo "all probes passed"
