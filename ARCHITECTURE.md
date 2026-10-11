# Architecture and development split

Campus scooter safety map, built manual-first. Riders report hazards like Waze. A separate automatic detection system can later publish hazards through a versioned HTTP API. The manual app must work with the entire automatic system switched off.

The rider UI leads with scooter/bike trip planning, with hazard mapping enriching route choices.
Lime and Waze are the primary design references; see [decision 014](docs/decisions/014-scooter-bike-first-ui.md).
The map fills the screen with compact supporting controls; see [decision 015](docs/decisions/015-map-first-mobile-controls.md).
Editing a trip endpoint expands search over the map above the keyboard; see
[decision 027](docs/decisions/027-expanded-trip-search.md).
Home exposes a destination input and floating recenter/report controls, without task tabs
([decision 029](docs/decisions/029-minimal-map-home.md)).
Task sheets use native slide motion; reporting fits its content and headings have no Done button
([decision 031](docs/decisions/031-smooth-compact-task-sheet.md)).
This changes presentation priority, not the delivery sequence or supported routing modes.

This is the target product design. Stage 0 now implements its contracts and nonpersistent skeletons, not production persistence, sensing or routing; see [the handoff](docs/STAGE-0-HANDOFF.md). It supersedes the original sensor-first mobile design. The monitoring web app remains out of scope.

## 1. System at a glance

```text
TRACK 1: USER PRODUCT                   SHARED PLATFORM
Expo mobile app ── manual reports ────▶ FastAPI hazard API
  map / report / route ◀──────────────  unified hazard feed + routing
                                             │
                                       Postgres + PostGIS
                                             ▲
TRACK 2: AUTOMATIC SYSTEM                     │ authenticated HTTP
sensor collector → detector → hazard worker ──┘
                         own observation storage
```

- **Track 1 ships first:** obtain current device location, submit a hazard, see it on the map, compare routes. Trip includes foreground live position and camera follow (decision 024); no motion sensing or ride recording is required.
- **Track 2 develops independently:** record or replay sensor data, detect events, cluster them into hazards, publish those hazards through the shared API.
- **One display contract:** the app reads manual and automatic hazards from the same endpoint and labels their origin. It does not import detection code.
- **One integration boundary:** automatic workers use HTTP to publish; they never write directly to the product database. A sample HTTP request must demonstrate this connection before real detection exists.
- **Independent deployment:** automatic processing can stop without interrupting manual reporting, hazard reads, or routing. Optional future sensor integration into the rider app is outside the first release.

## 2. Repository layout

```text
contracts/                       OpenAPI specs, generated-type inputs, fixtures
  openapi.yaml                   shared product API
  automatic.openapi.yaml         collector-to-automation API
  ws-messages.md                 product live-update contract
  fixtures/                      manual reports, combined hazards, routes, sensor data
mobile/                          Track 1: Expo + TypeScript [A]
  app/                           map, report, hazard detail, route
  src/api/                       generated types, client, offline report queue
  src/map/                       hazard polygons and routes
backend/                         Shared platform: FastAPI [C]
  app/api/                       manual reports, automatic publication, hazards, route, live
  app/db/                        manual_reports and hazards
  app/schemas.py                 generated/contract-aligned schemas [0]
  app/routing/                   Valhalla client and planner [C]
  bike_lanes/                    OSM campus bike-lane export and GeoJSON [C]
  tests/api/                     [C]
  tests/routing/                  [C]
automatic/                       Track 2: standalone subsystem
  detector/                      pure TypeScript signal detection [B]
  collector/                     separate Expo sensor/recorder test app [B]
  service/                       FastAPI ingestion, private DB, risk worker, publisher [D]
  tests/                         worker and publisher tests [D]
simulator/                       manual fixtures, synthetic rides, replay [F]
infra/                           Compose, Vultr deployment, TLS [G]
docs/lanes/                      work breakdowns
```

The automatic service owns an observation database (`events`, `points`, `cells`, `derived_hazards`, `outbox`). For the demo it can share a PostgreSQL server with the product database, but uses a separate database and credentials. These databases contain different data; they are not redundancy replicas. The automatic service has no product database credentials.

## 3. Ownership and parallel development

| Lane | Owns | Deliverable |
|---|---|---|
| [0 Contracts](docs/lanes/0-contracts.md) | `contracts/`, `backend/app/schemas.py`, initial skeletons | Agree on requests, responses, fixtures, and stub servers first |
| [A Mobile](docs/lanes/A-mobile.md) | `mobile/` | Manual reporting app; uses only the product API |
| [B Detection](docs/lanes/B-detection.md) | `automatic/detector/`, `automatic/collector/` | Sensor collection, local signal detection, recorder; uses automation ingestion API |
| [C Backend](docs/lanes/C-backend-api.md) | `backend/` except schemas and Dockerfile | Manual reports, automatic publication API, unified feed, routing, live updates |
| [D Automatic hazards](docs/lanes/D-automatic-hazards.md) | `automatic/service/`, `automatic/tests/` | Independent observation API, hazard worker and publisher |
| [F Simulator](docs/lanes/F-simulator.md) | `simulator/` | Manual and automatic scenarios; API-only integration tests |
| [G Infra](docs/lanes/G-infra.md) | `infra/`, `backend/Dockerfile`, `automatic/Dockerfile`, `README.md`, `.github/` | Manual stack plus optional automation deployment |

The unused lane letter E is intentionally skipped after removal of the web dashboard. Group A+C as the manual product and B+D as automation, with contracts, simulation and infrastructure shared. Lane C owns routing so the manual track can ship without work from the automatic track. Develop against fixtures until each real API is available.

## 4. Contracts first

1. Define the product API in section 5 and automation ingestion API in section 6, including errors, examples, UUIDs, source labels, and expiry semantics.
2. Provide fixtures for a manual report, an automatic publication, the combined hazard feed, and route responses around GSU (33.7531, -84.3853).
3. Boot a product API that accepts a manual report and an automatic fixture into an in-memory stub store and returns both. Label stub storage as nonpersistent.
4. Create a mobile skeleton with map/report/route screens and generated product API types. Create separate automation skeletons and types; no detector dependency or motion permission in `mobile/`.
5. Start API + product DB locally. Automation stubs run separately and are not a startup dependency. Once contracts land, lanes develop against fixtures independently.

## 5. Shared product HTTP and live-update contract

JSON over HTTPS. Version prefix `/v1`. Coordinates are WGS84: objects use `lat`/`lon`; GeoJSON uses `[lon, lat]`. `bbox` is `minLon,minLat,maxLon,maxLat`. Invalid payloads return 422.

| Method | Path | Purpose |
|---|---|---|
| POST | `/v1/reports` | Create a user-submitted report and its map hazard |
| PUT | `/v1/automatic/hazards/{external_id}` | Publish or update an automatically derived hazard |
| GET | `/v1/hazards?bbox=` | Active, unexpired manual and automatic hazards as one GeoJSON FeatureCollection |
| GET | `/v1/places?q=&near=` | Address/place search for trip endpoints, proxied to Photon within the routing area ([decision 020](docs/decisions/020-trip-address-search-and-current-origin.md)) |
| POST | `/v1/hazards/{hazard_id}/feedback` | Rider answer to "Is this hazard still there?" ([decision 013](docs/decisions/013-hazard-feedback.md)) |
| POST | `/v1/route` | Shortest and lower-risk routes using the same combined feed |
| WS | `/v1/live` | Notify phones that hazards changed |
| GET | `/healthz` | Product API/database health, independent of automation |

### Manual submission

`POST /v1/reports`:

```json
{
  "id": "ed58ed39-e3c5-4d91-a2b1-1c7d8a366aef",
  "kind": "pothole",
  "lat": 33.7531,
  "lon": -84.3853,
  "observed_at": "2026-10-10T01:23:45Z",
  "description": "Pothole beside the crossing"
}
```

Kinds: `pothole | obstruction | closure | other`. Description is optional, plain text, at most 280 characters. No ride ID, speed, sensor measurements, account, or automatic service is required. The server assigns `source: manual`, an 8 m buffered polygon, a provisional routing weight `score: 0.5`, and expiry 24 hours after observation. This is a community report, not a verified finding; score is a routing heuristic, not a probability. These initial defaults are tunable.

New report: 201 with `{ "report_id": "uuid", "hazard_id": "uuid", "duplicate": false }`. Same ID and payload: 200 with the original IDs and `duplicate: true`; conflicting reuse: 409. A transaction writes the report and hazard together. An already-expired queued report is stored but omitted from the active feed. Reject observation timestamps more than five minutes in the future.

### Automatic publication: the connection between tracks

`PUT /v1/automatic/hazards/{external_id}`:

```json
{
  "revision": 1,
  "kind": "braking",
  "geometry": {
    "type": "Polygon",
    "coordinates": [[[-84.3854,33.7530],[-84.3852,33.7530],[-84.3852,33.7532],[-84.3854,33.7532],[-84.3854,33.7530]]]
  },
  "score": 0.72,
  "event_count": 8,
  "ride_count": 4,
  "first_seen": "2026-10-10T01:00:00Z",
  "last_seen": "2026-10-10T01:23:45Z",
  "expires_at": "2026-10-11T01:23:45Z",
  "status": "active",
  "label": "Repeated hard braking near the crossing",
  "evidence_source": "device"
}
```

The worker uses `Authorization: Bearer <AUTOMATION_PUBLISH_KEY>`. Keep this credential on the worker, never in the mobile app or sensor collector. Missing/invalid credentials return 401. Start with one configured publisher; the server derives its identity from the credential, not the body.

`external_id` is a stable UUID owned by that publisher. Kinds: `braking | surface | abandoned`. Evidence source: `device | simulated | replay | mixed`. Score must be 0–1, geometry a valid nonempty polygon, counts nonnegative, and `first_seen <= last_seen <= expires_at`. The server stamps `source: automatic` and maintains its own public hazard UUID.

New publication returns 201; a newer revision updates the existing hazard and returns 200. Response: `{ "hazard_id": "uuid", "revision": 1, "duplicate": false }`. Same revision with identical payload returns 200 and `duplicate: true`; an older revision or conflicting same-revision body returns 409. Persist revision numbers and increment only when publishing changed state. A resolved hazard uses the same complete payload with a higher revision and `status: resolved`. The publisher must retry durable queued updates after outages.

### Combined hazard response and lifecycle

Each GeoJSON polygon has properties: `id`, `source` (`manual | automatic`), `kind`, `label`, `score`, `status`, `first_seen`, `last_seen`, `expires_at`, `event_count`, `ride_count`, `report_count`, `evidence_source` (null for manual). Manual reports have `report_count: 1` and zero sensor counts; automatic hazards have `report_count: 0`.

Both sources are visible on the same map; use explicit labels “Community report” and “Automatically detected.” Keep separate records even when they overlap; cross-source merging is a later feature. Rider "still there / no longer there" feedback follows [decision 013](docs/decisions/013-hazard-feedback.md): it can extend or resolve manual hazards and can hide an automatic hazard until its next newer revision, without editing the publication. Reads and routing filter expiry at request time, even if cleanup is delayed. The server publishes expiry changes, and the app also hides a hazard when its expiry time passes.

Live message: `{ "type": "hazards.changed", "data": { "hazard_id": "uuid" } }`. On receipt, debounce and refetch the visible bounds; also refetch on reconnect. Emit after committed creates, updates, resolutions, feedback-driven changes, and expiry. There is no public raw event feed required by the manual app.

### Routing

Request: `{ "origin": {"lat":33.7531,"lon":-84.3853}, "destination": {"lat":33.7560,"lon":-84.3880} }`.

Response: `{ "routes": [...], "safest_available": true }`. Each route has `kind` (`shortest | safest`), GeoJSON LineString `geometry`, `distance_m`, `duration_s`, `risk_score`, and `hazard_ids`. UI copy always says “lower-risk.” Offline/example route geometry is never shown as directions for selected endpoints (decision 024). If hazard exclusion leaves no route, return the shortest under both kinds with `safest_available: false`. An optional `alternatives` array carries up to two other roads (`kind: alternative`), scored the same way ([decision 026](docs/decisions/026-route-alternatives.md)). Return 503 if routing itself is unavailable; reporting and map reads continue working.

## 6. Automatic subsystem contracts

The automation service has a separate base URL. It owns event ingestion, observation storage, clustering, and its publisher. The product API never imports or calls its risk worker.

| Method | Automation path | Purpose |
|---|---|---|
| POST | `/v1/events` | Batch of detected brake/bump events |
| POST | `/v1/rides/{ride_id}/points` | Batch of location points for traffic analysis |
| GET | `/healthz` | Automation service health |

Event body: `{ "events": [...] }`, maximum 500. Each event has UUID `id`, UUID `ride_id`, `type` (`hard_brake | bump`), `ts`, `lat`, `lon`, `accuracy_m`, `speed_before_mps`, `speed_after_mps`, `peak_g`, `duration_ms`, and `source` (`device | simulated | replay`). Points body: `{ "points": [...] }`, maximum 2000; each point has UUID `id`, `ts`, `lat`, `lon`, `speed_mps`, `accuracy_m`, and `source`. UUIDs make both queues retryable. Repeated IDs with identical payloads count as duplicates; conflicting payloads return 409 and reject the batch atomically. Ingest response: `{ "accepted": 12, "duplicates": 0 }`. Invalid values return 422. Client timestamps can be backdated for simulation; reject timestamps more than five minutes in the future.

Lane B's `automatic/detector/index.ts` exports `createDetector(config?)`, returning `pushMotion`, `pushLocation`, `onEvent`, and `reset`. Motion samples carry epoch-ms time, gravity-removed acceleration and gravity vectors; location fixes carry time, lat/lon, nullable speed and accuracy. Detected events carry type, time, location, accuracy, speeds, peak g and duration. This interface is internal to the automatic track, never a dependency of Lane A.

Lane B's separate collector owns 50 Hz motion, 1 Hz GPS, local detection, 100 m endpoint trimming, offline queues, CSV recording, and a clearly marked indoor demo mode. Raw motion is recorded locally only. Demo mode supplies fixed coordinates and bypasses speed/trim checks only for synthetic demonstrations.

Lane D's worker recomputes private derived hazards after ingestion and periodically for decay/expiry. It atomically records changed hazards plus pending publications in an outbox, then sends them to the product API with stable IDs and monotonic revisions. Retry temporary failures; reconcile 409 responses rather than retrying stale revisions forever. Resolve disappeared clusters with a higher revision. Active publications expire 24 hours after the worker's latest evaluation and refresh before expiry only while evidence still qualifies. If automation stops, its hazards eventually expire; manual reporting continues.

Product routing remains in `backend/app/routing/` and exposes `async plan(origin, destination, hazards) -> RouteResponse`. It reads the supplied combined hazards only, with no dependency on the automatic service.

## 7. Algorithms (starting values, tune on real rides)

**Hard brake (Lane B).** Phone orientation is unknown, so avoid needing it:

1. Horizontal acceleration = `accel` minus its projection onto `gravity`. Take the magnitude and smooth it over 200 ms.
2. Candidate when the smoothed magnitude stays at or above 0.35 g for 300 ms or longer.
3. Confirm as braking when GPS speed was at least 3 m/s before and fell by at least 2 m/s within 2 s. The speed drop is what separates braking from accelerating or swerving.
4. Drop fixes with accuracy worse than 20 m. Refractory period of 3 s between events.

**Bump (Lane B).** Acceleration along `gravity` spikes by at least 1 g for under 150 ms while speed is at least 2 m/s.

**Hazard clustering (Lane D).** Project events to EPSG:32616 (UTM 16N, covers Atlanta). `ST_ClusterDBSCAN` with eps 12 m and min 3 points, keeping clusters with at least 2 distinct `ride_id`. Score is a time-decayed count with a 7-day half-life: `min(1, sum(0.5 ** (age_days / 7)) / 5)`. Polygon is the cluster hull buffered by 8 m. `hard_brake` clusters become `kind: braking`, `bump` clusters become `kind: surface`.

**Abandonment (Lane D).** Count distinct rides per H3 cell per day from points. Baseline is the daily mean over days 3 to 14 ago; recent is the last 48 hours. Flag a cell when baseline is at least 5 rides per day, recent is under 30% of baseline, and some cell within 2 rings is over 130% of its own baseline. Merge adjacent flagged cells into one `kind: abandoned` hazard.

**Routing (Lane C).** Valhalla `/route` with `costing: pedestrian`, `walking_speed` set to scooter pace (16 km/h), and a heavy `step_penalty` so stairs are avoided. Campus walkways are mapped as footways, which bicycle costing tends to skip; Lane C confirms the choice on real campus trips. Safest request adds hazards with score at or above 0.4 as `exclude_polygons`. Stretch goal: an OSMnx graph with edge cost `length × (1 + 4 × risk)` for soft penalties instead of hard exclusion.


Manual reports bypass automatic clustering completely. Automatic recomputation changes only automation-owned observations and derived hazards, then publishes through HTTP; it must never replace the product hazard table or remove manual reports.

## 8. Privacy and source labeling

- The manual app requires a one-shot foreground device location for each new report, requested automatically when the rider opens Report ([decision 023](docs/decisions/023-report-flow-defaults.md)). Denied or unavailable location blocks new reports with retry/settings guidance; there is no manual report-pin fallback. Submission sends that point and report, not a ride trace. Saved submissions retain their original coordinates on retry. Route endpoint pins remain available independently. See [decision 021](docs/decisions/021-required-report-location.md).
- Trip planning takes one foreground fix for the Current location origin, asking permission only when a trip is opened (decision 020). The independent live trip dot reuses foreground permission, follows fresh GPS updates and supports camera recenter without changing endpoints ([decision 024](docs/decisions/024-foreground-trip-tracking.md)). Only the latest position is held in memory; backgrounding clears it. Place searches go to the product API, which forwards the query and a ~100 m-rounded ranking point to Photon; no account or device ID is sent.
- While the app is open with location permission, the app compares the rider's position with nearby hazards on the phone to ask "Is this hazard still there?" within 40 m. It fetches hazards for the ~500 m grid block around the rider, so the server sees only that coarse block, as with map browsing. Nothing runs in the background, precise positions are never recorded or uploaded, and feedback carries no coordinates (decision 013).
- No accounts or persistent device IDs in the MVP. Automatic collection is separate and opt-in, with a fresh random ride UUID.
- The automatic collector trims the first and last 100 m before uploading points or events. Local diagnostic recordings require deliberate recorder mode; remove identifying endpoints before sharing fixtures.
- Public product endpoints expose hazard aggregates, never ordered ride paths. Simulated/replayed automatic hazards remain visibly labeled as such.
- UI copy says “lower-risk route,” never “safe route.”
- The manual app's basemap is OSM vector tiles from OpenFreeMap, drawn by MapLibre GL JS in a WebView ([decisions 010](docs/decisions/010-osm-maplibre-basemap.md) and [011](docs/decisions/011-positron-and-dark-matter-map-themes.md)). Positron is the default light style; OpenFreeMap Dark (a Dark Matter fork) is selectable. Tile requests reveal the viewed area to that host; reports and routes do not go there. The required OpenStreetMap attribution stays visible.

## 9. Configuration

| Variable | Used by | Purpose |
|---|---|---|
| `DATABASE_URL` | product API | Product database only |
| `VALHALLA_URL` | product API | Routing server |
| `PHOTON_URL` | product API | Place search provider for `/v1/places`; defaults to the public Photon instance, empty disables search |
| `EXPO_PUBLIC_API_URL` | mobile | Shared product API URL |
| `EXPO_PUBLIC_MAP_STYLE_URL` | mobile | Optional light MapLibre style; defaults to OpenFreeMap Positron (public, never a secret) |
| `EXPO_PUBLIC_MAP_DARK_STYLE_URL` | mobile | Optional dark MapLibre style; defaults to OpenFreeMap Dark (public, never a secret) |
| `AUTOMATION_DATABASE_URL` | automatic service | Private observation database |
| `PRODUCT_API_URL` | automatic worker | Publication destination |
| `AUTOMATION_PUBLISH_KEY` | product API and worker | Server-only publication credential |
| `EXPO_PUBLIC_AUTOMATION_API_URL` | collector | Observation ingestion URL |
| `DEMO_MODE` | automatic service / local collector config | Explicit synthetic demo behavior, off by default |

### Database redundancy option (not yet selected or provisioned)

Vultr is the hosting provider; PostgreSQL remains the database engine and PostGIS its geographic extension. The default manual MVP uses one product database on one PostgreSQL server; optional automation adds its own observation database on that server. Neither has a standby yet. A proposed production upgrade is Vultr Managed PostgreSQL with a primary and at least one failover replica, replacing the deployed `db` container while keeping it for local development. The API writes through one primary endpoint; replication maintains the standby. Do not implement application-level dual writes.

Before adopting this option, verify the selected plan's replica availability, PostGIS version, endpoint behavior during failover, replication lag, and backup/restore policy. Test a primary failure and API reconnection. Replication does not replace backups, and database redundancy alone does not make the API or routing server redundant. Hosting both copies at Vultr does not provide protection against every provider-wide outage. Replicating an external primary into Vultr is a separate design requiring the primary provider and replication permissions to be known.

References: [Vultr high availability](https://docs.vultr.com/support/products/managed-databases/how-is-high-availability-achieved-in-a-vultr-managed-database), [PostGIS on Vultr](https://docs.vultr.com/how-to-install-the-postgis-extension-for-postgresql).

## 10. Rules for agents

1. Edit only the paths your lane owns (section 3).
2. After phase 0 handoff, shared contracts and schemas are frozen for independent lane implementation. Propose cross-lane contract changes in the hand-off note for coordinated approval. Explicit user-requested design revisions authorize updating the architecture and affected lane plans together.
3. Work on branch `lane/<letter>-<name>` and open small pull requests into `main`. Rebase before each PR.
4. Develop against `contracts/fixtures/` until the real upstream exists. Never block on another lane.
5. New dependency: add it only to your own manifest. Lane C owns `backend/pyproject.toml`, including routing dependencies; Lane D owns the automatic service manifest.
6. Every PR ends with a hand-off note: what works, how to run it, what is stubbed.

**Kickoff prompt template:**

```
You are working on Lane <X> of the repository. Read ARCHITECTURE.md fully first,
then docs/lanes/<your lane file>.md.
You own: <paths from section 3>. Do not edit anything else.
Goal: deliver the assigned milestone from docs/ROADMAP.md within your lane.
Done when: that milestone's demo gate and applicable lane acceptance checks pass.
Defer later milestones and stretch items; do not expand the MVP to the whole lane backlog.
Use contracts/fixtures/ for any upstream that is not built yet.
Finish with a hand-off note: what works, how to run it, what is stubbed.
```

## 11. Acceptance checks

- **Manual product:** with automation stopped, confirm denied/unavailable location blocks new reports, then obtain current location and submit a report, see it on another phone, retry without duplicates, and request routes using that hazard.
- **API boundary:** a standalone HTTP client publishes, updates, and resolves an automatic fixture; the unchanged mobile app displays its source correctly. Invalid credentials, stale revisions, and invalid payloads are rejected.
- **Independent automation:** recorded or simulated observations become hazards through the publication API; product outages leave publications queued, and automatic outages leave manual reporting functional.
- **Data lifecycle:** automatic recomputation preserves manual reports; expired/resolved hazards leave the map and routing; simulated evidence remains labeled.
- **Deployment:** manual stack runs without automatic containers. Optional automation starts separately and publishes over HTTPS.

## 12. Integration order

1. **Contract and fixtures:** mock manual reporting and automatic publication into one hazard feed.
2. **Manual MVP:** report form → API → database → phone map; offline retries and live updates work with automation off.
3. **Manual routing and deploy:** routes respond to manual hazards; mobile uses the hosted API over HTTPS. This is the first complete demo.
4. **Independent automatic build:** collector/replay → detector → private worker → published automatic hazard. In parallel, validate the bridge with a fixture publisher.
5. **Combined demo:** manually report one hazard, publish a separate automatic hazard, see both on the same map, and route around them. Add abandonment detection after the brake/bump path works.

If time is short, ship step 3. Automatic detection is a separately deliverable extension, not a prerequisite for the user product.
