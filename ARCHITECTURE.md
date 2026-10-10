# Architecture and agent work split

Campus scooter safety map: phones detect hard braking, the backend clusters those events into hazard zones, and routing steers around them. This file is the single source of truth for who owns what. Every agent reads it before touching code, then reads its own file in `docs/lanes/` for the step-by-step work.

## 1. System at a glance

```
 phone (Expo)                      Vultr instance (docker compose)
┌──────────────────┐   HTTPS    ┌──────────────────────────────────────┐
│ sensors → detect │──events──▶ │ FastAPI ──▶ Postgres + PostGIS       │
│ map + route UI   │◀─hazards── │    │                                 │
└──────────────────┘◀─routes─── │    ├─ risk: cluster events → hazards │
                                │    └─ routing ──▶ Valhalla (OSM)     │
 dashboard (web) ◀──WebSocket── │ Caddy: TLS + serves dashboard build  │
 simulator ────events/points──▶ └──────────────────────────────────────┘
```

Three decisions that keep the build small:

- **Detection runs on the phone.** Only events and 1 Hz location points leave the device, never raw IMU streams.
- **Aggregation uses H3 hex cells (resolution 11, roughly 25 m edges), not map-matched road segments.** No map matching anywhere in the system.
- **Safest route = Valhalla route with hazard polygons passed as `exclude_polygons`.** Shortest route = same request without them.

## 2. Repository layout

```
hacklanta26/
├── ARCHITECTURE.md            this file
├── contracts/                 FROZEN after phase 0 (section 4)
│   ├── openapi.yaml
│   ├── ws-messages.md
│   └── fixtures/              events.json, hazards.geojson, cells.geojson, route.json, report.json
├── mobile/                    Expo app (TypeScript)
│   ├── app/                   screens: index (map), ride, route
│   └── src/
│       ├── detection/         pure TS, no React Native imports      [Lane B]
│       ├── sensors/           DeviceMotion + Location subscriptions
│       ├── api/               typed client, offline queue
│       ├── map/               map layers, route polylines
│       └── privacy/           trip start/end trimming
├── backend/                   FastAPI (Python 3.12)
│   ├── app/
│   │   ├── main.py
│   │   ├── config.py
│   │   ├── schemas.py         Pydantic models mirroring contracts/   FROZEN
│   │   ├── db/                models, session, init.sql
│   │   ├── api/               events, rides, hazards, cells, route, report, live
│   │   ├── risk/              cluster, scoring, abandonment          [Lane D]
│   │   └── routing/           valhalla client, planner, fallback     [Lane D]
│   ├── tests/
│   ├── pyproject.toml
│   └── Dockerfile
├── dashboard/                 Vite + React + MapLibre GL JS
│   └── src/                   LiveMap, HazardTable, RouteCompare, Report
├── simulator/                 Python: synthetic rides, replay, seeding
│   ├── generate.py
│   ├── replay.py
│   ├── scenarios/             routes, baseline, pothole, closure, demo_seed (YAML)
│   └── recorded/              real rides captured at GSU (CSV)
├── infra/
│   ├── docker-compose.yml     api, db, valhalla, caddy
│   ├── valhalla/              build_tiles.sh, custom_files/ (not in git)
│   ├── vultr/                 cloud-init.yaml, deploy.sh
│   ├── Caddyfile
│   ├── reset_db.sh, seed_demo.sh
│   └── .env.example
└── docs/
    ├── lanes/                 one work breakdown per lane            FROZEN
    └── pitch.md, demo-script.md
```

## 3. Lanes

Each lane owns a set of paths. An agent edits only its own paths. The full task list for each lane is in `docs/lanes/`:

[0 Contracts](docs/lanes/0-contracts.md) · [A Mobile](docs/lanes/A-mobile.md) · [B Detection](docs/lanes/B-detection.md) · [C Backend API](docs/lanes/C-backend-api.md) · [D Risk and routing](docs/lanes/D-risk-routing.md) · [E Dashboard](docs/lanes/E-dashboard.md) · [F Simulator](docs/lanes/F-simulator.md) · [G Infra](docs/lanes/G-infra.md)

| Lane | Owns | Builds | Consumes |
|---|---|---|---|
| **0. Contracts** (runs first, alone) | `contracts/`, `backend/app/schemas.py`, stubs in every other lane | API spec, fixtures, a backend that boots and returns fixtures | nothing |
| **A. Mobile app** | `mobile/` except `mobile/src/detection/` | Ride start/stop, sensor subscriptions, map with hazards, safe-vs-short route screen | Lane B's `createDetector`, REST API |
| **B. Detection** | `mobile/src/detection/` | Brake and bump detection as pure functions, with tests on recorded CSVs | `simulator/recorded/` (read only) |
| **C. Backend API and data** | `backend/app/api/`, `backend/app/db/`, `backend/app/main.py`, `backend/app/config.py`, `backend/pyproject.toml`, `backend/tests/api/` | Ingest, read endpoints, WebSocket fan-out, DB schema | Lane D's `risk.recompute` and `routing.plan` |
| **D. Risk and routing** | `backend/app/risk/`, `backend/app/routing/`, `backend/tests/risk/`, `backend/tests/routing/` | Hazard clustering, cell scoring, abandonment detection, Valhalla planner | DB tables from Lane C, Valhalla from Lane G |
| **E. Dashboard** | `dashboard/` | Live map for the projector, top-10 hazards table for facilities, route comparison | REST API, WebSocket |
| **F. Simulator and seed data** | `simulator/` | Synthetic rides with backdated timestamps, replay of recorded rides, demo scenarios | REST API |
| **G. Infra and Vultr** | `infra/`, `backend/Dockerfile`, `README.md`, `.github/` | Compose stack, Valhalla tiles for Atlanta, Vultr deploy, TLS | everything, as containers |

With fewer than seven agents, merge B into A and F into G. Do not merge C and D: they are the two largest lanes.

## 4. Phase 0: contracts and stubs (one agent, before any fan-out)

Nothing else starts until this lands on `main`. Done when:

1. `contracts/openapi.yaml` describes every endpoint in section 5.
2. `contracts/fixtures/` has one realistic sample per response, located around GSU (33.7531, -84.3853).
3. `backend/` boots with `uvicorn app.main:app` and every endpoint returns its fixture.
4. `backend/app/risk/__init__.py` and `backend/app/routing/__init__.py` contain the stub signatures from section 6.
5. `mobile/src/detection/index.ts` exports the stub interface from section 6.
6. `infra/docker-compose.yml` starts `api` and `db` locally.
7. TypeScript types are generated into `mobile/src/api/types.gen.ts` and `dashboard/src/api/types.gen.ts` with `npx openapi-typescript contracts/openapi.yaml`.

After this, every lane can develop against fixtures without waiting on any other lane.

## 5. HTTP and WebSocket contract

Base path `/v1`. JSON everywhere. Coordinates are WGS84; GeoJSON uses `[lon, lat]` order, plain objects use `lat` / `lon` keys.

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/v1/events` | Ingest a batch of detected events |
| `POST` | `/v1/rides/{ride_id}/points` | Ingest a batch of 1 Hz location points |
| `GET` | `/v1/events?bbox=&since=` | Recent events as GeoJSON points (heatmap source) |
| `GET` | `/v1/hazards?bbox=` | Hazard zones as GeoJSON polygons |
| `GET` | `/v1/cells?bbox=` | H3 cells with traffic and abandonment flags |
| `POST` | `/v1/route` | Shortest and safest route between two points |
| `GET` | `/v1/report/top?limit=10` | Ranked hazards for the facilities view |
| `GET` | `/healthz` | Liveness |
| `WS` | `/v1/live` | Server push of new events and hazard changes |

**Event** (items of `POST /v1/events` body `{ "events": [...] }`):

```json
{
  "id": "uuid, client generated, used for idempotency",
  "ride_id": "uuid, random per ride, never tied to a person",
  "type": "hard_brake | bump",
  "ts": "2026-10-10T01:23:45.123Z",
  "lat": 33.7531,
  "lon": -84.3853,
  "accuracy_m": 6.5,
  "speed_before_mps": 5.8,
  "speed_after_mps": 1.2,
  "peak_g": 0.52,
  "duration_ms": 640,
  "source": "device | simulated | replay"
}
```

The server trusts the client `ts`. The simulator depends on this to backdate two weeks of baseline traffic.

Both ingest endpoints answer `{ "accepted": 12, "duplicates": 0 }`. An `id` seen before counts as a duplicate, not an error.

**`bbox`** on every `GET` is `minLon,minLat,maxLon,maxLat`.

**Points** (`POST /v1/rides/{ride_id}/points` body):

```json
{ "points": [ { "ts": "...", "lat": 33.75, "lon": -84.38, "speed_mps": 4.9, "accuracy_m": 5.0 } ] }
```

**Hazard** (feature in `GET /v1/hazards`): Polygon geometry with properties

```json
{
  "id": "uuid",
  "kind": "braking | surface | abandoned",
  "score": 0.82,
  "event_count": 14,
  "ride_count": 9,
  "first_seen": "...",
  "last_seen": "...",
  "label": "Hard braking near Courtland St crossing"
}
```

**Cell** (feature in `GET /v1/cells`): Polygon geometry with properties `h3`, `rides_recent_per_day`, `rides_baseline_per_day`, `abandoned` (bool), `risk` (0 to 1).

**Route** (`POST /v1/route`): request `{ "origin": {"lat":..,"lon":..}, "destination": {"lat":..,"lon":..} }`, response

```json
{
  "routes": [
    { "kind": "shortest", "geometry": { "type": "LineString", "coordinates": [] },
      "distance_m": 640, "duration_s": 150, "risk_score": 0.61, "hazard_ids": ["..."] },
    { "kind": "safest", "geometry": { "type": "LineString", "coordinates": [] },
      "distance_m": 710, "duration_s": 168, "risk_score": 0.08, "hazard_ids": [] }
  ],
  "safest_available": true
}
```

**Report row** (items of `GET /v1/report/top`): `rank`, `hazard_id`, `kind`, `score`, `event_count`, `ride_count`, `last_seen`, `lat`, `lon` (centroid), `label`.

`hazard_ids` lists hazards the route passes through. If excluding hazards leaves no path, return the shortest route twice with `safest_available: false`.

**WebSocket messages** (server to client only):

```json
{ "type": "event.created", "data": { "...Event" } }
{ "type": "hazards.updated", "data": { "type": "FeatureCollection", "features": [] } }
```

## 6. In-process interfaces

These are the seams between lanes that share a language. Signatures are fixed in phase 0.

**Detection (Lane B exports, Lane A calls)**, `mobile/src/detection/index.ts`:

```ts
export interface MotionSample {
  t: number;                                   // ms since epoch
  accel: { x: number; y: number; z: number };  // m/s², gravity removed, device frame
  gravity: { x: number; y: number; z: number };// m/s², device frame
}
export interface LocationFix {
  t: number; lat: number; lon: number;
  speedMps: number | null; accuracyM: number | null;
}
export interface DetectedEvent {
  type: 'hard_brake' | 'bump';
  t: number; lat: number; lon: number; accuracyM: number;
  speedBeforeMps: number; speedAfterMps: number;
  peakG: number; durationMs: number;
}
export interface Detector {
  pushMotion(s: MotionSample): void;
  pushLocation(f: LocationFix): void;
  onEvent(cb: (e: DetectedEvent) => void): () => void;
  reset(): void;
}
export function createDetector(config?: Partial<DetectorConfig>): Detector;
```

`DetectorConfig` holds the thresholds from section 7 plus a `demoMode` flag, and is defined by Lane B. Lane A computes `gravity` as `accelerationIncludingGravity - acceleration` from Expo `DeviceMotion` at 50 Hz. Axis sign conventions differ between iOS and Android, so check both on a real device.

**Risk and routing (Lane D exports, Lane C calls)**:

```python
# backend/app/risk/__init__.py
async def recompute(session: AsyncSession) -> list[Hazard]:
    """Rebuild hazards and cell stats from events and points. Idempotent."""

# backend/app/routing/__init__.py
async def plan(origin: LatLon, destination: LatLon, hazards: list[Hazard]) -> RouteResponse:
    """Return shortest and safest routes."""
```

Lane C calls `risk.recompute` on a debounce (about 2 s after the last ingest) and broadcasts `hazards.updated` when the result changes.

**Tables.** Lane C defines all four tables (`events`, `points`, `hazards`, `cells`) and writes the first two. Lane D writes `hazards` and `cells`.

## 7. Algorithms (starting values, tune on real rides)

**Hard brake (Lane B).** Phone orientation is unknown, so avoid needing it:

1. Horizontal acceleration = `accel` minus its projection onto `gravity`. Take the magnitude and smooth it over 200 ms.
2. Candidate when the smoothed magnitude stays at or above 0.35 g for 300 ms or longer.
3. Confirm as braking when GPS speed was at least 3 m/s before and fell by at least 2 m/s within 2 s. The speed drop is what separates braking from accelerating or swerving.
4. Drop fixes with accuracy worse than 20 m. Refractory period of 3 s between events.

**Bump (Lane B).** Acceleration along `gravity` spikes by at least 1 g for under 150 ms while speed is at least 2 m/s.

**Hazard clustering (Lane D).** Project events to EPSG:32616 (UTM 16N, covers Atlanta). `ST_ClusterDBSCAN` with eps 12 m and min 3 points, keeping clusters with at least 2 distinct `ride_id`. Score is a time-decayed count with a 7-day half-life: `min(1, sum(0.5 ** (age_days / 7)) / 5)`. Polygon is the cluster hull buffered by 8 m. `hard_brake` clusters become `kind: braking`, `bump` clusters become `kind: surface`.

**Abandonment (Lane D).** Count distinct rides per H3 cell per day from points. Baseline is the daily mean over days 3 to 14 ago; recent is the last 48 hours. Flag a cell when baseline is at least 5 rides per day, recent is under 30% of baseline, and some cell within 2 rings is over 130% of its own baseline. Merge adjacent flagged cells into one `kind: abandoned` hazard.

**Routing (Lane D).** Valhalla `/route` with `costing: pedestrian`, `walking_speed` set to scooter pace (16 km/h), and a heavy `step_penalty` so stairs are avoided. Campus walkways are mapped as footways, which bicycle costing tends to skip; Lane D confirms the choice on real campus trips. Safest request adds hazards with score at or above 0.4 as `exclude_polygons`. Stretch goal: an OSMnx graph with edge cost `length × (1 + 4 × risk)` for soft penalties instead of hard exclusion.

## 8. Privacy rules (apply in every lane)

- No accounts, no device identifiers. `ride_id` is a fresh random UUID per ride.
- The phone drops the first and last 100 m of every ride before upload (`mobile/src/privacy/`).
- Public endpoints return aggregates and event points only, never a ride's ordered path.
- UI copy says "lower-risk route", never "safe route".

## 9. Configuration

| Variable | Used by | Example |
|---|---|---|
| `DATABASE_URL` | backend | `postgresql+asyncpg://app:app@db:5432/app` |
| `VALHALLA_URL` | backend | `http://valhalla:8002` |
| `DEMO_MODE` | backend | `1` lets a single event form a hazard and be routed around |
| `EXPO_PUBLIC_API_URL` | mobile | `https://<host>` |
| `VITE_API_URL` | dashboard | `https://<host>` |

## 10. Rules for agents

1. Edit only the paths your lane owns (section 3).
2. `contracts/`, `backend/app/schemas.py`, `ARCHITECTURE.md`, and `docs/lanes/` are frozen. If you need a change, stop and write the proposed diff in your hand-off note. A human approves it and it lands as its own commit.
3. Work on branch `lane/<letter>-<name>` and open small pull requests into `main`. Rebase before each PR.
4. Develop against `contracts/fixtures/` until the real upstream exists. Never block on another lane.
5. New dependency: add it only to your own manifest. Lane D adds Python dependencies through a note to Lane C, who owns `backend/pyproject.toml`.
6. Every PR ends with a hand-off note: what works, how to run it, what is stubbed.

**Kickoff prompt template:**

```
You are working on Lane <X> of the repository. Read ARCHITECTURE.md fully first,
then docs/lanes/<your lane file>.md.
You own: <paths from section 3>. Do not edit anything else.
Goal: build every numbered item in your lane file.
Done when: the "Done when" list in your lane file passes.
Use contracts/fixtures/ for any upstream that is not built yet.
Finish with a hand-off note: what works, how to run it, what is stubbed.
```

## 11. Done-when checklists

Short versions. The lane files in `docs/lanes/` are the full versions.

**A. Mobile app**
- Start and stop a ride; while riding, events post to `/v1/events` and points post in batches every 10 s.
- Failed uploads queue and retry.
- Map shows hazards and the event heatmap for the visible area.
- Route screen draws shortest and safest routes with distance and risk for each.
- Runs in Expo Go with the screen on (`react-native-maps`, `expo-sensors`, `expo-location`).

**B. Detection**
- `createDetector` passes unit tests against at least three recorded rides in `simulator/recorded/`.
- With `demoMode` on (GPS speed check off), a phone jerked to a stop by hand triggers exactly one event. This is the indoor demo case.
- No React Native imports, so tests run in plain Node.

**C. Backend API and data**
- All section 5 endpoints return real data from Postgres.
- Duplicate event `id` is ignored, not an error.
- A posted event reaches a connected WebSocket client in under a second.
- `bbox` filters use a PostGIS spatial index.

**D. Risk and routing**
- `recompute` turns the simulator's pothole scenario into exactly one `braking` hazard.
- `recompute` turns the closure scenario into exactly one `abandoned` hazard.
- `plan` returns two visibly different routes across the pothole scenario.
- Tests run without a live Valhalla (recorded responses).

**E. Dashboard**
- Live map shows a new pin within a second of a posted event, readable on a projector.
- Hazard table ranks the top 10 with kind, counts, and last seen; clicking a row flies the map there.
- Route comparison view shows both routes for two clicked points.

**F. Simulator and seed data**
- `generate.py --scenario baseline` posts 14 days of backdated rides around GSU.
- `pothole` and `closure` scenarios produce the hazards Lane D's tests expect.
- `replay.py` posts a recorded ride in real time for the demo.
- All synthetic data carries `source: simulated`.

**G. Infra and Vultr**
- `docker compose up` brings up api, db, valhalla, and caddy locally.
- Valhalla tiles build from a Georgia OSM extract clipped to metro Atlanta.
- One command deploys to a Vultr compute instance with HTTPS.
- Dashboard build is served from the same host.
- Stretch: raw recorded rides in Vultr object storage; managed Postgres.

## 12. Integration order

1. **Stubs up.** Phase 0 merged; backend returns fixtures; dashboard and app render them.
2. **Simulated slice.** Simulator event → API → database → dashboard pin over WebSocket.
3. **Phone slice.** Real phone event appears on the dashboard.
4. **Hazards.** Clustered events show as zones on both maps.
5. **Routing.** Safest route bends around a hazard.
6. **Deployed.** Whole stack on Vultr over HTTPS; phones point at it.
7. **Abandonment and report.** Closure scenario flagged; facilities table filled.

Cut line if time runs short: stop after step 6. Steps 1 to 6 are the demo.

**Demo setup:** seed two `hard_brake` events at one spot (`demo_seed` scenario). With the app in demo mode pinned to that spot, the judge's event becomes the third, a hazard appears, and the safest route bends around it live.
