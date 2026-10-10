# Lane C: Backend API and data

Receives events and points, stores them, serves the read endpoints, and pushes live updates.

**Owns:** `backend/app/api/`, `backend/app/db/`, `backend/app/main.py`, `backend/app/config.py`, `backend/pyproject.toml`, `backend/tests/api/`.
**Calls:** `risk.recompute` and `routing.plan` from Lane D.

## What to build

1. **Database schema** (`db/models.py`, `db/init.sql`). Create tables at startup; skip migrations for the hackathon.

   | Table | Columns |
   |---|---|
   | `events` | `id uuid pk`, `ride_id uuid`, `type text`, `ts timestamptz`, `geom geometry(Point,4326)`, `accuracy_m`, `speed_before_mps`, `speed_after_mps`, `peak_g`, `duration_ms`, `source text`, `h3 text`, `created_at` |
   | `points` | `id bigserial pk`, `ride_id uuid`, `ts timestamptz`, `geom geometry(Point,4326)`, `speed_mps`, `accuracy_m`, `h3 text` |
   | `hazards` | `id uuid pk`, `kind text`, `score real`, `event_count int`, `ride_count int`, `first_seen`, `last_seen`, `label text`, `geom geometry(Polygon,4326)`, `updated_at` |
   | `cells` | `h3 text pk`, `rides_recent_per_day real`, `rides_baseline_per_day real`, `abandoned bool`, `risk real`, `geom geometry(Polygon,4326)` |

   Indexes: GiST on every `geom`, btree on `events.ts`, btree on `points (h3, ts)`. Lane C writes `events` and `points`. Lane D writes `hazards` and `cells`.
2. **Ingest.**
   - `POST /v1/events`: validate, compute `h3` with `h3.latlng_to_cell(lat, lon, 11)`, bulk insert with `ON CONFLICT (id) DO NOTHING`. Return `{ "accepted": n, "duplicates": m }`. Cap a batch at 500.
   - `POST /v1/rides/{ride_id}/points`: same pattern, cap at 2000.
   - Reject out-of-range coordinates with 422. Keep the client `ts` as sent.
3. **Read endpoints.** `bbox` is `minLon,minLat,maxLon,maxLat`. Filter with `geom && ST_MakeEnvelope(...)`. Return GeoJSON built with `ST_AsGeoJSON`.
   - `GET /v1/events`: optional `since` (ISO time), newest first, limit 2000.
   - `GET /v1/hazards`: all hazards in the box.
   - `GET /v1/cells`: all cells in the box.
4. **Route.** `POST /v1/route`: load hazards within a box around origin and destination padded by 500 m, call `routing.plan`, return its result.
5. **Report.** `GET /v1/report/top`: hazards ordered by score descending as `ReportRow` (rank, hazard id, kind, score, counts, last seen, centroid lat and lon, label).
6. **WebSocket** (`api/live.py`). Keep a set of connections. Broadcast `event.created` for each newly accepted event, but only when its `ts` is within the last 5 minutes, so a two-week seed load does not flood the dashboard. Drop dead connections quietly.
7. **Recompute scheduling.** After any ingest, schedule `risk.recompute` about 2 s later. Restart the timer if more data arrives. Run one recompute at a time. After it finishes, compare the hazards with the previous result and broadcast `hazards.updated` only if something changed.
8. **Health and config.** `GET /healthz` runs `SELECT 1`. `config.py` reads `DATABASE_URL`, `VALHALLA_URL`, `DEMO_MODE` from the environment.
9. **Tests** (`tests/api/`). Against the compose Postgres: ingest then read back, duplicate ids, bbox filtering, WebSocket receives an event, old events are not broadcast.

## Watch out for

- PostGIS points are `ST_MakePoint(lon, lat)`. Longitude first.
- The simulator posts tens of thousands of points. Use bulk inserts, not one statement per row.
- Recompute must not block ingest. Run it as a background task with its own session.
- Lane D's functions are stubs at first. Build against the stubs and do not reach into Lane D's folders.
- Stretch only: an `X-Ingest-Key` header and a per-IP rate limit to answer the "what about spam" question.

## Done when

- Every section 5 endpoint returns real data from Postgres.
- Posting the same event twice counts one accepted and one duplicate.
- A connected WebSocket client sees a new event in under a second.
- Loading the simulator's baseline scenario finishes in under a minute.
