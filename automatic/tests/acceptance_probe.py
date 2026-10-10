"""D4 acceptance probe (run by hand against live processes; not collected by pytest).

PRODUCT_API_URL and OBSERVATION_API_URL point at running services. Posts one manual report, then
simulated brake events from two rides, waits for the automatic hazard to appear, and checks that the
manual hazard's public fields and ID are unchanged. HTTP only: no DB access.
"""
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import sys
import time
from urllib.request import Request, urlopen
from uuid import uuid4

PRODUCT = os.getenv('PRODUCT_API_URL', 'http://localhost:8000').rstrip('/')
OBSERVATION = os.getenv('OBSERVATION_API_URL', 'http://localhost:8001').rstrip('/')
ROOT = Path(__file__).resolve().parents[2] / 'contracts'
BBOX = '-84.40,33.74,-84.37,33.77'

def call(base, path, body=None):
    request = Request(base + path, json.dumps(body).encode() if body else None, {'Content-Type': 'application/json'})
    with urlopen(request, timeout=10) as response:
        return json.load(response)

def feed():
    return {f['properties']['id']: f['properties'] for f in call(PRODUCT, f'/v1/hazards?bbox={BBOX}')['features']}

now = datetime.now(timezone.utc)
manual = json.loads((ROOT/'fixtures/manual-report.json').read_text())
manual.update(id=str(uuid4()), observed_at=now.isoformat(), lat=33.7480, lon=-84.3800)
manual_id = call(PRODUCT, '/v1/reports', manual)['hazard_id']
before = feed()[manual_id]

template = json.loads((ROOT/'fixtures/events.json').read_text())['events'][0]
rides = [str(uuid4()), str(uuid4())]
lat0 = 33.7600 + (int(time.time()) % 1000) * 1e-5   # fresh spot per run so reruns create a new cluster
events = [dict(template, id=str(uuid4()), ride_id=rides[n % 2], type='hard_brake', source='simulated',
               ts=(now - timedelta(minutes=5)).isoformat(), lat=lat0 + n * 2e-5, lon=-84.3853) for n in range(4)]
print('ingest:', call(OBSERVATION, '/v1/events', {'events': events}))

deadline = time.time() + 30
automatic = {}
while time.time() < deadline and not automatic:
    time.sleep(1)
    automatic = {k: v for k, v in feed().items() if v['source'] == 'automatic' and 'Hard braking' in v['label']}
assert automatic, 'no automatic hazard appeared within 30 s'
after = feed()
props = next(iter(automatic.values()))
assert props['evidence_source'] == 'simulated' and props['kind'] == 'braking', props
assert after[manual_id] == before, ('manual hazard changed', before, after[manual_id])
print('PASS: automatic', props['id'], props['label'], 'score', props['score'], '| manual hazard unchanged:', manual_id)
sys.exit(0)
