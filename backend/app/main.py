"""Stage 0 ONLY: one-process, nonpersistent memory; no actual navigation or DB use."""
import asyncio
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
import json
import math
import os
from pathlib import Path
import secrets
from uuid import UUID, uuid4

from fastapi import FastAPI, HTTPException, Response, WebSocket, WebSocketDisconnect, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pyproj import Transformer
from shapely.geometry import Point, mapping, shape, box
from shapely.ops import transform
import yaml
from .schemas import (ManualReport, AutomaticPublication, ReportReceipt, PublicationReceipt,
                      HazardCollection, RouteRequest, RouteResponse)

CONTRACTS = Path(os.getenv('CONTRACTS_DIR', Path(__file__).resolve().parents[2] / 'contracts'))
BEARER = HTTPBearer(auto_error=False)
FORWARD = Transformer.from_crs(4326, 32616, always_xy=True).transform
REVERSE = Transformer.from_crs(32616, 4326, always_xy=True).transform

def create_app():
    reports, publications, hazards = {}, {}, {}
    sockets = set()
    expired_notified = set()

    async def notify(hazard_id):
        for socket in tuple(sockets):
            try:
                await socket.send_json({'type':'hazards.changed','data':{'hazard_id':hazard_id}})
            except Exception:
                sockets.discard(socket)

    async def expiry_loop():
        while True:
            await asyncio.sleep(1)
            now = datetime.now(timezone.utc)
            for id, hazard in tuple(hazards.items()):
                props = hazard['properties']
                if props['expires_at'] <= now and id not in expired_notified:
                    expired_notified.add(id)
                    await notify(id)

    @asynccontextmanager
    async def lifespan(app):
        task = asyncio.create_task(expiry_loop())
        yield
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass

    app = FastAPI(title='Campus product stub', lifespan=lifespan)
    # Serve the agreed artifact; tests validate model/response parity against it.
    app.openapi = lambda: yaml.safe_load((CONTRACTS/'openapi.yaml').read_text())
    app.state.hazards = hazards

    def authenticate(credentials: HTTPAuthorizationCredentials | None = Depends(BEARER)):
        key = os.getenv('AUTOMATION_PUBLISH_KEY')
        if not key or not credentials or not secrets.compare_digest(credentials.credentials, key):
            raise HTTPException(401, 'Missing or invalid publisher credential', headers={'WWW-Authenticate':'Bearer'})
        return 'configured-publisher'

    @app.get('/healthz')
    def health():
        return {'status':'ok','storage':'memory','routing':'fixed-fixture','persistent':False}

    @app.post('/v1/reports', response_model=ReportReceipt, status_code=201)
    async def create_report(body: ManualReport, response: Response):
        id = str(body.id)
        if id in reports:
            previous, hazard_id = reports[id]
            if previous != body:
                raise HTTPException(409, 'Report ID already has a different payload')
            response.status_code = 200
            return {'report_id':id,'hazard_id':hazard_id,'duplicate':True}
        hazard_id = str(uuid4())
        polygon = transform(REVERSE, transform(FORWARD, Point(body.lon, body.lat)).buffer(8))
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
        expired_notified.discard(hazard_id)
        await notify(hazard_id)
        return {'hazard_id':hazard_id,'revision':body.revision,'duplicate':False}

    @app.get('/v1/hazards', response_model=HazardCollection)
    async def list_hazards(bbox: str):
        try:
            bounds = [float(value) for value in bbox.split(',')]
            west, south, east, north = bounds
            if not all(math.isfinite(x) for x in bounds) or not (-180 <= west < east <= 180 and -90 <= south < north <= 90):
                raise ValueError()
        except (ValueError, TypeError):
            raise HTTPException(422, 'bbox must be minLon,minLat,maxLon,maxLat with increasing WGS84 bounds')
        now = datetime.now(timezone.utc)
        return {'type':'FeatureCollection','features':[h for h in hazards.values()
                if h['properties']['status'] == 'active' and h['properties']['expires_at'] > now
                and shape(h['geometry']).intersects(box(*bounds))]}

    @app.post('/v1/route', response_model=RouteResponse)
    def plan_routes(body: RouteRequest, response: Response):
        response.headers['X-Stage-0-Stub'] = 'fixed-route-fixture-not-navigation'
        return json.loads((CONTRACTS/'fixtures/route.json').read_text())

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
