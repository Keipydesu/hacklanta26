from copy import deepcopy
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
from uuid import uuid4
from fastapi.testclient import TestClient
from app.main import create_app
from app import schemas
import yaml

ROOT = Path(__file__).resolve().parents[2]/'contracts'
def fixture(name): return json.loads((ROOT/'fixtures'/name).read_text())

def test_atomic_events_retry_conflict_and_limits():
    app = create_app()
    with TestClient(app) as client:
        body = fixture('events.json')
        assert client.post('/v1/events',json=body).json() == {'accepted':1,'duplicates':0}
        assert client.post('/v1/events',json=body).json() == {'accepted':0,'duplicates':1}
        new = dict(body['events'][0],id=str(uuid4()))
        conflict = dict(body['events'][0],peak_g=0.99)
        assert client.post('/v1/events',json={'events':[new,conflict]}).status_code == 409
        assert len(app.state.events) == 1
        assert client.post('/v1/events',json={'events':[new,dict(new,peak_g=0.1)]}).status_code == 409
        assert len(app.state.events) == 1
        assert client.post('/v1/events',json={'events':[]}).json() == {'accepted':0,'duplicates':0}
        assert client.post('/v1/events',json={'events':body['events']*501}).status_code == 422
        invalid = dict(new,ts=(datetime.now(timezone.utc)+timedelta(hours=1)).isoformat())
        assert client.post('/v1/events',json={'events':[invalid]}).status_code == 422

def test_points_ride_identity():
    with TestClient(create_app()) as client:
        path = '/v1/rides/e50b27da-d972-430e-b5f8-9c6b20fd4151/points'
        body = fixture('points.json')
        assert client.post(path,json=body).json() == {'accepted':1,'duplicates':0}
        assert client.post(path,json=body).json() == {'accepted':0,'duplicates':1}
        assert client.post(f'/v1/rides/{uuid4()}/points',json=body).status_code == 409
        assert client.post(path,json={'points':body['points']*2001}).status_code == 422
        assert client.get('/healthz').json()['storage'] == 'memory'

def test_contract_fields():
    spec = yaml.safe_load((ROOT/'automatic.openapi.yaml').read_text())
    for name in ['ObservationEvent','ObservationPoint','EventBatch','PointBatch','IngestReceipt']:
        model = getattr(schemas,name)
        assert set(model.model_fields) == set(spec['components']['schemas'][name]['properties'])
        assert {n for n,f in model.model_fields.items() if f.is_required()} == set(spec['components']['schemas'][name]['required'])

def test_request_schema_parity():
    import importlib.util
    module_spec = importlib.util.spec_from_file_location('parity', ROOT/'scripts/check_model_parity.py')
    module = importlib.util.module_from_spec(module_spec)
    module_spec.loader.exec_module(module)
    spec = yaml.safe_load((ROOT/'automatic.openapi.yaml').read_text())
    module.assert_request_parity(spec, {name:getattr(schemas,name) for name in ['EventBatch','PointBatch']})
