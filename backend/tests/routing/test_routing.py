"""Routing tests replay responses recorded from a real Valhalla (see fixtures/); no engine needed."""
import asyncio
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path

import httpx
import pytest
from shapely.geometry import Polygon, box

from app.main import create_app
from app.routing import planner
from app.routing.planner import Hazard
from app.routing.valhalla import NoPath, Unavailable, ValhallaClient, decode_polyline6, parse_trip
from app.schemas import Coordinate
from test_boundary import fresh, validate

FIX = Path(__file__).parent / 'fixtures'
def load(name):
    return json.loads((FIX / name).read_text())

ORIGIN, DEST = Coordinate(lat=33.7531, lon=-84.3853), Coordinate(lat=33.7560, lon=-84.3880)
RING = load('exclusion-ring-a.json')['ring']

class Recorded:
    """MockTransport that answers like the recorded Valhalla; keeps every request body."""
    def __init__(self, missing_path=False):
        self.requests, self.no_path = [], missing_path
        self.transport = httpx.MockTransport(self.handle)
    def handle(self, request):
        body = json.loads(request.content)
        self.requests.append(body)
        assert body['costing'] == 'pedestrian' and body['costing_options']['pedestrian'] == {'walking_speed': 16, 'step_penalty': 600}
        if 'exclude_polygons' in body:
            if self.no_path:
                return httpx.Response(400, json=load('no-path.json')['body'])
            return httpx.Response(200, json=load('alternative-a.json'))
        return httpx.Response(200, json=load('baseline-a.json'))
    def client(self):
        return ValhallaClient('http://valhalla.test', httpx.AsyncClient(transport=self.transport))

def hazard(id, score, ring=RING):
    return Hazard(id, score, Polygon(ring))

def run_plan(recorded, hazards, origin=ORIGIN, dest=DEST):
    async def loader(bounds):
        return [h for h in hazards if h.polygon.intersects(box(*bounds))]
    return asyncio.run(planner.plan(recorded.client(), origin, dest, loader))

def test_decode_precision_units_and_endpoints():
    candidate = parse_trip(load('baseline-a.json'))
    first, last = candidate.coordinates[0], candidate.coordinates[-1]
    assert first == pytest.approx([-84.3853, 33.7531], abs=2e-4) and last == pytest.approx([-84.3880, 33.7560], abs=2e-4)
    assert candidate.distance_m == pytest.approx(588) and candidate.duration_s == pytest.approx(144.314)

def encode6(points):
    out, plat, plon = '', 0, 0
    for lon, lat in points:
        for value, prev in ((round(lat * 1e6), plat), (round(lon * 1e6), plon)):
            delta = value - prev
            delta = ~(delta << 1) if delta < 0 else delta << 1
            while delta >= 0x20:
                out += chr((0x20 | (delta & 0x1F)) + 63)
                delta >>= 5
            out += chr(delta + 63)
        plat, plon = round(lat * 1e6), round(lon * 1e6)
    return out

def test_legs_are_joined_without_duplicating_the_shared_point():
    a, b, c = [-84.385, 33.753], [-84.386, 33.754], [-84.387, 33.755]
    assert decode_polyline6(encode6([a, b])) == [a, b]
    payload = {'trip': {'summary': {'length': 0.2, 'time': 30}, 'legs': [{'shape': encode6([a, b])}, {'shape': encode6([b, c])}]}}
    assert parse_trip(payload).coordinates == [a, b, c]

def test_no_hazards_gives_identical_routes_with_zero_risk():
    result = run_plan(Recorded(), [])
    shortest, safest = result['routes']
    assert result['safest_available'] and shortest == dict(safest, kind='shortest')
    assert shortest['risk_score'] == 0 and shortest['hazard_ids'] == []

def test_hazard_on_baseline_is_avoided_by_safest_and_reported_on_shortest():
    recorded = Recorded()
    result = run_plan(recorded, [hazard('11111111-1111-1111-1111-111111111111', 0.9)])
    shortest, safest = result['routes']
    assert recorded.requests[1]['exclude_polygons'] == [RING]  # [lon, lat] exterior ring
    assert shortest['hazard_ids'] == ['11111111-1111-1111-1111-111111111111'] and shortest['risk_score'] == pytest.approx(0.9)
    assert safest['geometry'] != shortest['geometry'] and safest['hazard_ids'] == [] and safest['risk_score'] == 0
    assert safest['distance_m'] == pytest.approx(544) and result['safest_available']

def test_below_threshold_hazard_is_scored_but_not_excluded():
    recorded = Recorded()
    result = run_plan(recorded, [hazard('a', 0.3), hazard('b', 0.2)])
    assert len(recorded.requests) == 1  # no exclusion request at all
    shortest = result['routes'][0]
    assert shortest['hazard_ids'] == ['a', 'b'] and shortest['risk_score'] == pytest.approx(1 - 0.7 * 0.8)

def test_hazard_at_endpoint_is_not_excluded_but_is_scored():
    around_dest = [[DEST.lon + dx, DEST.lat + dy] for dx, dy in [(-1e-4, -1e-4), (1e-4, -1e-4), (1e-4, 1e-4), (-1e-4, 1e-4), (-1e-4, -1e-4)]]
    recorded = Recorded()
    result = run_plan(recorded, [hazard('end', 0.9, around_dest)])
    assert len(recorded.requests) == 1
    assert result['routes'][0]['hazard_ids'] == ['end']

def test_exclusions_capped_at_twenty_nearest():
    far = lambda i: [[-84.3853 + dx, 33.7531 + 0.0001 * i + dy] for dx, dy in [(0, 0), (1e-5, 0), (1e-5, 1e-5), (0, 1e-5), (0, 0)]]
    hazards = [hazard(f'h{i:02d}', 0.8, far(i)) for i in range(30)]
    rings = planner.select_exclusions(hazards, ORIGIN, DEST)
    assert len(rings) == 20

def test_no_path_returns_baseline_for_both_kinds():
    result = run_plan(Recorded(missing_path=True), [hazard('x', 0.9)])
    shortest, safest = result['routes']
    assert not result['safest_available'] and shortest['geometry'] == safest['geometry']

def test_outage_and_misconfiguration_are_unavailable_not_no_path():
    def failing(handler):
        return ValhallaClient('http://v.test', httpx.AsyncClient(transport=httpx.MockTransport(handler)))
    def boom(request):
        raise httpx.ConnectError('down')
    with pytest.raises(Unavailable):
        asyncio.run(failing(boom).route(ORIGIN, DEST))
    bad = load('bad-request.json')
    with pytest.raises(Unavailable):  # HTTP 400 with a code other than 442
        asyncio.run(failing(lambda r: httpx.Response(400, json=bad['body'])).route(ORIGIN, DEST))
    with pytest.raises(NoPath):
        asyncio.run(failing(lambda r: httpx.Response(400, json=load('no-path.json')['body'])).route(ORIGIN, DEST, [RING]))
    with pytest.raises(Unavailable):
        asyncio.run(failing(lambda r: httpx.Response(503)).route(ORIGIN, DEST))
    with pytest.raises(Unavailable):
        asyncio.run(failing(lambda r: httpx.Response(200, json={'trip': {}})).route(ORIGIN, DEST))

class OneRoute:
    """Fake engines implement route(); routes() returns it without alternates."""
    async def routes(self, origin, destination, exclusions=(), alternates=0):
        return [await self.route(origin, destination, exclusions)]

class Scripted(OneRoute):
    """Fake engine returning fixed candidates, to exercise detours outside the initial search area."""
    def __init__(self, *candidates):
        self.candidates = list(candidates)
    async def route(self, origin, destination, exclusions=()):
        return self.candidates.pop(0) if len(self.candidates) > 1 else self.candidates[0]

def candidate(points):
    from app.routing.valhalla import Candidate
    return Candidate([list(p) for p in points], 1000, 100)

def test_detour_outside_initial_bounds_loads_and_scores_those_hazards():
    straight = candidate([(ORIGIN.lon, ORIGIN.lat), (DEST.lon, DEST.lat)])
    detour = candidate([(ORIGIN.lon, ORIGIN.lat), (ORIGIN.lon - 0.01, ORIGIN.lat), (DEST.lon, DEST.lat)])
    blocker = hazard('mid', 0.9, square((ORIGIN.lon + DEST.lon) / 2, (ORIGIN.lat + DEST.lat) / 2))   # sits on the straight route
    detour_hazard = hazard('far', 0.5, [[ORIGIN.lon - 0.0101, ORIGIN.lat - 0.001], [ORIGIN.lon - 0.0099, ORIGIN.lat - 0.001],
                                        [ORIGIN.lon - 0.0099, ORIGIN.lat + 0.001], [ORIGIN.lon - 0.0101, ORIGIN.lat + 0.001], [ORIGIN.lon - 0.0101, ORIGIN.lat - 0.001]])
    calls = []
    async def loader(bounds):
        calls.append(bounds)
        return [h for h in (blocker, detour_hazard) if h.polygon.intersects(box(*bounds))]
    result = asyncio.run(planner.plan(Scripted(straight, detour), ORIGIN, DEST, loader))
    assert len(calls) == 2 and calls[1][0] < calls[0][0]  # widened once
    assert 'far' in result['routes'][1]['hazard_ids'] and result['routes'][1]['risk_score'] > 0

def test_route_still_outside_after_widening_is_unavailable():
    wanderer = lambda n: candidate([(ORIGIN.lon, ORIGIN.lat), (ORIGIN.lon - 0.01 * n, ORIGIN.lat), (DEST.lon, DEST.lat)])
    class Growing(Scripted):
        n = 0
        async def route(self, origin, destination, exclusions=()):
            self.n += 1
            return wanderer(self.n * 3 if self.n > 1 else 0.0001)
    blocker = hazard('b', 0.9)
    async def loader(bounds):
        return [blocker]
    with pytest.raises(Unavailable):
        asyncio.run(planner.plan(Growing(), ORIGIN, DEST, loader))


def test_api_route_uses_manual_and_automatic_hazards_and_survives_outage(monkeypatch):
    from fastapi.testclient import TestClient
    recorded = Recorded()
    monkeypatch.setenv('AUTOMATION_PUBLISH_KEY', 'test-only-key')
    monkeypatch.setenv('VALHALLA_URL', 'http://valhalla.test')
    app = create_app('')
    app.state.valhalla.http = httpx.AsyncClient(transport=recorded.transport)
    mid = [(RING[0][0] + RING[2][0]) / 2, (RING[0][1] + RING[2][1]) / 2]
    request = {'origin': {'lat': ORIGIN.lat, 'lon': ORIGIN.lon}, 'destination': {'lat': DEST.lat, 'lon': DEST.lon}}
    with TestClient(app) as client:
        assert client.get('/healthz').json()['routing'] == 'valhalla'
        empty = client.post('/v1/route', json=request)
        assert empty.status_code == 200 and 'X-Stage-0-Stub' not in empty.headers
        validate('RouteResponse', empty.json())
        manual = dict(fresh()[0], lat=mid[1], lon=mid[0])
        hazard_id = client.post('/v1/reports', json=manual).json()['hazard_id']
        routed = client.post('/v1/route', json=request).json()
        validate('RouteResponse', routed)
        assert hazard_id in routed['routes'][0]['hazard_ids'] and routed['routes'][0]['risk_score'] == pytest.approx(0.5)
        # Engine outage: 503 for routes only; reports and reads keep working.
        app.state.valhalla.http = httpx.AsyncClient(transport=httpx.MockTransport(lambda r: httpx.Response(503)))
        assert client.post('/v1/route', json=request).status_code == 503
        assert client.post('/v1/reports', json=dict(manual, id=str(__import__('uuid').uuid4()))).status_code == 201
        assert client.get('/v1/hazards?bbox=-84.40,33.74,-84.37,33.77').status_code == 200

def square(lon, lat, d=3e-5):
    return [[lon - d, lat - d], [lon + d, lat - d], [lon + d, lat + d], [lon - d, lat + d], [lon - d, lat - d]]

def test_riskier_detour_is_not_called_safest():
    from app.routing.valhalla import Candidate
    mid = ((ORIGIN.lon + DEST.lon) / 2, (ORIGIN.lat + DEST.lat) / 2)
    straight = Candidate([[ORIGIN.lon, ORIGIN.lat], [DEST.lon, DEST.lat]], 400, 90)
    detour = Candidate([[ORIGIN.lon, ORIGIN.lat], [mid[0] + 0.0004, mid[1] - 0.0003], [DEST.lon, DEST.lat]], 600, 140)
    bend = (mid[0] + 0.0004, mid[1] - 0.0003)
    hazards = [hazard('on-baseline', 0.45, square(*mid)),
               hazard('d1', 0.3, square(*bend)),
               hazard('d2', 0.3, square((ORIGIN.lon + bend[0]) / 2, (ORIGIN.lat + bend[1]) / 2))]
    async def loader(bounds):
        return hazards
    result = asyncio.run(planner.plan(Scripted(straight, detour), ORIGIN, DEST, loader))
    shortest, safest = result['routes']
    assert shortest['risk_score'] == pytest.approx(0.45)
    assert safest['geometry'] == shortest['geometry'] and not result['safest_available']

def test_exclusions_follow_the_baseline_route_not_the_straight_line():
    winding = [(-84.3853, 33.7531), (-84.3853, 33.7600), (-84.3880, 33.7560)]
    near_path = hazard('on-path', 0.9, square(-84.3853, 33.7580))                    # far from the straight origin-destination line
    near_line = hazard('near-line', 0.9, square((ORIGIN.lon + DEST.lon) / 2 + 0.0004, (ORIGIN.lat + DEST.lat) / 2))
    many = [hazard(f'n{i}', 0.9, square(-84.3860 + i * 1e-4, 33.7545, 1e-5)) for i in range(25)]
    rings = planner.select_exclusions(many + [near_path, near_line], ORIGIN, DEST, winding)
    assert square(-84.3853, 33.7580) in [[list(map(float, p)) for p in r] for r in rings] or len(rings) == 20
    assert any(abs(r[0][0] - (-84.3853)) < 1e-3 and r[0][1] > 33.757 for r in rings)  # the on-path hazard made the cut

def test_only_no_path_is_rider_error_and_engine_rejections_are_503(monkeypatch):
    from fastapi.testclient import TestClient
    monkeypatch.setenv('VALHALLA_URL', 'http://valhalla.test')
    request = {'origin': {'lat': ORIGIN.lat, 'lon': ORIGIN.lon}, 'destination': {'lat': DEST.lat, 'lon': DEST.lon}}
    app = create_app('')
    with TestClient(app) as client:
        app.state.valhalla.http = httpx.AsyncClient(transport=httpx.MockTransport(lambda r: httpx.Response(400, json=load('no-path.json')['body'])))
        assert client.post('/v1/route', json=request).status_code == 422
        app.state.valhalla.http = httpx.AsyncClient(transport=httpx.MockTransport(lambda r: httpx.Response(400, json=load('bad-request.json')['body'])))
        assert client.post('/v1/route', json=request).status_code == 503
        # A malformed exclusion request is an engine/adapter failure, not proof of no alternative.
        def handler(r):
            body = json.loads(r.content)
            if 'exclude_polygons' in body:
                return httpx.Response(400, json=load('bad-request.json')['body'])
            return httpx.Response(200, json=load('baseline-a.json'))
        app.state.valhalla.http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        mid = [(RING[0][0] + RING[2][0]) / 2, (RING[0][1] + RING[2][1]) / 2]
        client.post('/v1/reports', json=dict(fresh()[0], lat=mid[1], lon=mid[0]))
        result = client.post('/v1/route', json=request)
        assert result.status_code == 503


@pytest.mark.parametrize('error_body', [[], None, 'bad request', {}, {'error_code': '442'}, {'error_code': 999}])
def test_malformed_or_unknown_engine_errors_are_503(monkeypatch, error_body):
    from fastapi.testclient import TestClient
    monkeypatch.setenv('VALHALLA_URL', 'http://valhalla.test')
    app = create_app('')
    app.state.valhalla.http = httpx.AsyncClient(transport=httpx.MockTransport(
        lambda r: httpx.Response(400, content=json.dumps(error_body))))
    with TestClient(app, raise_server_exceptions=False) as client:
        result = client.post('/v1/route', json={'origin': ORIGIN.model_dump(), 'destination': DEST.model_dump()})
        assert result.status_code == 503


@pytest.mark.parametrize('field,value', [('length', 'Infinity'), ('time', 'Infinity'), ('time', 'NaN')])
def test_nonfinite_engine_metrics_are_503(monkeypatch, field, value):
    from fastapi.testclient import TestClient
    monkeypatch.setenv('VALHALLA_URL', 'http://valhalla.test')
    payload = load('baseline-a.json')
    payload['trip']['summary'][field] = value
    app = create_app('')
    app.state.valhalla.http = httpx.AsyncClient(transport=httpx.MockTransport(lambda r: httpx.Response(200, json=payload)))
    with TestClient(app, raise_server_exceptions=False) as client:
        result = client.post('/v1/route', json={'origin': ORIGIN.model_dump(), 'destination': DEST.model_dump()})
        assert result.status_code == 503


@pytest.mark.parametrize('widen_baseline', [False, True])
def test_full_area_reload_removes_hazards_missing_from_latest_snapshot(widen_baseline):
    straight = candidate([(ORIGIN.lon, ORIGIN.lat), (DEST.lon, DEST.lat)])
    detour = candidate([(ORIGIN.lon, ORIGIN.lat), (ORIGIN.lon - 0.01, ORIGIN.lat), (DEST.lon, DEST.lat)])
    blocker = hazard('removed', 0.9, square((ORIGIN.lon + DEST.lon) / 2, (ORIGIN.lat + DEST.lat) / 2))
    loads, requests = [], []
    async def loader(bounds):
        loads.append(bounds)
        # The second query covers the whole enlarged envelope. The old hazard has
        # resolved/expired/moved out, while a newly published low-score hazard exists.
        return [blocker] if len(loads) == 1 else [hazard('new', 0.2, RING)]
    class Engine(OneRoute):
        async def route(self, origin, destination, exclusions=()):
            requests.append(exclusions)
            return detour if widen_baseline or exclusions else straight
    result = asyncio.run(planner.plan(Engine(), ORIGIN, DEST, loader))
    assert len(loads) == 2
    assert planner.covers(loads[1], loads[0])
    assert len(requests) == (1 if widen_baseline else 2), 'removed blocker must not trigger another exclusion call'
    for route in result['routes']:
        assert 'removed' not in route['hazard_ids']
        assert route['risk_score'] <= 0.2

def via(dlon, dlat, distance=500, duration=120):
    """A two-segment route through the trip midpoint shifted by (dlon, dlat)."""
    from app.routing.valhalla import Candidate
    mid = ((ORIGIN.lon + DEST.lon) / 2 + dlon, (ORIGIN.lat + DEST.lat) / 2 + dlat)
    return Candidate([[ORIGIN.lon, ORIGIN.lat], list(mid), [DEST.lon, DEST.lat]], distance, duration)

def test_client_requests_and_parses_alternates():
    a, b = [-84.3853, 33.7531], [-84.3880, 33.7560]
    trip = lambda bend, km: {'trip': {'summary': {'length': km, 'time': km * 225}, 'legs': [{'shape': encode6([a, bend, b])}]}}
    sent = []
    def handle(request):
        sent.append(json.loads(request.content))
        return httpx.Response(200, json={**trip([-84.386, 33.754], 0.5), 'alternates': [trip([-84.387, 33.753], 0.6)]})
    client = ValhallaClient('http://valhalla.test', httpx.AsyncClient(transport=httpx.MockTransport(handle)))
    best, other = asyncio.run(client.routes(ORIGIN, DEST, alternates=2))
    assert sent[0]['alternates'] == 2
    assert best.distance_m == pytest.approx(500) and other.distance_m == pytest.approx(600)
    assert other.coordinates[1] == [-84.387, 33.753]

def test_malformed_alternates_are_unavailable():
    def handle(request):
        return httpx.Response(200, json={**load('baseline-a.json'), 'alternates': {'trip': 'oops'}})
    client = ValhallaClient('http://valhalla.test', httpx.AsyncClient(transport=httpx.MockTransport(handle)))
    with pytest.raises(Unavailable):
        asyncio.run(client.routes(ORIGIN, DEST, alternates=2))

def test_alternatives_drop_repeats_dominated_and_unscored_routes():
    blocker = hazard('b', 0.5, square(*(lambda c: (c[0] + 0.0003, c[1]))(((ORIGIN.lon + DEST.lon) / 2, (ORIGIN.lat + DEST.lat) / 2))))
    shown_route = via(0, 0, 500, 120)
    shown = [planner.route_json(kind, shown_route, [blocker]) for kind in ('shortest', 'safest')]
    covered = planner.trip_bounds([(ORIGIN.lon, ORIGIN.lat), (DEST.lon, DEST.lat)])
    candidates = [
        via(0.00001, 0, 510, 121),          # same road as shown: dropped
        via(0.0003, 0, 600, 130),           # through the hazard and slower: dropped
        via(-0.0003, 0, 700, 150),          # different road, no riskier: kept even though slower
        via(0.01, 0, 900, 200),             # leaves the loaded area: never scored as zero risk
    ]
    picked = planner.pick_alternatives(candidates, shown, [blocker], covered)
    assert [r['distance_m'] for r in picked] == [700] and picked[0]['kind'] == 'alternative'

def test_alternatives_capped_and_ordered_by_risk_then_time():
    covered = planner.trip_bounds([(ORIGIN.lon, ORIGIN.lat), (DEST.lon, DEST.lat)])
    shown = [planner.route_json(kind, via(0, 0), []) for kind in ('shortest', 'safest')]
    candidates = [via(d, 0, 500, t) for d, t in ((-0.0006, 160), (0.0006, 140), (-0.0012, 150))]
    picked = planner.pick_alternatives(candidates, shown, [], covered)
    assert [r['duration_s'] for r in picked] == [140, 150]

def test_plan_returns_contract_valid_alternatives():
    class Alternates(OneRoute):
        async def route(self, origin, destination, exclusions=()):
            return via(0, 0)
        async def routes(self, origin, destination, exclusions=(), alternates=0):
            return [via(0, 0), via(-0.0006, 0, 700, 160)][:1 + alternates]
    async def loader(bounds):
        return []
    result = asyncio.run(planner.plan(Alternates(), ORIGIN, DEST, loader))
    validate('RouteResponse', json.loads(json.dumps(result)))
    assert [r['kind'] for r in result['routes']] == ['shortest', 'safest']
    assert [r['kind'] for r in result['alternatives']] == ['alternative']

def test_recorded_alternates_are_scored_and_kept():
    """alternates-a.json: real Valhalla 3.9.1 pedestrian response with alternates=2 (see backend/README.md)."""
    def handle(request):
        body = json.loads(request.content)
        return httpx.Response(200, json=load('alternative-a.json' if 'exclude_polygons' in body else 'alternates-a.json'))
    client = ValhallaClient('http://valhalla.test', httpx.AsyncClient(transport=httpx.MockTransport(handle)))
    async def loader(bounds):
        return [h for h in [hazard('5b0e2b4c-0d3a-4b8e-9a51-3f0e6c1d2a77', 0.9)] if h.polygon.intersects(box(*bounds))]
    result = asyncio.run(planner.plan(client, ORIGIN, DEST, loader))
    validate('RouteResponse', json.loads(json.dumps(result)))
    shown = [r['geometry']['coordinates'] for r in result['routes']]
    assert 1 <= len(result['alternatives']) <= 2
    for option in result['alternatives']:
        assert option['kind'] == 'alternative' and option['geometry']['coordinates'] not in shown
        assert option['risk_score'] <= result['routes'][0]['risk_score'] or option['duration_s'] < result['routes'][0]['duration_s']
