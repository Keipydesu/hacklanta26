"""Manual release path: create, read back, exact retry, conflicting reuse. Automation is not involved."""
from datetime import timedelta

from .assertions import find_by_id, read_feed
from .clock import iso, minutes_before, parse_time
from .geo import bbox_around
from .identity import item_id
from .models import Scenario
from .transport import Run, ScenarioFailed


def generate_manual(run_id: str, scenario: Scenario, now) -> dict:
    """ID and observation time are generated once; every retry reuses this exact body."""
    report = scenario.get('report')
    return {
        'id': item_id(run_id, scenario.name, 'report'),
        'kind': report['kind'], 'lat': report['lat'], 'lon': report['lon'],
        'observed_at': iso(minutes_before(now, report.get('age_minutes', 0))),
        'description': report['description'],
    }


def planned(run_id: str, scenario: Scenario, now) -> list[dict]:
    body = generate_manual(run_id, scenario, now)
    conflict = {**body, 'description': body['description'] + ' (conflicting reuse probe)'}
    return [
        {'key': 'report', 'method': 'POST', 'target': 'product', 'path': '/v1/reports', 'body': body, 'expect': [201]},
        {'key': 'report-retry', 'method': 'POST', 'target': 'product', 'path': '/v1/reports', 'body': body, 'expect': [200]},
        {'key': 'report-conflict', 'method': 'POST', 'target': 'product', 'path': '/v1/reports', 'body': conflict, 'expect': [409]},
    ]


def run_manual(run: Run, scenario: Scenario, now) -> dict:
    create, retry, conflict = planned(run.manifest.run_id, scenario, now)
    body = create['body']
    bbox = bbox_around([(body['lat'], body['lon'])])
    # A resumed run may already have created the report; then the first answer is the duplicate.
    first = run.send('report', 'POST', 'product', '/v1/reports', body, expect=(201, 200), step='create')
    receipt = first.body
    again = run.send('report-retry', 'POST', 'product', '/v1/reports', body, expect=(200,), step='identical-retry').body
    if not again.get('duplicate') or again.get('hazard_id') != receipt.get('hazard_id') or again.get('report_id') != body['id']:
        raise ScenarioFailed(f'{scenario.name}: identical retry did not return the original IDs: {again}')
    run.send('report-conflict', 'POST', 'product', '/v1/reports', conflict['body'], expect=(409,), step='conflicting-reuse')

    features = read_feed(run, bbox)
    hazard = find_by_id(features, receipt['hazard_id'])
    expect_active = scenario.get('expect_active', True)
    if not expect_active:
        ok = hazard is None
        run.evidence('expired-report-not-active', ok, hazard_id=receipt['hazard_id'], note='accepted and retryable, but outside the 24 hour window so absent from active reads')
        if not ok:
            raise ScenarioFailed(f'{scenario.name}: an already-expired report appeared in the active feed')
        return {'receipt': receipt, 'hazard': None}
    if hazard is None:
        run.evidence('read-back', False, hazard_id=receipt['hazard_id'])
        raise ScenarioFailed(f'{scenario.name}: accepted report {receipt["hazard_id"]} is not in the hazard feed')
    props = hazard['properties']
    expires = parse_time(body['observed_at']) + timedelta(hours=24)
    checks = {
        'source is manual': props.get('source') == 'manual',
        'report_count is 1': props.get('report_count') == 1,
        'no sensor counts': props.get('event_count') == 0 and props.get('ride_count') == 0,
        'no evidence source': props.get('evidence_source') is None,
        'expires 24 h after observation': abs((parse_time(props['expires_at']) - expires).total_seconds()) < 1,
        'kind preserved': props.get('kind') == body['kind'],
    }
    mine = [f for f in features if f['properties']['id'] == receipt['hazard_id']]
    checks['exactly one hazard for this report'] = len(mine) == 1
    failed = [name for name, passed in checks.items() if not passed]
    run.evidence('read-back', not failed, hazard_id=receipt['hazard_id'], failed=failed, properties=props)
    if failed:
        raise ScenarioFailed(f'{scenario.name}: manual hazard checks failed: {", ".join(failed)}')
    return {'receipt': receipt, 'hazard': hazard}
