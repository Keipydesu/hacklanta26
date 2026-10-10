#!/usr/bin/env bash
# Acceptance probes for a running stack. Read-only by default.
#   infra/check_stack.sh BASE_URL [--automation-url URL] [--write-demo] [--expect-storage postgis] [--expect-routing valhalla]
# --write-demo creates one DEMO-labeled manual report (create, identical retry, conflict, read back)
# and requests a route; it needs DEMO_ENVIRONMENT=yes and the simulator from Lane F.
set -euo pipefail
. "$(dirname "$0")/lib.sh"

BASE_URL="${1:-}"; [ -n "$BASE_URL" ] || die "usage: $0 BASE_URL [--automation-url URL] [--write-demo] [--expect-storage NAME] [--expect-routing NAME]"
shift
AUTOMATION_URL="" WRITE_DEMO=0 EXPECT_STORAGE="" EXPECT_ROUTING=""
while [ $# -gt 0 ]; do
  case "$1" in
    --automation-url) AUTOMATION_URL="${2:?}"; shift 2 ;;
    --write-demo) WRITE_DEMO=1; shift ;;
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
