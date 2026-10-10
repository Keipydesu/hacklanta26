"""Observation API. AUTOMATION_DATABASE_URL selects durable PostGIS + worker; without it, the stage 0 memory stub.

Uses only the private observation database. Product writes go through the HTTP publisher.
"""
import asyncio
from contextlib import asynccontextmanager
from datetime import datetime, timezone
import logging
import os
from uuid import UUID

from fastapi import FastAPI, HTTPException
import httpx
from starlette.concurrency import run_in_threadpool
import yaml

from . import db
from .config import CONTRACTS
from .schemas import EventBatch, PointBatch, IngestReceipt

log = logging.getLogger('automation')
TICK_S = 2          # debounce: new committed observations are evaluated within about this long
PERIODIC_S = 60     # decay/expiry refresh/resolution even with no new ingestion

def create_app(database_url=None):
    url = database_url if database_url is not None else os.getenv('AUTOMATION_DATABASE_URL')
    product_url, publish_key = os.getenv('PRODUCT_API_URL'), os.getenv('AUTOMATION_PUBLISH_KEY')
    state = {'last_error': None, 'last_evaluated': None}
    pool = None
    if url:
        pool = db.make_pool(url)

    async def worker_loop(client):
        from . import outbox, worker
        last_periodic = 0.0
        while True:
            await asyncio.sleep(TICK_S)
            now = datetime.now(timezone.utc)
            try:
                async with pool.connection() as conn:
                    row = await (await conn.execute('SELECT dirty_seq > evaluated_seq AS dirty FROM worker_state')).fetchone()
                periodic = asyncio.get_running_loop().time() - last_periodic >= PERIODIC_S
                if row['dirty'] or periodic:
                    await worker.evaluate(pool, now)
                    last_periodic = asyncio.get_running_loop().time()
                    state['last_evaluated'] = now
                if product_url and publish_key:
                    await outbox.deliver_due(pool, client, product_url.rstrip('/'), publish_key, now)
                state['last_error'] = None
            except Exception as error:  # a bad tick must not kill the worker; ingestion and retries continue
                state['last_error'] = type(error).__name__
                log.exception('worker tick failed')

    @asynccontextmanager
    async def lifespan(app):
        if not pool:
            yield
            return
        await run_in_threadpool(db.migrate, url)
        await pool.open(wait=True, timeout=10)
        client = httpx.AsyncClient(timeout=httpx.Timeout(10, connect=3))
        task = asyncio.create_task(worker_loop(client))
        try:
            yield
        finally:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
            await client.aclose()
            await pool.close()

    app = FastAPI(title='Observation service', lifespan=lifespan)
    app.openapi = lambda: yaml.safe_load((CONTRACTS/'automatic.openapi.yaml').read_text())
    events, points = {}, {}
    app.state.events, app.state.points, app.state.pool = events, points, pool

    def ingest(items, store, ride_id=None):
        pending = {}
        duplicates = 0
        for item in items:
            id = str(item.id)
            value = (ride_id, item)
            existing = pending.get(id, store.get(id))
            if existing is not None:
                if existing != value:
                    raise HTTPException(409, 'Conflicting observation ID; entire batch rejected')
                duplicates += 1
            else:
                pending[id] = value
        store.update(pending)
        return {'accepted':len(pending),'duplicates':duplicates}

    @app.get('/healthz')
    async def health():
        if not pool:
            return {'status':'ok','storage':'memory','worker':'not-running','persistent':False}
        try:
            async with pool.connection(timeout=2) as conn:
                await conn.execute('SELECT 1')
        except Exception:
            log.exception('observation database health check failed')
            raise HTTPException(503, 'Observation database unavailable')
        from . import outbox
        return {'status':'ok','storage':'postgis','persistent':True,
                'worker':'degraded' if state['last_error'] else 'running', 'last_error': state['last_error'],
                'last_evaluated_at': state['last_evaluated'].isoformat() if state['last_evaluated'] else None,
                'outbox': await outbox.stats(pool, datetime.now(timezone.utc))}

    @app.post('/v1/events', response_model=IngestReceipt)
    async def ingest_events(body: EventBatch):
        if pool:
            from . import ingest as durable
            try:
                accepted, duplicates = await durable.ingest_events(pool, body.events)
            except durable.Conflict:
                raise HTTPException(409, 'Conflicting observation ID; entire batch rejected')
            return {'accepted':accepted,'duplicates':duplicates}
        return ingest(body.events, events)

    @app.post('/v1/rides/{ride_id}/points', response_model=IngestReceipt)
    async def ingest_points(ride_id: UUID, body: PointBatch):
        if pool:
            from . import ingest as durable
            try:
                accepted, duplicates = await durable.ingest_points(pool, ride_id, body.points)
            except durable.Conflict:
                raise HTTPException(409, 'Conflicting observation ID; entire batch rejected')
            return {'accepted':accepted,'duplicates':duplicates}
        return ingest(body.points, points, str(ride_id))

    return app

app = create_app()
