"""DB-backed behavior. Needs a disposable PostGIS database: TEST_DATABASE_URL=postgresql://... (tables are dropped)."""
import asyncio
import json
from datetime import datetime, timedelta, timezone
import os
from uuid import UUID, uuid4

import httpx
import psycopg
import pytest
from shapely.geometry import Polygon

from app.db.migrate import migrate
from app.db.store import Conflict, PostgresStore
from app.main import create_app
from app.schemas import HazardFeedback, ManualReport
from test_boundary import AUTH, FEED, PUB, fixture, fresh, validate

URL = os.getenv('TEST_DATABASE_URL')
pytestmark = pytest.mark.skipif(not URL, reason='TEST_DATABASE_URL not set')

@pytest.fixture(autouse=True)
def clean_db(monkeypatch):
    monkeypatch.setenv('AUTOMATION_PUBLISH_KEY', 'test-only-key')
    with psycopg.connect(URL, autocommit=True) as conn:
        conn.execute('DROP TABLE IF EXISTS hazard_feedback, hazards, manual_reports, schema_migrations CASCADE')

def run(scenario):
    """Run `scenario(client, app)` against a fresh app lifecycle; call again to simulate a restart."""
    async def go():
        app = create_app(URL)
        async with app.router.lifespan_context(app):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
                return await scenario(client, app)
    return asyncio.run(go())

def sql(query, *args):
    with psycopg.connect(URL) as conn:
        return conn.execute(query, args).fetchall()

def test_fresh_migration_is_idempotent():
    assert migrate(URL) == ['001_product_schema', '002_hazard_feedback']
    assert migrate(URL) == []

def test_concurrent_starters_serialize_migrations():
    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(4) as pool:
        results = list(pool.map(lambda _: migrate(URL), range(4)))
    assert sorted(len(r) for r in results) == [0, 0, 0, 2]

def test_manual_report_survives_restart_and_retries():
    manual, _ = fresh()
    async def first(client, app):
        health = await client.get('/healthz')
        assert health.json()['storage'] == 'postgis' and health.json()['persistent']
        created = await client.post('/v1/reports', json=manual)
        assert created.status_code == 201
        validate('ReportReceipt', created.json())
        return created.json()
    created = run(first)
    async def after_restart(client, app):
        retry = await client.post('/v1/reports', json=manual)
        assert retry.status_code == 200 and retry.json() == dict(created, duplicate=True)
        assert (await client.post('/v1/reports', json=dict(manual, description='changed'))).status_code == 409
        feed = (await client.get(FEED)).json()
        validate('HazardCollection', feed)
        assert [f['properties']['id'] for f in feed['features']] == [created['hazard_id']]
        props = feed['features'][0]['properties']
        assert props['source'] == 'manual' and props['score'] == 0.5 and props['report_count'] == 1
        assert (await client.get('/v1/hazards?bbox=0,0,1,1')).json()['features'] == []
    run(after_restart)

def test_expired_queued_report_is_stored_but_not_listed_and_still_idempotent():
    expired = fixture('cases/manual-expired.json')
    async def scenario(client, app):
        assert (await client.post('/v1/reports', json=expired)).status_code == 201
        assert (await client.post('/v1/reports', json=expired)).json()['duplicate']
        assert (await client.get(FEED)).json()['features'] == []
    run(scenario)
    assert sql('SELECT count(*) FROM manual_reports') == [(1,)]

def test_simultaneous_identical_reports_make_one_hazard():
    manual, _ = fresh()
    async def scenario(client, app):
        responses = await asyncio.gather(*(client.post('/v1/reports', json=manual) for _ in range(8)))
        assert sorted(r.status_code for r in responses) == [200] * 7 + [201]
        assert len({r.json()['hazard_id'] for r in responses}) == 1
    run(scenario)
    assert sql('SELECT count(*) FROM hazards') == [(1,)]

def test_report_and_hazard_commit_atomically():
    manual, _ = fresh()
    body = ManualReport.model_validate(manual)
    bowtie = Polygon([(0, 0), (1, 1), (1, 0), (0, 1), (0, 0)])  # invalid geometry violates the hazard constraint
    async def scenario(client, app):
        with pytest.raises(psycopg.errors.CheckViolation):
            await app.state.store.create_report(body, bowtie)
    run(scenario)
    assert sql('SELECT count(*) FROM manual_reports') == [(0,)]

def test_publication_auth_idempotency_and_revision_rules():
    manual, auto = fresh()
    async def scenario(client, app):
        manual_id = (await client.post('/v1/reports', json=manual)).json()['hazard_id']
        assert (await client.put(PUB, json=auto)).status_code == 401
        created = await client.put(PUB, json=auto, headers=AUTH)
        assert created.status_code == 201
        validate('PublicationReceipt', created.json())
        assert (await client.put(PUB, json=auto, headers=AUTH)).json()['duplicate']
        assert (await client.put(PUB, json=dict(auto, score=0.99), headers=AUTH)).status_code == 409
        update = dict(auto, revision=2, score=0.8)
        result = await client.put(PUB, json=update, headers=AUTH)
        assert result.status_code == 200 and result.json()['hazard_id'] == created.json()['hazard_id']
        assert (await client.put(PUB, json=auto, headers=AUTH)).status_code == 409
        feed = (await client.get(FEED)).json()
        validate('HazardCollection', feed)
        assert {f['properties']['source'] for f in feed['features']} == {'manual', 'automatic'}
        assert (await client.put(PUB, json=dict(update, revision=3, status='resolved'), headers=AUTH)).status_code == 200
        assert [f['properties']['id'] for f in (await client.get(FEED)).json()['features']] == [manual_id]
    run(scenario)
    assert sql("SELECT source, revision FROM hazards ORDER BY source") == [('automatic', 3), ('manual', None)]

def test_simultaneous_first_publication_and_out_of_order_revisions():
    _, auto = fresh()
    async def scenario(client, app):
        first = await asyncio.gather(*(client.put(PUB, json=auto, headers=AUTH) for _ in range(6)))
        assert sorted(r.status_code for r in first) == [200] * 5 + [201]
        assert len({r.json()['hazard_id'] for r in first}) == 1
        revisions = [dict(auto, revision=n, score=n / 10) for n in range(2, 8)]
        results = await asyncio.gather(*(client.put(PUB, json=r, headers=AUTH) for r in reversed(revisions)))
        assert {r.status_code for r in results} <= {200, 409}
    run(scenario)
    assert sql('SELECT count(*), max(revision), max(score) FROM hazards') == [(1, 7, 0.7)]

def test_publication_identity_survives_restart_and_expiry():
    _, auto = fresh()
    past = datetime.now(timezone.utc) - timedelta(days=1)
    stale = dict(auto, first_seen=past.isoformat(), last_seen=past.isoformat(), expires_at=past.isoformat())
    run(lambda client, app: client.put(PUB, json=stale, headers=AUTH))
    async def after(client, app):
        assert (await client.put(PUB, json=stale, headers=AUTH)).json()['duplicate']
        assert (await client.get(FEED)).json()['features'] == []
        assert (await client.put(PUB, json=dict(stale, revision=0), headers=AUTH)).status_code == 422
    run(after)

def test_expiry_scan_is_repeat_safe_and_reactivation_survives():
    _, auto = fresh()
    soon = datetime.now(timezone.utc) + timedelta(seconds=30)  # far enough that the app's own loop can't expire it mid-test
    short = dict(auto, first_seen=datetime.now(timezone.utc).isoformat(), last_seen=datetime.now(timezone.utc).isoformat(),
                 expires_at=soon.isoformat())
    async def scenario(client, app):
        store = app.state.store
        hazard_id = (await client.put(PUB, json=short, headers=AUTH)).json()['hazard_id']
        assert await store.scan_expirations(datetime.now(timezone.utc)) == []
        later = soon + timedelta(seconds=1)
        assert await store.scan_expirations(later) == [hazard_id]
        assert await store.scan_expirations(later) == []  # repeat-safe
        extended = dict(short, revision=2, expires_at=(later + timedelta(hours=1)).isoformat())
        assert (await client.put(PUB, json=extended, headers=AUTH)).status_code == 200
        assert [f['properties']['id'] for f in (await client.get(FEED)).json()['features']] == [hazard_id]
        assert await store.scan_expirations(later) == []
        assert await store.scan_expirations(later + timedelta(hours=2)) == [hazard_id]
    run(scenario)

def test_database_enforces_source_consistency():
    _, auto = fresh()
    async def scenario(client, app):
        await client.put(PUB, json=auto, headers=AUTH)
    run(scenario)
    with pytest.raises(psycopg.errors.CheckViolation):
        sql("UPDATE hazards SET report_count = 3")

def test_health_is_503_when_database_is_down():
    app = create_app(URL)
    async def go():
        async with app.router.lifespan_context(app):
            await app.state.store.pool.close()
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
                return (await client.get('/healthz')).status_code
    assert asyncio.run(go()) == 503

def test_live_hint_arrives_after_commit_and_stalled_socket_is_dropped():
    manual, _ = fresh()
    async def scenario(client, app):
        live = next(route.endpoint for route in app.routes if route.path == '/v1/live')
        got, hold, closed = asyncio.Event(), asyncio.Event(), asyncio.Event()
        seen = {}
        class Good:
            async def accept(self): pass
            async def receive_text(self): await hold.wait(); raise __import__('fastapi').WebSocketDisconnect()
            async def send_json(self, message):
                # By the time a hint is sent, the hazard must already be committed and visible.
                seen['rows'] = sql('SELECT count(*) FROM hazards')[0][0]
                seen['id'] = message['data']['hazard_id']
                got.set()
            async def close(self): hold.set()
        class Stalled(Good):
            async def send_json(self, message): await asyncio.sleep(60)
            async def close(self): closed.set(); hold.set()
        tasks = [asyncio.create_task(live(Good())), asyncio.create_task(live(Stalled()))]
        await asyncio.sleep(0.1)
        started = asyncio.get_running_loop().time()
        response = await client.post('/v1/reports', json=manual)
        assert asyncio.get_running_loop().time() - started < 3  # a stalled phone cannot hold the writer
        await asyncio.wait_for(got.wait(), 3)
        assert seen == {'rows': 1, 'id': response.json()['hazard_id']}
        await asyncio.wait_for(closed.wait(), 3)
        hold.set()
        await asyncio.gather(*tasks, return_exceptions=True)
    run(scenario)

def test_unstorable_text_is_422_not_500_and_unchanged_expiry_keeps_notification_state():
    manual, auto = fresh()
    async def scenario(client, app):
        assert (await client.post('/v1/reports', json=dict(manual, description='a\u0000b'))).status_code == 422
        raw = json.dumps(dict(manual, id=str(uuid4()), description='XX')).replace('XX', '\\ud800')  # JSON escape of a lone surrogate
        assert (await client.post('/v1/reports', content=raw, headers={'Content-Type': 'application/json'})).status_code == 422
        past = datetime.now(timezone.utc) - timedelta(days=1)
        stale = dict(auto, first_seen=past.isoformat(), last_seen=past.isoformat(), expires_at=past.isoformat())
        await client.put(PUB, json=stale, headers=AUTH)
        assert len(await app.state.store.scan_expirations(datetime.now(timezone.utc))) <= 1
        assert (await client.put(PUB, json=dict(stale, revision=2, label='renamed'), headers=AUTH)).status_code == 200
        assert await app.state.store.scan_expirations(datetime.now(timezone.utc)) == []  # same expires_at: not re-announced
    run(scenario)

def test_feedback_persists_across_restart_and_rejects_conflicts():
    manual, automatic = fresh()
    body = {'id': str(uuid4()), 'response': 'still_there'}
    async def first(client, app):
        hazard_id = (await client.post('/v1/reports', json=manual)).json()['hazard_id']
        created = await client.post(f'/v1/hazards/{hazard_id}/feedback', json=body)
        assert created.status_code == 201
        validate('FeedbackReceipt', created.json())
        return hazard_id, created.json()
    hazard_id, receipt = run(first)
    async def after_restart(client, app):
        url = f'/v1/hazards/{hazard_id}/feedback'
        retry = await client.post(url, json=body)
        assert retry.status_code == 200 and retry.json() == dict(receipt, duplicate=True)
        assert (await client.post(url, json=dict(body, response='gone'))).status_code == 409
        assert (await client.post(f'/v1/hazards/{uuid4()}/feedback', json={'id': str(uuid4()), 'response': 'gone'})).status_code == 404
        expired_id = (await client.post('/v1/reports', json=fixture('cases/manual-expired.json'))).json()['hazard_id']
        assert (await client.post(f'/v1/hazards/{expired_id}/feedback', json={'id': str(uuid4()), 'response': 'gone'})).status_code == 404
        automatic_id = (await client.put(PUB, json=automatic, headers=AUTH)).json()['hazard_id']
        assert (await client.post(f'/v1/hazards/{automatic_id}/feedback', json=body)).status_code == 409
    run(after_restart)
    assert sql('SELECT hazard_id::text, response FROM hazard_feedback') == [(hazard_id, 'still_there')]

def test_same_feedback_uuid_racing_for_two_hazards_yields_one_201_and_one_409():
    manual, _ = fresh()
    second = dict(manual, id=str(uuid4()), lat=manual['lat'] + 0.001)
    body = {'id': str(uuid4()), 'response': 'gone'}
    async def scenario(client, app):
        a = (await client.post('/v1/reports', json=manual)).json()['hazard_id']
        b = (await client.post('/v1/reports', json=second)).json()['hazard_id']
        results = await asyncio.gather(*(client.post(f'/v1/hazards/{h}/feedback', json=body) for h in (a, b)))
        return sorted(r.status_code for r in results)
    assert run(scenario) == [201, 409]
    assert sql('SELECT count(*) FROM hazard_feedback') == [(1,)]

def test_feedback_policy_extends_and_resolves_manual_hazards_in_the_database():
    manual, _ = fresh()
    manual['observed_at'] = (datetime.now(timezone.utc) - timedelta(hours=20)).isoformat()
    async def scenario(client, app):
        hazard_id = (await client.post('/v1/reports', json=manual)).json()['hazard_id']
        url = f'/v1/hazards/{hazard_id}/feedback'
        answer = lambda response: {'id': str(uuid4()), 'response': response}
        assert (await client.post(url, json=answer('still_there'))).status_code == 201
        return hazard_id, url, answer
    hazard_id, url, answer = run(scenario)
    [(expires_at, status)] = sql('SELECT expires_at, status FROM hazards WHERE id = %s', hazard_id)
    assert status == 'active' and expires_at > datetime.now(timezone.utc) + timedelta(hours=23)
    async def remove(client, app):
        assert (await client.post(url, json=answer('gone'))).status_code == 201
        assert [f['properties']['id'] for f in (await client.get(FEED)).json()['features']] == [hazard_id]
        assert (await client.post(url, json=answer('gone'))).status_code == 201
        assert (await client.get(FEED)).json()['features'] == []
    run(remove)
    assert sql('SELECT status, source, report_count FROM hazards WHERE id = %s', hazard_id) == [('resolved', 'manual', 1)]

def test_automatic_hazard_hidden_by_answers_until_newer_revision_in_the_database():
    _, automatic = fresh()
    async def scenario(client, app):
        hazard_id = (await client.put(PUB, json=automatic, headers=AUTH)).json()['hazard_id']
        url = f'/v1/hazards/{hazard_id}/feedback'
        answer = lambda response: {'id': str(uuid4()), 'response': response}
        ids = lambda feed: [f['properties']['id'] for f in feed['features']]
        assert (await client.post(url, json=answer('gone'))).status_code == 201
        assert ids((await client.get(FEED)).json()) == [hazard_id]
        assert (await client.post(url, json=answer('gone'))).status_code == 201
        assert ids((await client.get(FEED)).json()) == []
        assert (await client.post(url, json=answer('gone'))).status_code == 404
        return hazard_id, url, answer, ids
    hazard_id, url, answer, ids = run(scenario)
    assert sql('SELECT revision, status, hidden_at_revision FROM hazards WHERE id = %s', hazard_id) == [(1, 'active', 1)]
    async def republish(client, app):
        assert (await client.put(PUB, json=dict(automatic, revision=2), headers=AUTH)).status_code == 200
        assert ids((await client.get(FEED)).json()) == [hazard_id]
        assert (await client.post(url, json=answer('gone'))).status_code == 201
        assert ids((await client.get(FEED)).json()) == [hazard_id]
    run(republish)

def test_feedback_order_follows_processing_not_the_request_clock():
    manual, _ = fresh()
    hazard_id = run(lambda client, app: _report(client, manual))
    async def scenario():
        store = PostgresStore(URL)
        await store.open()
        try:
            now = datetime.now(timezone.utc)
            gone = await store.record_feedback(UUID(hazard_id), HazardFeedback(id=uuid4(), response='gone'), now)
            still = await store.record_feedback(UUID(hazard_id), HazardFeedback(id=uuid4(), response='still_there'), now - timedelta(seconds=5))
            again = await store.record_feedback(UUID(hazard_id), HazardFeedback(id=uuid4(), response='gone'), now - timedelta(seconds=10))
            return gone.changed, still.changed, again.changed
        finally:
            await store.close()
    assert asyncio.run(scenario()) == (False, True, False), 'the later-processed still_there extends and resets the gone count'
    assert sql('SELECT status FROM hazards WHERE id = %s', hazard_id) == [('active',)]

async def _report(client, manual):
    return (await client.post('/v1/reports', json=manual)).json()['hazard_id']
