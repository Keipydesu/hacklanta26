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
        conn.execute('DROP TABLE IF EXISTS cells, outbox, derived_hazards, worker_state, points, events, schema_migrations CASCADE')
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

@pytest.mark.parametrize('table', ['events', 'points'])
@pytest.mark.parametrize('legacy_payload', [False, True])
def test_equivalent_timestamp_offsets_are_duplicates_even_for_existing_payloads(table, legacy_payload):
    ride = uuid4()
    original = event(ride=ride)
    if table == 'points':
        original = dict(json.loads((ROOT/'fixtures/points.json').read_text())['points'][0],
                        id=str(uuid4()), ts=original['ts'])
    instant = datetime.fromisoformat(original['ts'])
    offset_ts = instant.astimezone(timezone(timedelta(hours=-4))).isoformat()
    retry = dict(original, ts=offset_ts)
    path = '/v1/events' if table == 'events' else f'/v1/rides/{ride}/points'

    async def initial(client, app):
        assert (await client.post(path, json={table: [original]})).json() == {'accepted': 1, 'duplicates': 0}
    run_app(initial)
    if legacy_payload:
        # Rows persisted before UTC normalization must remain retryable without a data migration.
        sql(f"UPDATE {table} SET payload = jsonb_set(payload, '{{ts}}', %s::jsonb) RETURNING id", json.dumps(offset_ts))
        retry = original

    async def after_restart(client, app):
        response = await client.post(path, json={table: [retry, original]})
        assert response.status_code == 200
        assert response.json() == {'accepted': 0, 'duplicates': 2}
        changed = dict(retry, ts=(instant + timedelta(seconds=1)).isoformat())
        assert (await client.post(path, json={table: [changed]})).status_code == 409
    run_app(after_restart)
    assert sql('SELECT dirty_seq FROM worker_state') == [(1,)]

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

def test_second_evaluator_is_excluded_by_advisory_lock_xact_variant_removed():
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
        return httpx.Response(200, json={'hazard_id': '00000000-0000-4000-8000-000000000001', 'revision': body['revision'], 'duplicate': False})

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

# ---- identity lifecycle, late ingest, duplicate acks ---------------------------------------

def line(start, count, ride_ids, ts, step=2e-5, **kw):
    return [event(0, ride=ride_ids[n % len(ride_ids)], ts=ts, dlat=start + n * step, **kw) for n in range(count)]

def test_split_keeps_one_identity_and_creates_a_new_one_for_the_other_child():
    rides = [uuid4(), uuid4()]
    fresh_ts = NOW - timedelta(hours=1)
    seed(line(0, 4, rides, fresh_ts) + line(3.0e-4, 4, rides, fresh_ts)                  # A and B
         + line(1.2e-4, 3, rides, NOW - timedelta(days=29, hours=22), step=6e-5))        # bridge, about to age out
    assert evaluate() == 1
    [(parent, _, _, _)] = outbox_rows()
    assert evaluate(NOW + timedelta(hours=5)) == 2                                        # bridge now older than 30 days
    rows = outbox_rows()
    children = {r[0] for r in rows if r[1] == 1 and r[0] != parent} | {parent}
    assert len(children) == 2 and parent in children
    assert sorted((str(r[0]) == str(parent), r[1]) for r in rows) == [(False, 1), (True, 1), (True, 2)]
    assert sql("SELECT count(*) FROM derived_hazards WHERE status = 'active'") == [(2,)]

def test_merge_keeps_one_predecessor_and_resolves_the_other():
    rides = [uuid4(), uuid4()]
    old = NOW - timedelta(days=3)
    seed(line(0, 4, rides, old) + line(3.0e-4, 4, rides, old))
    assert evaluate(NOW - timedelta(hours=2)) == 2
    seed(line(1.2e-4, 3, rides, NOW - timedelta(hours=1), step=6e-5))                      # bridge arrives later
    assert evaluate(NOW) == 2                                                               # merged update + one resolution
    assert sorted(r[2] for r in outbox_rows() if r[1] == 2) == ['active', 'resolved']
    assert sql("SELECT count(*) FROM derived_hazards WHERE status = 'active'") == [(1,)]
    assert sql("SELECT count(DISTINCT external_id) FROM outbox") == [(2,)]                  # survivor is an original ID

def test_late_ingest_during_an_evaluation_stays_dirty_for_the_next_pass(monkeypatch):
    seed(cluster())
    real = worker.cluster_events
    state = {'done': False}
    async def ingest_midway(conn, event_type, now):
        if not state['done']:
            state['done'] = True
            await asyncio.to_thread(seed, [event(4)])         # commits on another connection after our snapshot began
        return await real(conn, event_type, now)
    monkeypatch.setattr(worker, 'cluster_events', ingest_midway)
    evaluate()
    # The evaluation cleared only the work it could see; the newer ingest is still pending.
    assert sql('SELECT dirty_seq > evaluated_seq FROM worker_state') == [(True,)]
    assert sql("SELECT body->>'event_count' FROM outbox") == [('4',)]   # snapshot isolation: the late event is not in this pass
    monkeypatch.setattr(worker, 'cluster_events', real)
    assert evaluate() == 1
    assert sql('SELECT dirty_seq = evaluated_seq FROM worker_state') == [(True,)]

def test_duplicate_success_after_lost_ack_is_accepted_and_does_not_double_deliver():
    seed(cluster())
    evaluate()
    class Duplicate(Product):
        def handle(self, request):
            body = json.loads(request.content)
            self.calls.append((None, body['revision'], {}))
            return httpx.Response(200, json={'hazard_id': '00000000-0000-4000-8000-000000000001', 'revision': body['revision'], 'duplicate': True})
    product = Duplicate()
    assert deliver(product)['delivered'] == 1 and states() == [(1, 'delivered', 1)]
    assert deliver(product) == {'delivered': 0, 'retry': 0, 'blocked': 0} and len(product.calls) == 1

def test_receipt_with_changed_public_id_blocks_instead_of_overwriting():
    first = cluster()
    seed(first)
    evaluate()
    assert deliver(Product())['delivered'] == 1
    seed([event(6, ride=first[0]['ride_id'])])
    evaluate()
    class Moved(Product):
        def handle(self, request):
            body = json.loads(request.content)
            return httpx.Response(200, json={'hazard_id': '00000000-0000-4000-8000-0000000000ff', 'revision': body['revision'], 'duplicate': False})
    assert deliver(Moved())['blocked'] == 1

# ---- abandonment -----------------------------------------------------------------------------

import h3
from app import abandonment

POINT = json.loads((ROOT/'fixtures/points.json').read_text())['points'][0]
BUSY, NEIGHBOR = (33.7531, -84.3853), (33.7541, -84.3853)   # ~110 m apart

def traffic(place, per_day, days, now=NOW, source='device'):
    """One point per ride, per day (day k = [now-(k+1)*24h, now-k*24h))."""
    out = []
    for k in days:
        for _ in range(per_day):
            ts = now - timedelta(days=k, hours=12)
            out.append((str(uuid4()), dict(POINT, id=str(uuid4()), ts=ts.isoformat(), lat=place[0], lon=place[1], source=source)))
    return out

def post_points(rows):
    async def go(client, app):
        responses = await asyncio.gather(*(client.post(f'/v1/rides/{ride}/points', json={'points': [point]}) for ride, point in rows))
        assert {r.status_code for r in responses} == {200}
    run_app(go)

def test_helper_geometry_cells_are_close_enough_for_the_scenario():
    a, b = h3.latlng_to_cell(*BUSY, abandonment.RESOLUTION), h3.latlng_to_cell(*NEIGHBOR, abandonment.RESOLUTION)
    assert 0 < h3.grid_distance(a, b) <= abandonment.NEIGHBOR_RINGS

def test_closure_scenario_flags_busy_cell_with_rising_neighbor_and_publishes_polygon():
    rows = traffic(BUSY, 6, range(2, 14)) + traffic(NEIGHBOR, 5, range(2, 14)) + traffic(NEIGHBOR, 9, range(0, 2))
    post_points(rows)
    assert evaluate() == 1
    body = sql("SELECT body FROM outbox")[0][0]
    assert body['kind'] == 'abandoned' and body['score'] == 0.7 and body['event_count'] == 0
    assert body['status'] == 'active' and body['evidence_source'] == 'device' and body['ride_count'] == 72
    ring = body['geometry']['coordinates'][0]
    assert body['geometry']['type'] == 'Polygon' and ring[0] == ring[-1] and -85 < ring[0][0] < -84 and 33 < ring[0][1] < 34  # lon first
    assert sql("SELECT count(*) FROM cells WHERE flagged") == [(1,)]
    assert evaluate() == 0                                     # stable at the same evidence
    # Traffic returns to the busy cell: the hazard resolves with a complete higher revision.
    post_points(traffic(BUSY, 6, range(0, 2)))
    assert evaluate() == 1
    assert sql("SELECT body->>'status', revision FROM outbox ORDER BY revision DESC LIMIT 1")[0] == ('resolved', 2)

def test_no_flag_without_history_or_without_a_gaining_neighbor_or_with_zero_baseline_neighbor():
    now = NOW
    busy = traffic(BUSY, 6, range(2, 14))
    days, sources = abandonment.aggregate_traffic([(r, datetime.fromisoformat(p['ts']), p['lat'], p['lon'], p['source']) for r, p in busy], now)
    assert abandonment.find_abandoned_cells(days)[0] == set()                   # dropped, but nobody gained: not evidence
    fresh_neighbor = traffic(NEIGHBOR, 9, range(0, 2))                          # zero baseline: ratio undefined, skipped
    days, _ = abandonment.aggregate_traffic([(r, datetime.fromisoformat(p['ts']), p['lat'], p['lon'], p['source']) for r, p in busy + fresh_neighbor], now)
    assert abandonment.find_abandoned_cells(days)[0] == set()
    low = traffic(BUSY, 4, range(2, 14)) + traffic(NEIGHBOR, 5, range(2, 14)) + traffic(NEIGHBOR, 9, range(0, 2))
    days, _ = abandonment.aggregate_traffic([(r, datetime.fromisoformat(p['ts']), p['lat'], p['lon'], p['source']) for r, p in low], now)
    assert abandonment.find_abandoned_cells(days)[0] == set()                   # baseline under 5 rides/day

def test_touching_cells_group_and_separate_components_stay_separate_polygons():
    a = h3.latlng_to_cell(*BUSY, abandonment.RESOLUTION)
    near = sorted(h3.grid_ring(a, 1))[0]
    far = h3.latlng_to_cell(33.7600, -84.3700, abandonment.RESOLUTION)
    groups = abandonment.group_cells({a, near, far})
    assert sorted(len(g) for g in groups) == [1, 2]
    for group in groups:
        for polygon in abandonment.polygons(group):
            assert polygon['type'] == 'Polygon' and polygon['coordinates'][0][0] == polygon['coordinates'][0][-1]

# ---- review fixes ----------------------------------------------------------------------------

def test_abandoned_hazard_is_not_republished_as_time_advances():
    post_points(traffic(BUSY, 6, range(2, 14)) + traffic(NEIGHBOR, 5, range(2, 14)) + traffic(NEIGHBOR, 9, range(0, 2)))
    assert evaluate() == 1
    assert evaluate(NOW + timedelta(minutes=1)) == 0 and evaluate(NOW + timedelta(minutes=2)) == 0   # window slides, evidence doesn't
    assert sql('SELECT count(*) FROM outbox') == [(1,)]

def test_dirty_only_pass_skips_abandonment_without_resolving_it():
    post_points(traffic(BUSY, 6, range(2, 14)) + traffic(NEIGHBOR, 5, range(2, 14)) + traffic(NEIGHBOR, 9, range(0, 2)))
    assert evaluate() == 1
    assert with_pool(lambda pool: worker.evaluate(pool, NOW + timedelta(seconds=5), include_abandonment=False)) == 0
    assert sql("SELECT status FROM derived_hazards WHERE kind = 'abandoned'") == [('active',)]

def test_malformed_candidate_is_skipped_not_fatal(monkeypatch):
    seed(cluster())
    seed(cluster(dlat=0.01, type='bump'))
    real = worker.public_body
    def corrupt(cand, revision, now, status='active'):
        body = real(cand, revision, now, status)
        if cand['kind'] == 'braking':
            body['score'] = 5          # product rejects score > 1
        return body
    monkeypatch.setattr(worker, 'public_body', corrupt)
    assert evaluate() == 1             # only the valid bump hazard was enqueued
    assert sql('SELECT count(*) FROM outbox') == [(1,)]

def test_malformed_receipt_retries_instead_of_stranding_claimed_rows():
    seed(cluster())
    evaluate()
    class Garbage(Product):
        def handle(self, request):
            return httpx.Response(200, json={'oops': True})
    assert deliver(Garbage())['retry'] == 1
    assert states() == [(1, 'pending', 1)]

@pytest.mark.parametrize('content', [b'', b'<html>temporary proxy error</html>'])
def test_non_json_success_retries_then_delivers_successor_in_order(content):
    first = cluster()
    seed(first)
    evaluate()
    seed([event(6, ride=first[0]['ride_id'])])
    evaluate()
    bodies = sql('SELECT body FROM outbox ORDER BY revision')
    class BadJson(Product):
        def handle(self, request):
            return httpx.Response(200, content=content)
    assert deliver(BadJson()) == {'delivered': 0, 'retry': 1, 'blocked': 0}
    assert states() == [(1, 'pending', 1), (2, 'pending', 0)]
    product = Product()
    later = NOW + timedelta(minutes=10)
    assert deliver(product, later)['delivered'] == 1
    assert deliver(product, later)['delivered'] == 1
    assert [call[1] for call in product.calls] == [1, 2]
    assert sql('SELECT body FROM outbox ORDER BY revision') == bodies

def test_rebase_renumbers_blocked_rows_above_the_products_revision_and_resumes():
    first = cluster()
    seed(first)
    evaluate()
    seed([event(6, ride=first[0]['ride_id'])])
    evaluate()
    assert deliver(Product(409))['blocked'] == 1                         # product says our revision 1 is stale
    external_id = sql('SELECT external_id FROM outbox LIMIT 1')[0][0]
    assert with_pool(lambda pool: outbox.rebase(pool, external_id, 8)) == 2
    assert states() == [(8, 'pending', 1), (9, 'pending', 0)]
    assert sql("SELECT (body->>'revision')::int FROM outbox ORDER BY revision") == [(8,), (9,)]
    assert sql('SELECT revision FROM derived_hazards') == [(9,)]
    product = Product()
    assert deliver(product, NOW + timedelta(hours=1))['delivered'] == 1 and deliver(product, NOW + timedelta(hours=1))['delivered'] == 1
    assert [c[1] for c in product.calls] == [8, 9]

def test_evaluator_holds_session_lock_before_its_snapshot():
    seed(cluster())
    async def scenario(pool):
        async with pool.connection() as holder:
            await holder.set_autocommit(True)
            await holder.execute('SELECT pg_advisory_lock(%s)', (worker.LOCK_KEY,))
            blocked = await worker.evaluate(pool, NOW)
            await holder.execute('SELECT pg_advisory_unlock(%s)', (worker.LOCK_KEY,))
            await holder.set_autocommit(False)
        return blocked, await worker.evaluate(pool, NOW)
    assert with_pool(scenario) == (None, 1)


def test_abandonment_provenance_includes_the_qualifying_neighbors_traffic():
    rows = traffic(BUSY, 6, range(2, 14)) + traffic(NEIGHBOR, 5, range(2, 14), source='simulated') + traffic(NEIGHBOR, 9, range(0, 2), source='simulated')
    post_points(rows)
    assert evaluate() == 1
    assert sql("SELECT body->>'evidence_source' FROM outbox") == [('mixed',)]

def test_rebase_waits_for_a_running_evaluator_and_renumbers_the_row_it_enqueues():
    first = cluster()
    seed(first)
    evaluate()
    assert deliver(Product(409))['blocked'] == 1
    external_id = sql('SELECT external_id FROM outbox LIMIT 1')[0][0]
    async def scenario(pool):
        async with pool.connection() as evaluator:
            await evaluator.set_autocommit(True)
            await evaluator.execute('SELECT pg_advisory_lock(%s)', (worker.LOCK_KEY,))   # an evaluation is running
            recovery = asyncio.create_task(outbox.rebase(pool, str(external_id), 8))
            await asyncio.sleep(0.3)
            assert not recovery.done()                                                    # recovery must wait for it
            body = sql("SELECT public_body FROM derived_hazards")[0][0]
            await worker.enqueue(evaluator, str(external_id), dict(body, revision=2, event_count=body['event_count'] + 1), body['geometry'], NOW)
            await evaluator.execute('SELECT pg_advisory_unlock(%s)', (worker.LOCK_KEY,))
            await evaluator.set_autocommit(False)
        return await recovery
    assert with_pool(scenario) == 2
    assert states() == [(8, 'pending', 1), (9, 'pending', 0)]
    assert sql("SELECT (body->>'revision')::int FROM outbox ORDER BY revision") == [(8,), (9,)]
    assert sql("SELECT revision, (public_body->>'revision')::int FROM derived_hazards") == [(9, 9)]
    assert sql("SELECT (body->>'event_count')::int FROM outbox ORDER BY revision")[1][0] == sql("SELECT (public_body->>'event_count')::int FROM derived_hazards")[0][0]

def test_rebase_refuses_while_a_delivery_of_the_hazard_is_in_flight():
    seed(cluster())
    evaluate()
    external_id = str(sql('SELECT external_id FROM outbox LIMIT 1')[0][0])
    async def scenario(pool):
        assert len(await outbox.claim_due(pool, NOW)) == 1                                # claimed: state sending, lease in the future
        with pytest.raises(RuntimeError, match='in flight'):
            await outbox.rebase(pool, external_id, 8)
    with_pool(scenario)
    assert sql('SELECT revision, state FROM outbox') == [(1, 'sending')]
