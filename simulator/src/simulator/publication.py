"""HTTP bridge before detection: publish, retry, update, stale probe, resolve — and leave manual data alone."""
from datetime import timedelta

from .assertions import find_by_id, read_feed
from .clock import iso
from .geo import bbox_around, square
from .identity import item_id
from .models import Scenario
from .transport import Run, ScenarioFailed

STOP_POINTS = ('create', 'update', 'resolve')


def generate_publication(scenario: Scenario, now, revision: int = 1, score: float | None = None, status: str = 'active') -> dict:
    """A complete body every time: resolution is a full higher revision, never a partial patch."""
    hazard = scenario.get('hazard')
    return {
        'revision': revision, 'kind': hazard['kind'],
        'geometry': {'type': 'Polygon', 'coordinates': square(hazard['lat'], hazard['lon'], hazard.get('half_size_m', 10))},
        'score': hazard['score'] if score is None else score,
        'event_count': hazard.get('event_count', 8), 'ride_count': hazard.get('ride_count', 4),
        'first_seen': iso(now - timedelta(minutes=30)), 'last_seen': iso(now), 'expires_at': iso(now + timedelta(hours=24)),
        'status': status, 'label': hazard['label'], 'evidence_source': hazard['evidence_source'],
    }


def planned(run_id: str, scenario: Scenario, now) -> list[dict]:
    external = item_id(run_id, scenario.name, 'external-hazard')
    path = f'/v1/automatic/hazards/{external}'
    hazard = scenario.get('hazard')
    one = generate_publication(scenario, now)
    two = generate_publication(scenario, now, revision=2, score=hazard['updated_score'])
    three = generate_publication(scenario, now, revision=3, score=hazard['updated_score'], status='resolved')
    control = scenario.get('control_report')
    report = {'id': item_id(run_id, scenario.name, 'control-report'), 'kind': control.get('kind', 'other'), 'lat': control['lat'], 'lon': control['lon'],
              'observed_at': iso(now), 'description': control.get('description', 'DEMO: manual control report')}
    return [
        {'key': 'control-report', 'method': 'POST', 'target': 'product', 'path': '/v1/reports', 'body': report, 'expect': [201, 200]},
        {'key': 'no-credential', 'method': 'PUT', 'target': 'product', 'path': path, 'body': one, 'expect': [401]},
        {'key': 'bad-credential', 'method': 'PUT', 'target': 'product', 'path': path, 'body': one, 'expect': [401]},
        {'key': 'revision-1', 'method': 'PUT', 'target': 'product', 'path': path, 'body': one, 'expect': [201, 200], 'auth': True},
        {'key': 'revision-1-retry', 'method': 'PUT', 'target': 'product', 'path': path, 'body': one, 'expect': [200], 'auth': True},
        {'key': 'revision-2', 'method': 'PUT', 'target': 'product', 'path': path, 'body': two, 'expect': [200], 'auth': True},
        {'key': 'revision-1-stale', 'method': 'PUT', 'target': 'product', 'path': path, 'body': one, 'expect': [409], 'auth': True},
        {'key': 'revision-3-resolved', 'method': 'PUT', 'target': 'product', 'path': path, 'body': three, 'expect': [200], 'auth': True},
    ]


def run_publication_lifecycle(run: Run, scenario: Scenario, now, stop_after: str = 'resolve') -> dict:
    steps = {step['key']: step for step in planned(run.manifest.run_id, scenario, now)}
    hazard = scenario.get('hazard')
    control = steps['control-report']['body']
    bbox = bbox_around([(hazard['lat'], hazard['lon']), (control['lat'], control['lon'])])

    def put(key: str, expect, auth=True, step=None):
        entry = steps[key]
        return run.send(key, 'PUT', 'product', entry['path'], entry['body'], expect=expect, auth=auth, step=step or key, skip_done=True)

    control_receipt = run.send('control-report', 'POST', 'product', '/v1/reports', control, expect=(201, 200), step='manual-control').body
    before = find_by_id(read_feed(run, bbox), control_receipt['hazard_id'])
    if before is None:
        raise ScenarioFailed(f'{scenario.name}: manual control hazard is not in the feed')

    # Credential probes come first: neither may create anything.
    run.send('no-credential', 'PUT', 'product', steps['no-credential']['path'], steps['no-credential']['body'], expect=(401,), auth=False, step='missing-credential')
    run.send('bad-credential', 'PUT', 'product', steps['no-credential']['path'], steps['no-credential']['body'], expect=(401,), auth='not-the-publisher-key', step='invalid-credential')

    created = put('revision-1', (201, 200), step='create').body
    public_id = created['hazard_id']
    retried = put('revision-1-retry', (200,), step='identical-retry').body
    _same_id(scenario, 'identical retry', retried, public_id)
    if not retried.get('duplicate'):
        raise ScenarioFailed(f'{scenario.name}: identical retry was not reported as a duplicate')
    visible = find_by_id(read_feed(run, bbox), public_id)
    labels_ok = visible is not None and visible['properties'].get('source') == 'automatic' and visible['properties'].get('evidence_source') == hazard['evidence_source'] \
        and visible['properties'].get('report_count') == 0
    run.evidence('published-visible', labels_ok, hazard_id=public_id, properties=visible and visible['properties'])
    if not labels_ok:
        raise ScenarioFailed(f'{scenario.name}: published hazard missing or mislabeled in the feed')
    if stop_after == 'create':
        return _finish(run, scenario, bbox, control_receipt, before, public_id, resolved=False)

    _same_id(scenario, 'update', put('revision-2', (200,), step='update').body, public_id)
    put('revision-1-stale', (409,), step='stale-revision-rejected')
    updated = find_by_id(read_feed(run, bbox), public_id)
    score_ok = updated is not None and abs(updated['properties']['score'] - hazard['updated_score']) < 1e-9
    run.evidence('update-visible', score_ok, hazard_id=public_id, score=updated and updated['properties']['score'])
    if not score_ok:
        raise ScenarioFailed(f'{scenario.name}: revision 2 is not what the feed shows (a stale revision may have overwritten it)')
    if stop_after == 'update':
        return _finish(run, scenario, bbox, control_receipt, before, public_id, resolved=False)

    _same_id(scenario, 'resolve', put('revision-3-resolved', (200,), step='resolve').body, public_id)
    return _finish(run, scenario, bbox, control_receipt, before, public_id, resolved=True)


def _same_id(scenario: Scenario, step: str, receipt: dict, public_id: str) -> None:
    if receipt.get('hazard_id') != public_id:
        raise ScenarioFailed(f'{scenario.name}: public hazard ID changed at {step}: {receipt.get("hazard_id")} != {public_id}')


def _finish(run: Run, scenario: Scenario, bbox: str, control_receipt: dict, before: dict, public_id: str, resolved: bool) -> dict:
    features = read_feed(run, bbox)
    present = find_by_id(features, public_id) is not None
    run.evidence('resolved-leaves-feed' if resolved else 'left-visible', present != resolved, hazard_id=public_id, in_feed=present)
    if present == resolved:
        raise ScenarioFailed(f'{scenario.name}: automatic hazard {"still" if resolved else "not"} in the active feed')
    after = find_by_id(features, control_receipt['hazard_id'])
    preserved = after is not None and after['properties'] == before['properties'] and after['geometry'] == before['geometry']
    run.evidence('manual-preserved', preserved, hazard_id=control_receipt['hazard_id'])
    if not preserved:
        raise ScenarioFailed(f'{scenario.name}: the manual control hazard changed during automatic publication')
    return {'public_id': public_id, 'control_hazard_id': control_receipt['hazard_id'], 'resolved': resolved}
