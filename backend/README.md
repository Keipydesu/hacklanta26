# Product API · persistence, live updates and routing

Two storage modes, chosen by `DATABASE_URL`:

- **Set** (Compose does this): reports, hazards and publication revisions live in PostGIS and
  survive restarts. Pending SQL migrations in `app/db/migrations/` are applied at startup under a
  Postgres advisory lock (or manually: `DATABASE_URL=... uv run --project backend python -m app.db.migrate`).
  `/healthz` returns `storage: postgis` and 503 if the product database is unreachable.
- **Unset**: the stage 0 **single-process, nonpersistent in-memory stub** (`storage: memory`). Use it only
  for fixtures and quick local runs.

Run a single API process: live notifications and the expiry scan are in-process (see the Lane C plan).
Set `VALHALLA_URL` for real routing (pedestrian costing, hazard exclusions, risk scoring from both sources;
503 on engine outage without affecting reports). Unset, `/v1/route` returns the fixed fixture with an
`X-Stage-0-Stub` header. Routing tests replay responses recorded from a real Valhalla
(`tests/routing/fixtures`); they were recorded from a local Valhalla 3.9.1 built from a campus-area OSM extract.
To reproduce: fetch the bbox from Overpass (`-84.40,33.74,-84.37,33.77`), run `valhalla_build_config` +
`valhalla_build_tiles` in the `ghcr.io/valhalla/valhalla` image, serve on :8002, and re-run the recorder.
`alternates-a.json` was recorded the same way with `infra/valhalla/build_tiles.sh` and `"alternates": 2` (Valhalla 3.9.1).

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

Implemented for fixture integration: report retry/conflict, 8 m point-centered buffered polygons, bbox and
expiry filtering, authenticated publication revisions/resolution, source separation, live change
hints, and a fixed route response. In memory mode `/healthz` reports `storage: memory`.

Without `VALHALLA_URL`, `POST /v1/route` ignores its coordinates and returns the illustrative GSU fixture, with an
`X-Stage-0-Stub` response header. It does not evaluate hazards or call Valhalla.
The real routing implementation is selected by `VALHALLA_URL`; its live C4–C5 gates remain separate
from fixture checks. Contracts remain frozen after the stage 0 handoff.

With a dedicated local/demo instance and the same publisher key in the CLI environment:

```sh
python3 contracts/scripts/smoke_product.py
```

This creates a demo manual report and exercises automatic publication over HTTP. It does not
require the observation service, collector, or detector.

## Place search

`GET /v1/places?q=&near=lat,lon` returns up to five places for trip endpoints. It proxies Photon
(`PHOTON_URL`, default `https://photon.komoot.io`; set it empty to disable search with 503) within
the metro-Atlanta routing box. It requires 3-100 characters, rounds `near` to about 100 m, caches
answers for 10 minutes, and turns provider failures into 503. Tests use a mock transport, so no
network is needed. See [decision 020](../docs/decisions/020-trip-address-search-and-current-origin.md).

## Hazard feedback

`POST /v1/hazards/{hazard_id}/feedback` takes `{id, response}`, where `response` is `still_there`
or `gone`. It works in both memory and PostGIS modes, and migration `002_hazard_feedback` adds the
`hazard_feedback` table and `hazards.hidden_at_revision`. The policy is the pure function in
`app/feedback.py`:
- **Manual hazards:** "Still there" extends expiry to now + 24 h, and two consecutive "gone"
  answers resolve the hazard.
- **Automatic hazards:** two consecutive "gone" answers at the current revision hide the hazard
  until the publisher's next newer revision. The publication itself is never edited.

Retries with the same UUID return 200 with `duplicate: true`. Unknown, resolved, expired and hidden
hazards return 404. See [decision 013](../docs/decisions/013-hazard-feedback.md).

## Routing failure and refresh semantics

Only Valhalla's recorded no-path code 442 permits a no-alternative fallback; a baseline no-path
returns 422. Other engine errors, malformed error JSON, and nonfinite route metrics return 503.
A widened search replaces the complete hazard snapshot at the time of that query, removing
resolved, expired, or moved-out hazards. Both candidates use the final snapshot for risk scoring.
See [decision 006](../docs/decisions/006-routing-errors-and-refreshed-hazard-snapshots.md).

Regression checks: `uv run --project backend pytest -c backend/pyproject.toml backend/tests/routing -q`.
These replay recorded responses and lifecycle changes without a live routing engine.

## C3 live manual gate

Conditional database expiry batches, bounded socket sends/closes, post-commit hints and database
readiness are implemented. The database slow-socket regression now invokes its scenario rather
than passing without exercising it. Five focused PostGIS checks passed on 2026-10-10: restart/exact
retry, expired queued reports, expiry/reactivation, database health and post-commit/slow-socket behavior.

The physical two-phone refresh/reconnect rehearsal is **pending**, tracked in
[issue #19](https://github.com/Keipydesu/hacklanta26/issues/19). Follow the
[C3 rehearsal checklist](C3-rehearsal.md); a reachable LAN is sufficient for C3.
Hosted HTTPS and real routing are additional A4/C5 gates. Automated tests do not complete the device gate.
