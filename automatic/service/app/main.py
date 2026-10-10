"""Private, in-memory observation stub. No worker, database, sensors or publication side effects."""
import os
from pathlib import Path
from uuid import UUID
from fastapi import FastAPI, HTTPException
import yaml
from .schemas import EventBatch, PointBatch, IngestReceipt

CONTRACTS = Path(os.getenv('CONTRACTS_DIR', Path(__file__).resolve().parents[3] / 'contracts'))

def create_app():
    app = FastAPI(title='Observation stub')
    app.openapi = lambda: yaml.safe_load((CONTRACTS/'automatic.openapi.yaml').read_text())
    events, points = {}, {}
    app.state.events, app.state.points = events, points

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
    def health():
        return {'status':'ok','storage':'memory','worker':'not-implemented','persistent':False}

    @app.post('/v1/events', response_model=IngestReceipt)
    async def ingest_events(body: EventBatch):
        return ingest(body.events, events)

    @app.post('/v1/rides/{ride_id}/points', response_model=IngestReceipt)
    async def ingest_points(ride_id: UUID, body: PointBatch):
        return ingest(body.points, points, str(ride_id))

    return app

app = create_app()
