"""Checks against the public aggregate feed and route endpoint. Ingestion alone proves nothing."""
import time

from .geo import distance_m, ring_center
from .transport import Run, ScenarioFailed


def matches(feature: dict, expectation: dict) -> bool:
    props = feature['properties']
    if props.get('kind') != expectation['kind']:
        return False
    if 'source' in expectation and props.get('source') != expectation['source']:
        return False
    if 'evidence_source' in expectation and props.get('evidence_source') != expectation['evidence_source']:
        return False
    if props.get('score', 0) < expectation.get('min_score', 0):
        return False
    lat, lon = ring_center(feature['geometry']['coordinates'][0])
    return distance_m(lat, lon, expectation['near']['lat'], expectation['near']['lon']) <= expectation.get('within_m', 30)


def read_feed(run: Run, bbox: str) -> list[dict]:
    reply = run.get('product', f'/v1/hazards?bbox={bbox}')
    if reply.status != 200 or not isinstance(reply.body, dict):
        raise ScenarioFailed(f'{run.manifest.scenario}: hazard feed returned {reply.status}')
    return reply.body.get('features', [])


def find_by_id(features: list[dict], hazard_id: str) -> dict | None:
    return next((f for f in features if f['properties'].get('id') == hazard_id), None)


def await_hazards(run: Run, bbox: str, expectations: list[dict], deadline_s: float, poll_s: float = 2.0,
                  clock=time.monotonic, sleep=time.sleep) -> list[dict]:
    """Poll the feed until every expectation is met by a distinct hazard, or the deadline passes."""
    started = clock()
    while True:
        features = read_feed(run, bbox)
        used, found, missing = set(), [], []
        for expectation in expectations:
            hit = next((f for f in features if f['properties']['id'] not in used and matches(f, expectation)), None)
            if hit:
                used.add(hit['properties']['id'])
                found.append(hit)
            else:
                missing.append(expectation)
        if not missing:
            run.evidence('await-hazards', True, hazards=[_summary(f) for f in found], waited_s=round(clock() - started, 1))
            return found
        if clock() - started >= deadline_s:
            run.evidence('await-hazards', False, missing=missing, last_feed=[_summary(f) for f in features], waited_s=round(clock() - started, 1))
            raise ScenarioFailed(f'{run.manifest.scenario}: {len(missing)} expected hazard(s) not published within {deadline_s:.0f} s')
        sleep(poll_s)


def assert_absent(run: Run, bbox: str, expectations: list[dict], step: str = 'assert-absent') -> None:
    features = read_feed(run, bbox)
    present = [_summary(f) for f in features for e in expectations if matches(f, e)]
    run.evidence(step, not present, unexpected=present)
    if present:
        raise ScenarioFailed(f'{run.manifest.scenario}: {len(present)} hazard(s) present that must not be')


def compare_routes(run: Run, origin: dict, destination: dict) -> dict:
    """Shape and honesty checks only. A fixed stub response is reported as such, not as routing."""
    reply = run.send('route', 'POST', 'product', '/v1/route', {'origin': origin, 'destination': destination}, expect=(200, 503), step='compare-routes')
    if reply.status == 503:
        run.evidence('routes', True, available=False, note='routing unavailable (503); reporting and reads are unaffected')
        return {'available': False}
    body = reply.body
    kinds = [route.get('kind') for route in body.get('routes', [])]
    problems = []
    if sorted(kinds) != ['safest', 'shortest']:
        problems.append(f'expected one shortest and one safest route, got {kinds}')
    for route in body.get('routes', []):
        if min(route.get('distance_m', -1), route.get('duration_s', -1), route.get('risk_score', -1)) < 0:
            problems.append(f'{route.get("kind")} has a negative or missing metric')
        if route.get('geometry', {}).get('type') != 'LineString' or len(route.get('geometry', {}).get('coordinates', [])) < 2:
            problems.append(f'{route.get("kind")} geometry is not a LineString')
    by_kind = {route['kind']: route for route in body.get('routes', []) if 'kind' in route}
    if not problems and not body.get('safest_available') and by_kind['shortest']['geometry'] != by_kind['safest']['geometry']:
        problems.append('safest_available is false but the two geometries differ')
    stub = 'x-stage-0-stub' in reply.headers
    summary = {
        'available': True, 'stub': stub, 'safest_available': body.get('safest_available'),
        'routes': {k: {'distance_m': r['distance_m'], 'risk_score': r['risk_score'], 'hazard_ids': r.get('hazard_ids', [])} for k, r in by_kind.items()},
    }
    if stub:
        summary['note'] = 'server answered with its fixed example route; this does not demonstrate hazard-aware routing'
    run.evidence('routes', not problems, problems=problems, **summary)
    if problems:
        raise ScenarioFailed(f'{run.manifest.scenario}: route response invalid: {"; ".join(problems)}')
    return summary


def _summary(feature: dict) -> dict:
    props = feature['properties']
    lat, lon = ring_center(feature['geometry']['coordinates'][0])
    return {key: props.get(key) for key in ('id', 'source', 'kind', 'evidence_source', 'score', 'event_count', 'ride_count', 'report_count', 'expires_at')} | {'lat': round(lat, 6), 'lon': round(lon, 6)}
