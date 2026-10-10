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
    with TestClient(create_app()) as client:
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
    for name in ['Coordinate','ManualReport','Polygon','AutomaticPublication','ReportReceipt','PublicationReceipt','HazardProperties','HazardFeature','HazardCollection','LineString','RouteRequest','Route','RouteResponse']:
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
    module.assert_request_parity(SPEC, {name:getattr(schemas,name) for name in ['ManualReport','AutomaticPublication','RouteRequest']})
