# Product API · Lane C1/C2 persistence

Two storage modes, chosen by `DATABASE_URL`:

- **Set** (Compose does this): reports, hazards and publication revisions live in PostGIS and
  survive restarts. Pending SQL migrations in `app/db/migrations/` are applied at startup under a
  Postgres advisory lock (or manually: `DATABASE_URL=... uv run --project backend python -m app.db.migrate`).
  `/healthz` returns `storage: postgis` and 503 if the product database is unreachable.
- **Unset**: the stage 0 **single-process, nonpersistent in-memory stub** (`storage: memory`). Use it only
  for fixtures and quick local runs.

Run a single API process: live notifications and the expiry scan are in-process (see the Lane C plan).
Routing is still the fixed fixture until C4–C5.

DB-backed tests need a disposable PostGIS database (the test tables are dropped):

```sh
docker run -d --name pg -e POSTGRES_USER=product -e POSTGRES_PASSWORD=dev -e POSTGRES_DB=product -p 55432:5432 postgis/postgis:16-3.4
TEST_DATABASE_URL=postgresql://product:dev@localhost:55432/product uv run --project backend pytest -c backend/pyproject.toml backend/tests -q
```

Without `TEST_DATABASE_URL`, `tests/test_postgres.py` is skipped.

## Stage 0 notes (memory mode)

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
hints, and a fixed route response. In memory mode `/healthz` reports `storage: memory`.

`POST /v1/route` ignores its coordinates and returns the illustrative GSU fixture, with an
`X-Stage-0-Stub` response header. It does not evaluate hazards or call Valhalla.
Real route planning is Lane C work in milestone 2 (C4–C5). Contracts remain frozen after the stage 0 handoff.

With a dedicated local/demo instance and the same publisher key in the CLI environment:

```sh
python3 contracts/scripts/smoke_product.py
```

This creates a demo manual report and exercises automatic publication over HTTP. It does not
require the observation service, collector, or detector.
