"""Standalone HTTP publication probe. Uses only Python's standard library."""
import argparse
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

FIXTURE = Path(__file__).resolve().parents[1] / 'fixtures/automatic-hazard.json'

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', default=os.getenv('PRODUCT_API_URL', 'http://localhost:8000'))
    parser.add_argument('--id', default='d8271740-8fe9-4e23-818e-f78d28e0ed96')
    parser.add_argument('--lifecycle', action='store_true', help='Also retry, update, reject stale revision, and resolve.')
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()
    body = json.loads(FIXTURE.read_text())
    # Hold all timestamps fixed for the full sequence so retries are identical.
    now = datetime.now(timezone.utc).replace(microsecond=0)
    body.update(first_seen=(now-timedelta(minutes=10)).isoformat(), last_seen=now.isoformat(), expires_at=(now+timedelta(hours=24)).isoformat())
    if args.dry_run:
        print(json.dumps(body, indent=2))
        return
    key = os.environ.get('AUTOMATION_PUBLISH_KEY')
    if not key:
        parser.error('Set server-side AUTOMATION_PUBLISH_KEY (never an Expo public variable).')
    url = args.url.rstrip('/') + '/v1/automatic/hazards/' + args.id
    def send(payload, expected):
        request = Request(url, data=json.dumps(payload).encode(), method='PUT', headers={'Content-Type':'application/json','Authorization':f'Bearer {key}'})
        try:
            with urlopen(request, timeout=10) as response:
                status, result = response.status, json.load(response)
        except HTTPError as error:
            status, result = error.code, json.load(error)
        assert status == expected, f'Expected {expected}, received {status}: {result}'
        print(json.dumps({'status':status,'response':result}))
        return result
    original = send(body, 201)
    if args.lifecycle:
        retry = send(body, 200)
        assert retry['duplicate'] and retry['hazard_id'] == original['hazard_id']
        changed = deepcopy(body)
        changed.update(revision=2, score=0.8)
        assert send(changed, 200)['hazard_id'] == original['hazard_id']
        send(body, 409)
        changed.update(revision=3, status='resolved')
        assert send(changed, 200)['hazard_id'] == original['hazard_id']

if __name__ == '__main__':
    main()
