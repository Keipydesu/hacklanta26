# Lane 0: Contracts and stubs

Runs first, alone. Its output is what lets seven other lanes work at the same time, so favor finishing fast over polish.

**Owns:** `contracts/`, `backend/app/schemas.py`, and the first skeleton commit of every other folder. After this lane merges, the other lanes take over their folders.

## What to build

1. **API spec.** Write `contracts/openapi.yaml` (OpenAPI 3.1) covering every endpoint in ARCHITECTURE.md section 5. Define these schemas: `Event`, `EventBatch`, `Point`, `PointBatch`, `IngestResult`, `HazardProperties`, `CellProperties`, `LatLon`, `RouteRequest`, `Route`, `RouteResponse`, `ReportRow`, and GeoJSON `FeatureCollection` wrappers.
2. **WebSocket spec.** Write `contracts/ws-messages.md` with the two server-to-client messages.
3. **Fixtures.** In `contracts/fixtures/`, all located around GSU (33.7531, -84.3853):
   - `events.json`: about 30 events, including one tight cluster of hard brakes.
   - `hazards.geojson`: two hazards, one `braking` and one `abandoned`.
   - `cells.geojson`: a few dozen H3 resolution 11 cells, some flagged abandoned.
   - `route.json`: one response with a shortest and a safest route that visibly differ.
   - `report.json`: the two hazards as ranked rows.
4. **Backend skeleton.**
   - `backend/pyproject.toml` with fastapi, uvicorn[standard], pydantic 2, sqlalchemy[asyncio], asyncpg, geoalchemy2, h3 (version 4), httpx, shapely, pytest, pytest-asyncio.
   - `backend/app/schemas.py`: Pydantic models that mirror the spec exactly.
   - `backend/app/main.py`: app, CORS open to all origins, routers mounted under `/v1`.
   - One router file per endpoint group in `backend/app/api/`, each returning its fixture.
   - `backend/app/risk/__init__.py` and `backend/app/routing/__init__.py` with the stub signatures from ARCHITECTURE.md section 6. `recompute` returns an empty list; `plan` returns `route.json`.
5. **Mobile skeleton.** `npx create-expo-app mobile` (TypeScript, expo-router). Add `expo-sensors`, `expo-location`, `expo-keep-awake`, `expo-crypto`, `react-native-maps`, `@react-native-async-storage/async-storage`. Add a `test` script that runs plain TypeScript tests. Create `mobile/src/detection/index.ts` exporting the section 6 interface with a detector that never fires.
6. **Dashboard skeleton.** `npm create vite@latest dashboard -- --template react-ts`, add `maplibre-gl`. One page that loads `hazards.geojson` from the API and logs it.
7. **Generated types.** Run `npx openapi-typescript contracts/openapi.yaml -o <path>` for `mobile/src/api/types.gen.ts` and `dashboard/src/api/types.gen.ts`. Add an npm script for it in each project.
8. **Local stack.** `infra/docker-compose.yml` with `db` (`postgis/postgis:16-3.4`) and `api`. Lane G extends it later.
9. **Housekeeping.** Root `.gitignore` (node_modules, .venv, .env, dist, .expo, valhalla tile output) and a five-line quick start in `README.md`.

## Watch out for

- GeoJSON coordinates are `[lon, lat]`. Plain objects use `lat` and `lon` keys. Mixing these up is the most common bug in the whole project, so get the fixtures right.
- Fixture events need valid UUIDs and at least two distinct `ride_id` values inside the cluster, or Lane D's clustering rules reject it.
- Do not design beyond section 5. Any endpoint you add becomes work for three other lanes.

## Done when

- `uvicorn app.main:app` boots and every section 5 endpoint returns its fixture.
- `docker compose -f infra/docker-compose.yml up` starts `api` and `db`.
- The Expo app and the dashboard both start and can fetch `/v1/hazards`.
- Generated types exist in both front ends.
- Merged to `main` and announced, so the other lanes can branch.
