"""Durable ingestion, worker and outbox. Needs a disposable PostGIS DB: TEST_AUTOMATION_DATABASE_URL (tables are dropped)."""
import asyncio
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
from uuid import uuid4

import httpx
import psycopg
import pytest

from app import db, outbox, worker
from app.main import create_app

URL = os.getenv('TEST_AUTOMATION_DATABASE_URL')
pytestmark = pytest.mark.skipif(not URL, reason='TEST_AUTOMATION_DATABASE_URL not set')
ROOT = Path(__file__).resolve().parents[2] / 'contracts'
BASE = json.loads((ROOT/'fixtures/events.json').read_text())['events'][0]
NOW = datetime.now(timezone.utc).replace(microsecond=0)

@pytest.fixture(autouse=True)
def clean():
    with psycopg.connect(URL, autocommit=True) as conn:
        conn.execute('DROP TABLE IF EXISTS outbox, derived_hazards, worker_state, points, events, schema_migrations CASCADE')
    db.migrate(URL)

def event(n=0, ride=None, ts=None, type='hard_brake', dlat=0.0, dlon=0.0, source='simulated'):
    return dict(BASE, id=str(uuid4()), ride_id=str(ride or uuid4()), type=type, source=source,
                ts=(ts or NOW - timedelta(hours=1)).isoformat(), lat=33.7531 + dlat + n * 2e-5, lon=-84.3853 + dlon)

def cluster(rides=2, count=4, **kw):
    ids = [uuid4() for _ in range(rides)]
    return [event(n, ride=ids[n % rides], **kw) for n in range(count)]

def sql(query, *args):
    with psycopg.connect(URL) as conn:
        return conn.execute(query, args).fetchall()

def with_pool(scenario):
    async def go():
        pool = db.make_pool(URL)
        await pool.open(wait=True)
        try:
            return await scenario(pool)
        finally:
            await pool.close()
    return asyncio.run(go())

def run_app(scenario):
    async def go():
        app = create_app(URL)
        async with app.router.lifespan_context(app):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://t') as client:
                return await scenario(client, app)
    return asyncio.run(go())

# ---- ingestion -------------------------------------------------------------------------------

def test_events_persist_retry_conflict_atomicity_and_dirty_marker():
    batch = cluster(count=2)
    async def first(client, app):
        assert (await client.post('/v1/events', json={'events': batch})).json() == {'accepted': 2, 'duplicates': 0}
        assert (await client.get('/healthz')).json()['storage'] == 'postgis'
    run_app(first)
    assert sql('SELECT dirty_seq FROM worker_state') == [(1,)]
    async def after_restart(client, app):
        assert (await client.post('/v1/events', json={'events': batch})).json() == {'accepted': 0, 'duplicates': 2}
        new = event()
        bad = dict(batch[0], peak_g=0.99)
        assert (await client.post('/v1/events', json={'events': [new, bad]})).status_code == 409
        assert (await client.post('/v1/events', json={'events': [new, dict(new, peak_g=0.1)]})).status_code == 409
    run_app(after_restart)
    assert sql('SELECT count(*) FROM events') == [(2,)]
    assert sql('SELECT dirty_seq FROM worker_state') == [(1,)]  # duplicates/conflicts never mark dirty

def test_points_identity_includes_ride_and_concurrent_identical_batches():
    ride, point = uuid4(), json.loads((ROOT/'fixtures/points.json').read_text())['points'][0]
    async def scenario(client, app):
        path = f'/v1/rides/{ride}/points'
        results = await asyncio.gather(*(client.post(path, json={'points': [point]}) for _ in range(6)))
        assert sorted(r.json()['accepted'] for r in results) == [0] * 5 + [1]
        assert (await client.post(f'/v1/rides/{uuid4()}/points', json={'points': [point]})).status_code == 409
    run_app(scenario)
    assert sql('SELECT count(*) FROM points') == [(1,)]

# ---- worker ----------------------------------------------------------------------------------

def seed(events):
    async def go(client, app):
        assert (await client.post('/v1/events', json={'events': events})).status_code == 200
    run_app(go)

def evaluate(now=NOW):
    return with_pool(lambda pool: worker.evaluate(pool, now))

def outbox_rows():
    return sql('SELECT external_id, revision, body->>\'status\', body->>\'score\' FROM outbox ORDER BY created_at, revision')

def test_cluster_requires_two_rides_and_three_events():
    seed(cluster(rides=1, count=5, type='bump'))      # one ride only
    seed(cluster(rides=2, count=2, dlat=0.01))        # too few events
    assert evaluate() == 0 and outbox_rows() == []

def test_publishes_valid_body_once_and_is_idempotent_at_same_time():
    seed(cluster(rides=2, count=4))
    assert evaluate() == 1
    [(external_id, revision, status, score)] = outbox_rows()
    assert revision == 1 and status == 'active' and float(score) == pytest.approx(round(4 * 0.5 ** (1 / 24 / 7) / 5, 3), abs=1e-3)
    body = sql('SELECT body FROM outbox')[0][0]
    assert body['kind'] == 'braking' and body['evidence_source'] == 'simulated' and body['label'] == 'Hard braking, 4 events'
    assert body['event_count'] == 4 and body['ride_count'] == 2 and body['geometry']['type'] == 'Polygon'
    assert evaluate() == 0 and evaluate(NOW + timedelta(minutes=10)) == 0  # unchanged evidence: no new revision
    assert sql('SELECT evaluated_seq = dirty_seq FROM worker_state') == [(True,)]

def test_new_evidence_keeps_identity_and_bumps_revision_and_separate_clusters_stay_separate():
    first = cluster(rides=2, count=3)
    seed(first)
    seed(cluster(rides=2, count=3, dlat=0.01, type='bump'))  # different kind and place
    assert evaluate() == 2
    ids = {row[0] for row in outbox_rows()}
    seed([event(5, ride=first[0]['ride_id'])])               # extends the braking cluster
    assert evaluate() == 1
    rows = outbox_rows()
    assert {row[0] for row in rows} == ids and sorted(r[1] for r in rows) == [1, 1, 2]

def test_mixed_evidence_and_refresh_margin_and_resolution_on_decay():
    seed(cluster(rides=2, count=3) + [event(7, source='device')])
    assert evaluate() == 1
    assert sql("SELECT body->>'evidence_source' FROM outbox") == [('mixed',)]
    assert evaluate(NOW + timedelta(hours=1)) == 0            # score moved < 0.02 and expiry is far: no republish
    assert evaluate(NOW + timedelta(hours=19)) == 1           # expiry now within the 6 h margin: refresh, same identity
    assert sql('SELECT count(DISTINCT external_id), max(revision) FROM outbox') == [(1, 2)]
    # Decay: 60 days later nothing qualifies, so the hazard resolves with a complete higher-revision body.
    assert evaluate(NOW + timedelta(days=60)) == 1
    last = sql("SELECT revision, body->>'status', body->>'label' FROM outbox ORDER BY revision DESC LIMIT 1")[0]
    assert last[1] == 'resolved' and last[2].startswith('Hard braking')
    assert evaluate(NOW + timedelta(days=61)) == 0

def test_future_timestamps_never_exceed_fresh_weight():
    assert worker.score_events([NOW + timedelta(minutes=4)], NOW) == pytest.approx(0.2)
    assert worker.score_events([NOW] * 10, NOW) == 1.0

def test_restart_evaluates_committed_but_unevaluated_work():
    seed(cluster())
    assert sql('SELECT dirty_seq > evaluated_seq FROM worker_state') == [(True,)]  # lost wake: nothing evaluated yet
    assert evaluate() == 1

def test_second_evaluator_is_excluded_by_advisory_lock():
    seed(cluster())
    async def scenario(pool):
        async with pool.connection() as holder, holder.transaction():
            await holder.execute('SELECT pg_advisory_xact_lock(%s)', (worker.LOCK_KEY,))
            return await worker.evaluate(pool, NOW)
    assert with_pool(scenario) is None and outbox_rows() == []

# ---- outbox ----------------------------------------------------------------------------------

class Product:
    """Product API double: records PUTs and replies per a script of status codes."""
    def __init__(self, *statuses):
        self.statuses, self.calls = list(statuses), []
        self.client = httpx.AsyncClient(transport=httpx.MockTransport(self.handle))
    def handle(self, request):
        body = json.loads(request.content)
        self.calls.append((request.url.path.rsplit('/', 1)[-1], body['revision'], dict(request.headers)))
        status = self.statuses.pop(0) if self.statuses else 200
        if status == 'timeout':
            raise httpx.ReadTimeout('slow')
        if status != 200:
            return httpx.Response(status, json={'detail': 'x'})
        return httpx.Response(200, json={'hazard_id': str(uuid4()) if False else '00000000-0000-4000-8000-000000000001', 'revision': body['revision'], 'duplicate': False})

def deliver(product, now=NOW, limit=10):
    return with_pool(lambda pool: outbox.deliver_due(pool, product.client, 'http://product.test', 'secret-key', now, limit))

def states():
    return [row for row in sql('SELECT revision, state, attempts FROM outbox ORDER BY revision')]

def test_delivery_acks_and_sends_persisted_body_with_bearer_credential():
    seed(cluster())
    evaluate()
    product = Product()
    assert deliver(product) == {'delivered': 1, 'retry': 0, 'blocked': 0}
    assert product.calls[0][2]['authorization'] == 'Bearer secret-key'
    assert states() == [(1, 'delivered', 1)]
    assert sql('SELECT product_hazard_id FROM derived_hazards')[0][0] is not None
    assert 'secret-key' not in json.dumps(sql('SELECT body FROM outbox')[0][0])
    assert deliver(Product()) == {'delivered': 0, 'retry': 0, 'blocked': 0}

def test_transient_failure_retries_with_backoff_same_body_then_succeeds_after_lost_ack():
    seed(cluster())
    evaluate()
    body = sql('SELECT body FROM outbox')[0][0]
    product = Product(503, 'timeout')
    assert deliver(product)['retry'] == 1
    assert states() == [(1, 'pending', 1)] and deliver(product) == {'delivered': 0, 'retry': 0, 'blocked': 0}  # not due yet
    later = NOW + timedelta(minutes=10)
    assert deliver(product, later)['retry'] == 1
    assert deliver(product, later + timedelta(minutes=10))['delivered'] == 1
    assert sql('SELECT body FROM outbox')[0][0] == body and states() == [(1, 'delivered', 3)]

def test_revisions_deliver_in_order_and_blocked_predecessor_holds_successor():
    first = cluster()
    seed(first)
    evaluate()
    seed([event(6, ride=first[0]['ride_id'])])
    evaluate()
    assert states() == [(1, 'pending', 0), (2, 'pending', 0)]
    product = Product(409)
    assert deliver(product)['blocked'] == 1
    assert [c[1] for c in product.calls] == [1] and states()[1] == (2, 'pending', 0)  # revision 2 not attempted
    assert deliver(Product(), NOW + timedelta(hours=1)) == {'delivered': 0, 'retry': 0, 'blocked': 0}
    external_id = sql('SELECT external_id FROM outbox LIMIT 1')[0][0]
    assert with_pool(lambda pool: outbox.release_blocked(pool, external_id)) == 1
    ok = Product()
    assert deliver(ok, NOW + timedelta(hours=1))['delivered'] == 1     # revision 1 first,
    assert deliver(ok, NOW + timedelta(hours=1))['delivered'] == 1     # then revision 2
    assert [c[1] for c in ok.calls] == [1, 2]

@pytest.mark.parametrize('status', [401, 422])
def test_credential_and_payload_failures_block_without_retry_loop(status):
    seed(cluster())
    evaluate()
    assert deliver(Product(status))['blocked'] == 1
    assert states() == [(1, 'blocked', 1)]
    assert sql('SELECT last_error FROM outbox') == [(f'HTTP {status}',)]

def test_expired_lease_is_reclaimed_after_a_crash_mid_send():
    seed(cluster())
    evaluate()
    with_pool(lambda pool: outbox.claim_due(pool, NOW))            # claimed, then the process "crashes"
    assert states() == [(1, 'sending', 1)]
    assert deliver(Product(), NOW + timedelta(seconds=30)) == {'delivered': 0, 'retry': 0, 'blocked': 0}
    assert deliver(Product(), NOW + timedelta(minutes=5))['delivered'] == 1

def test_product_outage_does_not_stop_ingestion_and_health_reports_backlog():
    seed(cluster())
    evaluate()
    deliver(Product(503))
    async def scenario(client, app):
        assert (await client.post('/v1/events', json={'events': [event()]})).status_code == 200
        health = (await client.get('/healthz')).json()
        assert health['outbox']['pending'] == 1 and health['outbox']['blocked'] == 0
    run_app(scenario)
