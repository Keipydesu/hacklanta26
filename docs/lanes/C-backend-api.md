# Lane C: Product API, data and routing

Supports manual reporting immediately and accepts automatic hazards through HTTP. Runs independently of the automatic subsystem.

**Owns:** `backend/` except `app/schemas.py` and `Dockerfile`, including product routing and its tests.
**Uses:** product contract and Valhalla (recorded fixtures until available). Owns the route planner; does not import automation code.

## What to build

1. **Product database.** Own `manual_reports` and `hazards`. Reports store UUID, kind, point, observed/received times, description and normalized original payload for idempotency. Hazards store public UUID, source, kind, polygon, label, score, lifecycle timestamps/status, counts, evidence source, and nullable publisher/external ID/revision/original publication payload. Unique manual report linkage and unique `(publisher, external_id)` prevent duplicates. Add spatial indexes and indexes for expiry/status.
2. **Manual ingest.** Implement `POST /v1/reports` exactly as section 5. In one transaction, save the report and its hazard with an 8 m geographic buffer (project to UTM 16N, buffer, transform back), provisional score 0.5, source manual and 24-hour expiry. Handle identical retries as 200, new submissions as 201, conflicting IDs as 409, invalid input as 422. Never depend on clustering, a ride, or the automatic service.
3. **Automatic publication.** Authenticate the server-side publisher key. Implement revisioned `PUT /v1/automatic/hazards/{external_id}` with atomic create/update and concurrency-safe revision comparisons. Stamp automatic source, maintain stable public ID, validate geometry/counts/timestamps, and support resolution. This endpoint cannot overwrite manual hazards. Missing/invalid credentials return 401. Same revision/body is a duplicate; stale or conflicting revisions return 409. Do not accept raw sensor events here.
4. **Reads, routes and live updates.** `/v1/hazards` returns the combined active, unexpired feed for bounds. `/v1/route` passes those same eligible hazards near the trip to `routing.plan`; return 503 on routing outage without affecting reports. Broadcast `hazards.changed` only after committed changes; a periodic expiry task notifies clients, while query-time expiry filtering guarantees correctness. `/healthz` checks only product API/database availability.
5. **Verification.** With automation stopped, test manual POST/read/route, identical retry, conflicting retry, bounds and expiry. Test automatic publication auth, concurrent revisions, duplicate and stale updates, resolution and source preservation. Confirm a manual hazard survives all automatic update operations. Test WebSocket notification/reconnect refresh and route outage isolation.

## Routing (`backend/app/routing/`)

1. **Valhalla client** (`routing/valhalla.py`). `POST {VALHALLA_URL}/route` with httpx:

   ```json
   {
     "locations": [{"lat": 33.7531, "lon": -84.3853}, {"lat": 33.7560, "lon": -84.3880}],
     "costing": "pedestrian",
     "costing_options": {"pedestrian": {"walking_speed": 16, "step_penalty": 600}},
     "exclude_polygons": [[[-84.3861, 33.7540], [-84.3859, 33.7540], [-84.3859, 33.7542], [-84.3861, 33.7542]]],
     "units": "kilometers"
   }
   ```

   Read `trip.summary.length` (km) and `trip.summary.time` (seconds). Decode `trip.legs[].shape`, which is an encoded polyline with **6** decimal digits of precision, into `[lon, lat]` pairs.
2. **Planner** (`routing/planner.py`).
    - Shortest: request with no exclusions.
    - Safest: use active, unexpired hazards from both manual and automatic sources, excluding those with score at least 0.4.
    - Leave out any hazard that contains the origin or destination, or no route can exist.
    - If Valhalla answers the safest request with HTTP 400 (no path), return the shortest route under both kinds with `safest_available: false`.
    - For each route, intersect its line with the hazard polygons (shapely) to fill `hazard_ids`, and set `risk_score = 1 - product(1 - score)` over those hazards.
3. **Costing choice.** Spend the first half hour comparing `pedestrian` and `bicycle` costing on three real campus trips. The starting choice is `pedestrian` with scooter speed and a heavy stairs penalty, because campus walkways are mapped as footways and bicycle costing only uses ways with bicycle access. Record the decision in a comment at the top of `valhalla.py`.
4. **Tests.**
    - Seed manual and automatic hazard fixtures through the product API; verify both affect routes and expired/resolved hazards do not.
    - Routing: save real Valhalla responses in `tests/routing/fixtures/` and replay them, so tests run without Valhalla.
5. **Stretch: soft penalties.** `routing/fallback_graph.py` with an OSMnx walking graph and edge cost `length * (1 + 4 * risk)`. Only start this after the Valhalla path works end to end.

Use polygon rings in `[lon, lat]` order. Cap exclusions to the 20 eligible hazards nearest the trip. Product routing dependencies belong in `backend/pyproject.toml`. This module receives stored hazard data; it never waits for the automatic service.

## Done when

- Manual reporting and hazard reads work with automatic infrastructure absent.
- An authenticated standalone HTTP client publishes and updates an automatic hazard; unauthorized calls cannot.
- Manual and automatic hazards appear in the same feed with correct labels.
- Duplicate requests do not create duplicates; concurrent/stale updates cannot overwrite newer state.
- Expired or resolved hazards are excluded from reads and routing; route tests use recorded Valhalla responses and pass with automation absent.
