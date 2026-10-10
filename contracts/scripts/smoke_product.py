"""Run against a dedicated stage 0/demo API; creates one labeled manual report."""
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import subprocess
import sys
from urllib.request import Request, urlopen
from uuid import uuid4

base = os.getenv('PRODUCT_API_URL','http://localhost:8000').rstrip('/')
root = Path(__file__).resolve().parents[1]
def call(path, body=None):
    req = Request(base+path, data=json.dumps(body).encode() if body else None,
                  headers={'Content-Type':'application/json'})
    with urlopen(req, timeout=10) as response:
        return response.status, json.load(response)
assert call('/healthz')[1]['storage'] == 'memory'
manual = json.loads((root/'fixtures/manual-report.json').read_text())
manual.update(id=str(uuid4()),observed_at=datetime.now(timezone.utc).isoformat())
status, receipt = call('/v1/reports',manual)
assert status == 201
status, retry = call('/v1/reports',manual)
assert status == 200 and retry['duplicate'] and retry['hazard_id'] == receipt['hazard_id']
subprocess.run([sys.executable,str(root/'scripts/publish_fixture.py'),'--url',base,'--id',str(uuid4()),'--lifecycle'],check=True)
feed = call('/v1/hazards?bbox=-84.40,33.74,-84.37,33.77')[1]
assert any(h['properties']['id'] == receipt['hazard_id'] and h['properties']['source'] == 'manual' for h in feed['features'])
assert call('/v1/route',json.loads((root/'fixtures/route-request.json').read_text()))[0] == 200
print('PASS: live product health, manual retry, publication lifecycle, manual preservation, fixed route response.')
