# Product API · stage 0

This is a **single-process, nonpersistent in-memory stub**. Restarting loses all reports and
publication revisions. The product database is provisioned by Compose but is not used yet.
Do not deploy this stub as a durable service or run multiple workers.

From the repository root, with Python 3.11+ and uv:

```sh
uv sync --project backend --frozen
uv run --project backend uvicorn app.main:app --app-dir backend --host 0.0.0.0 --port 8000
uv run --project backend pytest -c backend/pyproject.toml backend/tests -q
```

Set `AUTOMATION_PUBLISH_KEY` in the server environment if testing publication. Without it,
publication is disabled (401); manual reporting still works. No `.env` file is loaded automatically
by these commands. The interactive API docs are at `http://localhost:8000/docs`.

Implemented for fixture integration: report retry/conflict, 8 m UTM-buffered polygons, bbox and
expiry filtering, authenticated publication revisions/resolution, source separation, live change
hints, and a fixed route response. `/healthz` explicitly reports `storage: memory`.

`POST /v1/route` ignores its coordinates and returns the illustrative GSU fixture, with an
`X-Stage-0-Stub` response header. It does not evaluate hazards or call Valhalla.
Database transactions, durable idempotency, real route planning and production health checks are
Lane C work in milestones 1–2. Contracts remain frozen after the stage 0 handoff.

With a dedicated local/demo instance and the same publisher key in the CLI environment:

```sh
python3 contracts/scripts/smoke_product.py
```

This creates a demo manual report and exercises automatic publication over HTTP. It does not
require the observation service, collector, or detector.
