from copy import deepcopy
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
from uuid import uuid4

from fastapi.testclient import TestClient
from jsonschema import Draft202012Validator, FormatChecker
import pytest
import yaml
from app.main import create_app
from app import schemas

ROOT = Path(__file__).resolve().parents[2] / 'contracts'
SPEC = yaml.safe_load((ROOT/'openapi.yaml').read_text())

def fixture(name):
    return json.loads((ROOT/'fixtures'/name).read_text())

def validate(name, body):
    Draft202012Validator({'$ref':f'#/components/schemas/{name}','components':SPEC['components']},format_checker=FormatChecker()).validate(body)

@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv('AUTOMATION_PUBLISH_KEY', 'test-only-key')
    with TestClient(create_app('')) as client:
        yield client

def fresh():
    manual, automatic = fixture('manual-report.json'), fixture('automatic-hazard.json')
    now = datetime.now(timezone.utc)
    manual['observed_at'] = now.isoformat()
    automatic.update(first_seen=now.isoformat(),last_seen=now.isoformat(),expires_at=(now+timedelta(hours=24)).isoformat())
    return manual, automatic

AUTH = {'Authorization':'Bearer test-only-key'}
PUB = '/v1/automatic/hazards/d8271740-8fe9-4e23-818e-f78d28e0ed96'
FEED = '/v1/hazards?bbox=-84.40,33.74,-84.37,33.77'

def test_manual_without_automation_retry_conflict_expiry_routes(client):
    manual, _ = fresh()
    assert client.get('/healthz').json()['storage'] == 'memory'
    created = client.post('/v1/reports',json=manual)
    assert created.status_code == 201
    validate('ReportReceipt',created.json())
    retry = client.post('/v1/reports',json=manual)
    assert retry.status_code == 200 and retry.json()['duplicate']
    assert retry.json()['hazard_id'] == created.json()['hazard_id']
    assert client.post('/v1/reports',json=dict(manual,description='changed')).status_code == 409
    assert client.post('/v1/reports',json=fixture('cases/manual-expired.json')).status_code == 201
    feed = client.get(FEED).json()
    validate('HazardCollection',feed)
    assert len(feed['features']) == 1
    assert feed['features'][0]['properties']['source'] == 'manual'
    assert client.get('/v1/hazards?bbox=0,0,1,1').json()['features'] == []
    route = client.post('/v1/route',json=fixture('route-request.json'))
    assert route.status_code == 200 and 'fixed-route' in route.headers['X-Stage-0-Stub']
    validate('RouteResponse',route.json())

def test_publication_revisions_resolution_preserve_manual(client):
    manual, auto = fresh()
    manual_id = client.post('/v1/reports',json=manual).json()['hazard_id']
    assert client.put(PUB,json=auto).status_code == 401
    created = client.put(PUB,json=auto,headers=AUTH)
    assert created.status_code == 201
    validate('PublicationReceipt',created.json())
    assert created.json()['hazard_id'] != manual_id
    assert client.put(PUB,json=auto,headers=AUTH).json()['duplicate']
    assert client.put(PUB,json=dict(auto,score=0.99),headers=AUTH).status_code == 409
    update = dict(auto,revision=2,score=0.8)
    result = client.put(PUB,json=update,headers=AUTH)
    assert result.status_code == 200 and result.json()['hazard_id'] == created.json()['hazard_id']
    assert client.put(PUB,json=auto,headers=AUTH).status_code == 409
    feed = client.get(FEED).json()
    validate('HazardCollection',feed)
    assert {h['properties']['source'] for h in feed['features']} == {'manual','automatic'}
    assert client.put(PUB,json=dict(update,revision=3,status='resolved'),headers=AUTH).status_code == 200
    assert [h['properties']['id'] for h in client.get(FEED).json()['features']] == [manual_id]

def test_invalid_inputs_and_description_normalization(client):
    manual, auto = fresh()
    assert client.post('/v1/reports',json=dict(manual,lat=91)).status_code == 422
    assert client.post('/v1/reports',json=dict(manual,observed_at=(datetime.now(timezone.utc)+timedelta(hours=1)).isoformat())).status_code == 422
    assert client.post('/v1/reports',json=dict(manual,observed_at='2020-01-01T00:00:00')).status_code == 422
    manual.pop('description')
    assert client.post('/v1/reports',json=manual).status_code == 201
    assert client.post('/v1/reports',json=dict(manual,description='')).json()['duplicate']
    bad = deepcopy(auto)
    bad['geometry']['coordinates'][0][-1] = [-84.3,33.7]
    assert client.put(PUB,json=bad,headers=AUTH).status_code == 422
    assert client.put(PUB,json=dict(auto,expires_at='2020-01-01T00:00:00Z'),headers=AUTH).status_code == 422
    for bbox in ['nan,0,1,1','0,0,0,1','bad','1,2,3']:
        assert client.get('/v1/hazards',params={'bbox':bbox}).status_code == 422

def test_live_change(client):
    with client.websocket_connect('/v1/live') as socket:
        response = client.post('/v1/reports',json=fresh()[0])
        message = socket.receive_json()
        validate('HazardsChanged',message)
        assert message['data']['hazard_id'] == response.json()['hazard_id']

def test_model_contract_fields_and_fixtures():
    for name in ['Coordinate','ManualReport','Polygon','AutomaticPublication','ReportReceipt','PublicationReceipt','HazardProperties','HazardFeature','HazardCollection','LineString','RouteRequest','Route','AlternativeRoute','RouteResponse']:
        model = getattr(schemas,name)
        assert set(model.model_fields) == set(SPEC['components']['schemas'][name]['properties']), name
        assert {n for n,f in model.model_fields.items() if f.is_required()} == set(SPEC['components']['schemas'][name]['required']), name
    for name, file in [('ManualReport','manual-report.json'),('AutomaticPublication','automatic-hazard.json'),('HazardCollection','hazards.geojson'),('RouteResponse','route.json'),('RouteRequest','route-request.json')]:
        body = getattr(schemas,name).model_validate(fixture(file)).model_dump(mode='json')
        validate(name,body)

def test_request_schema_parity():
    import importlib.util
    module_spec = importlib.util.spec_from_file_location('parity', ROOT/'scripts/check_model_parity.py')
    module = importlib.util.module_from_spec(module_spec)
    module_spec.loader.exec_module(module)
    module.assert_request_parity(SPEC, {name:getattr(schemas,name) for name in ['ManualReport','AutomaticPublication','RouteRequest','HazardFeedback','PhotoAnalysisRequest','RouteExplanationRequest']})

def test_reports_anywhere_keep_feed_valid(client):
    for lat, lon in [(0, 120), (89.99, 0), (-45, -179.99999)]:
        manual = dict(fresh()[0], id=str(uuid4()), lat=lat, lon=lon)
        assert client.post('/v1/reports',json=manual).status_code in (201, 422)
    feed = client.get('/v1/hazards?bbox=-180,-90,180,90')
    assert feed.status_code == 200
    validate('HazardCollection',feed.json())
    assert len(feed.json()['features']) >= 2

def test_contract_checks_timestamp_format():
    _, auto = fresh()
    with pytest.raises(Exception):
        validate('AutomaticPublication',dict(auto,expires_at='tomorrow'))

@pytest.mark.parametrize('inactive_status', ['expired', 'resolved'])
def test_expiry_scan_preserves_publication_refreshed_during_notification(monkeypatch, inactive_status):
    """A stalled expiry notification must not let a stale scan delete a newer revision."""
    import asyncio
    import httpx
    from fastapi import WebSocketDisconnect

    monkeypatch.setenv('AUTOMATION_PUBLISH_KEY', 'test-only-key')

    async def scenario():
        app = create_app('')
        started, resume, scanned, connected, disconnect = (asyncio.Event() for _ in range(5))
        second_id = None

        class Socket:
            calls = 0
            second_messages = 0

            async def accept(self):
                connected.set()

            async def receive_text(self):
                await disconnect.wait()
                raise WebSocketDisconnect()

            async def send_json(self, message):
                self.calls += 1
                if self.calls == 1:
                    started.set()
                    await resume.wait()
                elif message['data']['hazard_id'] == second_id:
                    self.second_messages += 1
                    # For expired entries, a second message is the deferred expiry hint.
                    if self.second_messages == 2:
                        scanned.set()

            async def close(self):
                disconnect.set()

        now = datetime.now(timezone.utc)
        expired = dict(fixture('automatic-hazard.json'), first_seen=(now-timedelta(days=2)).isoformat(),
                       last_seen=(now-timedelta(days=2)).isoformat(), expires_at=(now-timedelta(days=1)).isoformat())
        second_url = f'/v1/automatic/hazards/{uuid4()}'
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
            assert (await client.put(f'/v1/automatic/hazards/{uuid4()}', json=expired, headers=AUTH)).status_code == 201
            second = expired if inactive_status == 'expired' else dict(expired, status='resolved', expires_at=(now+timedelta(days=1)).isoformat())
            response = await client.put(second_url, json=second, headers=AUTH)
            assert response.status_code == 201
            second_id = response.json()['hazard_id']
            live = next(route.endpoint for route in app.routes if route.path == '/v1/live')
            socket_task = asyncio.create_task(live(Socket()))
            await connected.wait()
            try:
                async with app.router.lifespan_context(app):
                    await asyncio.wait_for(started.wait(), 3)
                    active = dict(second, revision=2, status='active', expires_at=(now+timedelta(days=1)).isoformat())
                    assert (await client.put(second_url, json=active, headers=AUTH)).status_code == 200
                    resume.set()
                    if inactive_status == 'expired':
                        await asyncio.wait_for(scanned.wait(), 3)
                    else:
                        # One full subsequent maintenance tick ensures the suspended scan completed.
                        await asyncio.sleep(1.1)
                    response = await client.get(FEED)
                    validate('HazardCollection', response.json())
                    assert second_id in [h['properties']['id'] for h in response.json()['features']]
                    retry = await client.put(second_url, json=active, headers=AUTH)
                    assert retry.status_code == 200 and retry.json()['duplicate']
                    assert second_id in app.state.hazards
            finally:
                resume.set()
                disconnect.set()
                await socket_task

    asyncio.run(scenario())

def feedback_body(response='still_there'):
    return dict(fixture('feedback.json'), id=str(uuid4()), response=response)

def test_feedback_is_separate_idempotent_and_keeps_labels(client):
    manual, automatic = fresh()
    hazard_id = client.post('/v1/reports', json=manual).json()['hazard_id']
    automatic_id = client.put(PUB, json=automatic, headers=AUTH).json()['hazard_id']
    url = f'/v1/hazards/{hazard_id}/feedback'
    body = feedback_body()
    created = client.post(url, json=body)
    assert created.status_code == 201
    validate('FeedbackReceipt', created.json())
    assert created.json() == {'feedback_id': body['id'], 'hazard_id': hazard_id, 'duplicate': False}
    retry = client.post(url, json=body)
    assert retry.status_code == 200 and retry.json() == dict(created.json(), duplicate=True)
    assert client.post(url, json=dict(body, response='gone')).status_code == 409
    assert client.post(f'/v1/hazards/{automatic_id}/feedback', json=body).status_code == 409
    assert client.post(f'/v1/hazards/{uuid4()}/feedback', json=feedback_body()).status_code == 404
    assert client.post(url, json=fixture('cases/feedback-invalid.json')).status_code == 422
    expired_id = client.post('/v1/reports', json=fixture('cases/manual-expired.json')).json()['hazard_id']
    assert client.post(f'/v1/hazards/{expired_id}/feedback', json=feedback_body()).status_code == 404
    props = {f['properties']['id']: f['properties'] for f in client.get(FEED).json()['features']}
    assert props[hazard_id]['source'] == 'manual' and props[hazard_id]['report_count'] == 1
    assert props[automatic_id]['source'] == 'automatic' and props[automatic_id]['evidence_source'] == automatic['evidence_source']

def test_two_gone_answers_hide_an_automatic_hazard_until_a_newer_revision(client):
    _, automatic = fresh()
    automatic_id = client.put(PUB, json=automatic, headers=AUTH).json()['hazard_id']
    url = f'/v1/hazards/{automatic_id}/feedback'
    before = active_props(client, automatic_id)
    assert client.post(url, json=feedback_body('still_there')).status_code == 201
    assert client.post(url, json=feedback_body('gone')).status_code == 201
    assert active_props(client, automatic_id) == before, 'still_there never extends and one gone never hides'
    assert client.post(url, json=feedback_body('gone')).status_code == 201
    assert active_props(client, automatic_id) is None
    assert client.post(url, json=feedback_body('gone')).status_code == 404
    duplicate = client.put(PUB, json=automatic, headers=AUTH)
    assert duplicate.status_code == 200 and duplicate.json()['duplicate'] and active_props(client, automatic_id) is None
    update = client.put(PUB, json=dict(automatic, revision=2, label='Updated by publisher'), headers=AUTH)
    assert update.status_code == 200 and update.json()['revision'] == 2
    shown = active_props(client, automatic_id)
    assert shown['label'] == 'Updated by publisher' and shown['source'] == 'automatic'
    assert client.post(url, json=feedback_body('gone')).status_code == 201
    assert active_props(client, automatic_id) is not None, 'answers from an older revision do not count'

def manual_hazard(client, manual):
    hazard_id = client.post('/v1/reports', json=manual).json()['hazard_id']
    return hazard_id, f'/v1/hazards/{hazard_id}/feedback'

def active_props(client, hazard_id):
    return next((f['properties'] for f in client.get(FEED).json()['features'] if f['properties']['id'] == hazard_id), None)

def test_still_there_extends_a_manual_hazard_and_sends_a_live_hint(client):
    manual, _ = fresh()
    manual['observed_at'] = (datetime.now(timezone.utc) - timedelta(hours=20)).isoformat()
    hazard_id, url = manual_hazard(client, manual)
    before = active_props(client, hazard_id)['expires_at']
    with client.websocket_connect('/v1/live') as socket:
        assert client.post(url, json=feedback_body('still_there')).status_code == 201
        assert socket.receive_json() == {'type': 'hazards.changed', 'data': {'hazard_id': hazard_id}}
    after = active_props(client, hazard_id)
    assert datetime.fromisoformat(after['expires_at']) > datetime.fromisoformat(before) + timedelta(hours=19)
    assert after['source'] == 'manual' and after['report_count'] == 1

def test_two_gone_answers_remove_a_manual_hazard_but_still_there_in_between_resets(client):
    manual, _ = fresh()
    hazard_id, url = manual_hazard(client, manual)
    assert client.post(url, json=feedback_body('gone')).status_code == 201
    assert client.post(url, json=feedback_body('still_there')).status_code == 201
    assert client.post(url, json=feedback_body('gone')).status_code == 201
    assert active_props(client, hazard_id) is not None, 'a still_there answer resets the gone count'
    last = feedback_body('gone')
    assert client.post(url, json=last).status_code == 201
    assert active_props(client, hazard_id) is None
    assert client.post(url, json=last).json()['duplicate'] is True, 'a lost receipt can still be retried after removal'
    assert client.post(url, json=feedback_body('gone')).status_code == 404
