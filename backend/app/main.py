"""Product API. DATABASE_URL selects PostGIS persistence; without it, nonpersistent stage 0 memory.

Routing is still the fixed stage 0 fixture (Lane C4-C5)."""
import asyncio
import logging
from contextlib import asynccontextmanager, suppress
from datetime import datetime, timedelta, timezone
import json
import math
import os
from pathlib import Path
import secrets
from starlette.concurrency import run_in_threadpool
from uuid import UUID, uuid4

import psycopg
import psycopg_pool
from fastapi import FastAPI, HTTPException, Response, WebSocket, WebSocketDisconnect, Depends
from fastapi.responses import JSONResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pyproj import Transformer
from shapely.geometry import Point, mapping, shape, box
from shapely.ops import transform
import yaml
from .db.migrate import migrate
from .db.store import Conflict, PostgresStore
from .schemas import (ManualReport, AutomaticPublication, ReportReceipt, PublicationReceipt,
                      HazardCollection, RouteRequest, RouteResponse)

CONTRACTS = Path(os.getenv('CONTRACTS_DIR', Path(__file__).resolve().parents[2] / 'contracts'))
BEARER = HTTPBearer(auto_error=False)
SEND_TIMEOUT_S = 1.0
log = logging.getLogger('product')

def parse_bbox(bbox):
    try:
        bounds = [float(value) for value in bbox.split(',')]
        west, south, east, north = bounds
        if not all(math.isfinite(x) for x in bounds) or not (-180 <= west < east <= 180 and -90 <= south < north <= 90):
            raise ValueError()
    except (ValueError, TypeError):
        raise HTTPException(422, 'bbox must be minLon,minLat,maxLon,maxLat with increasing WGS84 bounds')
    return bounds

def report_area(lon, lat, radius_m=8):
    # Buffer in a metre-based projection centred on the point so any global coordinate stays finite.
    local = f'+proj=aeqd +lat_0={lat} +lon_0={lon} +units=m +datum=WGS84'
    reverse = Transformer.from_crs(local, 4326, always_xy=True).transform
    polygon = transform(reverse, Point(0, 0).buffer(radius_m))
    west, _, east, _ = polygon.bounds
    if not polygon.is_valid or east - west > 180:
        raise HTTPException(422, 'Report location is too close to a pole or the antimeridian')
    return polygon

def create_app(database_url=None):
    url = database_url if database_url is not None else os.getenv('DATABASE_URL')
    store = PostgresStore(url) if url else None
    reports, publications, hazards = {}, {}, {}
    sockets = set()
    spec = yaml.safe_load((CONTRACTS/'openapi.yaml').read_text())
    route_fixture = json.loads((CONTRACTS/'fixtures/route.json').read_text())

    async def send(socket, message):
        try:
            await asyncio.wait_for(socket.send_json(message), SEND_TIMEOUT_S)
        except Exception:
            # A stalled or broken client must not hold up writers; drop and close it.
            sockets.discard(socket)
            with suppress(Exception):
                await asyncio.wait_for(socket.close(), SEND_TIMEOUT_S)

    async def notify(hazard_id):
        message = {'type':'hazards.changed','data':{'hazard_id':hazard_id}}
        await asyncio.gather(*(send(socket, message) for socket in tuple(sockets)))

    async def expiry_loop():
        while True:
            await asyncio.sleep(1)
            now = datetime.now(timezone.utc)
            if store:
                # Request-time filtering keeps reads correct; this only sends hints, so a DB blip is skippable.
                try:
                    expired = await store.scan_expirations(now)
                except Exception:
                    log.exception('expiry scan failed')
                    continue
                for id in expired:
                    await notify(id)
                continue
            expired = []
            # Finish the entire prune before yielding: a publication may refresh any
            # hazard while notify() awaits a socket. Never delete from a stale snapshot.
            for id, hazard in tuple(hazards.items()):
                props = hazard['properties']
                if props['expires_at'] <= now:
                    del hazards[id]
                    expired.append(id)
                elif props['status'] != 'active':
                    del hazards[id]
            for id in expired:
                await notify(id)

    @asynccontextmanager
    async def lifespan(app):
        if store:
            await run_in_threadpool(migrate, url)
            await store.open()
        task = asyncio.create_task(expiry_loop())
        try:
            yield
        finally:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
            if store:
                await store.close()

    app = FastAPI(title='Campus product stub', lifespan=lifespan)

    @app.exception_handler(psycopg.DataError)
    @app.exception_handler(UnicodeEncodeError)
    async def unstorable_text(request, exc):
        # e.g. NUL characters or lone surrogates in text: a client defect, so don't let a queued retry loop on a 500
        return JSONResponse({'detail': 'Text contains characters that cannot be stored'}, status_code=422)

    @app.exception_handler(psycopg.OperationalError)
    @app.exception_handler(psycopg_pool.PoolTimeout)
    async def storage_down(request, exc):
        log.error('product database unavailable: %r', exc)
        return JSONResponse({'detail': 'Product database unavailable'}, status_code=503)
    # Serve the agreed artifact; tests validate model/response parity against it.
    app.openapi = lambda: spec
    app.state.hazards = hazards
    app.state.store = store

    def authenticate(credentials: HTTPAuthorizationCredentials | None = Depends(BEARER)):
        key = os.getenv('AUTOMATION_PUBLISH_KEY')
        if not key or not credentials or not secrets.compare_digest(credentials.credentials, key):
            raise HTTPException(401, 'Missing or invalid publisher credential', headers={'WWW-Authenticate':'Bearer'})
        return 'configured-publisher'

    @app.get('/healthz')
    async def health():
        if store:
            try:
                await store.health()
            except Exception:
                log.exception('product database health check failed')
                raise HTTPException(503, 'Product database unavailable')
            return {'status':'ok','storage':'postgis','routing':'fixed-fixture','persistent':True}
        return {'status':'ok','storage':'memory','routing':'fixed-fixture','persistent':False}

    @app.post('/v1/reports', response_model=ReportReceipt, status_code=201)
    async def create_report(body: ManualReport, response: Response):
        id = str(body.id)
        if store:
            polygon = report_area(body.lon, body.lat)
            try:
                result = await store.create_report(body, polygon)
            except Conflict:
                raise HTTPException(409, 'Report ID already has a different payload')
            response.status_code = result.status
            if not result.duplicate:
                await notify(result.hazard_id)
            return {'report_id':id,'hazard_id':result.hazard_id,'duplicate':result.duplicate}
        if id in reports:
            previous, hazard_id = reports[id]
            if previous != body:
                raise HTTPException(409, 'Report ID already has a different payload')
            response.status_code = 200
            return {'report_id':id,'hazard_id':hazard_id,'duplicate':True}
        hazard_id = str(uuid4())
        polygon = report_area(body.lon, body.lat)
        props = dict(id=hazard_id, source='manual', kind=body.kind, label=body.description or body.kind,
                     score=0.5, status='active', first_seen=body.observed_at, last_seen=body.observed_at,
                     expires_at=body.observed_at+timedelta(hours=24), event_count=0, ride_count=0,
                     report_count=1, evidence_source=None)
        hazards[hazard_id] = {'type':'Feature','geometry':mapping(polygon),'properties':props}
        reports[id] = (body, hazard_id)
        await notify(hazard_id)
        return {'report_id':id,'hazard_id':hazard_id,'duplicate':False}

    @app.put('/v1/automatic/hazards/{external_id}', response_model=PublicationReceipt, status_code=201)
    async def publish_hazard(external_id: UUID, body: AutomaticPublication, response: Response,
                             publisher=Depends(authenticate)):
        if store:
            try:
                result = await store.publish(publisher, external_id, body)
            except Conflict:
                raise HTTPException(409, 'Stale or conflicting revision')
            response.status_code = result.status
            if not result.duplicate:
                await notify(result.hazard_id)
            return {'hazard_id':result.hazard_id,'revision':body.revision,'duplicate':result.duplicate}
        key = (publisher, str(external_id))
        hazard_id = str(uuid4())
        if key in publications:
            previous, hazard_id = publications[key]
            if body.revision < previous.revision or (body.revision == previous.revision and body != previous):
                raise HTTPException(409, 'Stale or conflicting revision')
            response.status_code = 200
            if body == previous:
                return {'hazard_id':hazard_id,'revision':body.revision,'duplicate':True}
        props = body.model_dump(exclude={'revision','geometry'})
        props.update(id=hazard_id, source='automatic', report_count=0)
        hazards[hazard_id] = {'type':'Feature','geometry':body.geometry.model_dump(),'properties':props}
        publications[key] = (body, hazard_id)
        await notify(hazard_id)
        return {'hazard_id':hazard_id,'revision':body.revision,'duplicate':False}

    @app.get('/v1/hazards', response_model=HazardCollection)
    async def list_hazards(bbox: str):
        bounds = parse_bbox(bbox)
        now = datetime.now(timezone.utc)
        if store:
            return {'type':'FeatureCollection','features':await store.list_active(bounds, now)}
        return {'type':'FeatureCollection','features':[h for h in hazards.values()
                if h['properties']['status'] == 'active' and h['properties']['expires_at'] > now
                and shape(h['geometry']).intersects(box(*bounds))]}

    @app.post('/v1/route', response_model=RouteResponse)
    def plan_routes(body: RouteRequest, response: Response):
        response.headers['X-Stage-0-Stub'] = 'fixed-route-fixture-not-navigation'
        return route_fixture

    @app.websocket('/v1/live')
    async def live(socket: WebSocket):
        await socket.accept()
        sockets.add(socket)
        try:
            while True:
                await socket.receive_text()
        except WebSocketDisconnect:
            pass
        finally:
            sockets.discard(socket)

    return app

app = create_app()
