# Lane D: Risk and routing

Turns stored events and points into hazard zones, and plans routes around them. This lane is the product's core logic.

**Owns:** `backend/app/risk/`, `backend/app/routing/`, `backend/tests/risk/`, `backend/tests/routing/`.
**Reads and writes:** tables defined by Lane C. Writes only `hazards` and `cells`.
**Needs:** Valhalla from Lane G (use recorded responses until it is up).
**Exports:** `risk.recompute` and `routing.plan` as defined in ARCHITECTURE.md section 6.

## What to build

### Risk

1. **Clustering** (`risk/cluster.py`). One SQL query per event type over the last 30 days:
   - Project with `ST_Transform(geom, 32616)` so distances are in meters.
   - `ST_ClusterDBSCAN(geom_utm, eps := 12, minpoints := 3) OVER ()`.
   - Per cluster: event count, distinct `ride_id` count, first and last `ts`.
   - Keep clusters with at least 2 distinct rides.
   - Polygon: `ST_Buffer(ST_ConvexHull(ST_Collect(geom_utm)), 8)`, transformed back to 4326.
   - `hard_brake` clusters become `kind: braking`; `bump` clusters become `kind: surface`.
2. **Scoring** (`risk/scoring.py`). Weight each event by age: `w = sum(0.5 ** (age_days / 7))`. Score is `min(1, w / 5)`. Five fresh events score 1.0; three fresh events score 0.6.
3. **Stable ids.** Recomputing must not hand out new ids each time, or the dashboard flickers. Derive the id as a UUID5 of `kind` plus the H3 resolution 10 cell of the cluster centroid.
4. **Abandonment** (`risk/abandonment.py`).
   - From `points`, count distinct `ride_id` per `h3` cell per day.
   - Baseline: daily mean over days 3 to 14 ago. Recent: daily mean over the last 48 hours.
   - Flag a cell when baseline is at least 5, recent is under 30% of baseline, and some cell in `h3.grid_disk(cell, 2)` has recent above 130% of its own baseline.
   - Group flagged cells that touch into connected sets. Each set becomes one `kind: abandoned` hazard whose polygon is the merged outline of its cells, with score 0.7.
5. **Cells table.** Upsert every cell that has traffic: its two rates, the `abandoned` flag, its hexagon polygon, and `risk` as the highest score of any hazard overlapping it.
6. **Labels.** Default label is the kind and count, for example "Hard braking, 14 events". Stretch: ask Valhalla `/locate` for the nearest street name and write "Hard braking near Courtland St".
7. **`recompute(session)`.** Runs clustering, scoring, abandonment, and the cells upsert in one transaction. Replaces the contents of `hazards`. Returns the hazard list. Must be safe to run repeatedly.
8. **Demo mode.** When `DEMO_MODE=1`: cluster minimum is 1 event, the two-ride rule is off, and the routing exclusion threshold drops to 0.1.

### Routing

9. **Valhalla client** (`routing/valhalla.py`). `POST {VALHALLA_URL}/route` with httpx:

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
10. **Planner** (`routing/planner.py`).
    - Shortest: request with no exclusions.
    - Safest: request excluding every hazard with score at least 0.4.
    - Leave out any hazard that contains the origin or destination, or no route can exist.
    - If Valhalla answers the safest request with HTTP 400 (no path), return the shortest route under both kinds with `safest_available: false`.
    - For each route, intersect its line with the hazard polygons (shapely) to fill `hazard_ids`, and set `risk_score = 1 - product(1 - score)` over those hazards.
11. **Costing choice.** Spend the first half hour comparing `pedestrian` and `bicycle` costing on three real campus trips. The starting choice is `pedestrian` with scooter speed and a heavy stairs penalty, because campus walkways are mapped as footways and bicycle costing only uses ways with bicycle access. Record the decision in a comment at the top of `valhalla.py`.
12. **Tests.**
    - Risk: seed events and points directly into a test database, run `recompute`, assert on the hazards. Use the expected locations in `simulator/scenarios/*.yaml`.
    - Routing: save real Valhalla responses in `tests/routing/fixtures/` and replay them, so tests run without Valhalla.
13. **Stretch: soft penalties.** `routing/fallback_graph.py` with an OSMnx walking graph and edge cost `length * (1 + 4 * risk)`. Only start this after the Valhalla path works end to end.

## Watch out for

- `exclude_polygons` takes rings of `[lon, lat]`. Hazard polygons from PostGIS are already in that order.
- `h3.cell_to_boundary` returns `(lat, lon)` pairs. Flip them before writing GeoJSON.
- Exclusion is hard: a big polygon across the only path means no route. Keep the 8 m buffer small and cap exclusions to the 20 hazards nearest the trip.
- "Recent" and "baseline" are measured from the current time. The simulator backdates relative to now, so run it and then test the same day.
- Add Python dependencies through a note to Lane C, who owns `pyproject.toml`.

## Done when

- The pothole scenario yields exactly one `braking` hazard at the expected spot.
- The closure scenario yields exactly one `abandoned` hazard on the closed stretch.
- `plan` returns two visibly different routes across the pothole.
- Running `recompute` twice in a row leaves ids and scores unchanged.
- Tests pass without a live Valhalla.
