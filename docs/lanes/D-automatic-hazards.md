# Lane D: Automatic hazard service

Track 2: turn sensor observations into hazards and publish them through the shared product API. Manual reporting and routing must not depend on this worker.

**Owns:** `automatic/service/`, `automatic/tests/`.
**Database:** owns private `events`, `points`, `cells`, `derived_hazards`, and `outbox`; no product database credentials or direct writes.
**Needs:** observation/publication contracts; use fixtures until the shared product API is available.

## What to build

### Independent service and publication

- Implement the observation API in ARCHITECTURE.md section 6, including idempotent UUID batches, timestamp validation and source labels. Lane B and F submit observations here.
- Own this service's Python manifest, models and config. Run it independently of `backend/`; store observations in `AUTOMATION_DATABASE_URL`.
- Recompute about 2 seconds after ingestion and periodically for decay/expiry, serializing jobs. Store derived hazards and a durable publication outbox atomically.
- Publish through `PUT {PRODUCT_API_URL}/v1/automatic/hazards/{external_id}` with the server-only credential. Stable external IDs and persisted monotonically increasing revisions make retries safe. Retry temporary failures; reconcile revision conflicts. Preserve evidence provenance across mixed input sources.
- Refresh active hazard expiry before its 24-hour lifetime ends only if evidence still qualifies. Publish resolved state for disappeared hazards. Product downtime must leave updates queued; recomputation must never delete product-side manual reports.

### Risk (inside `automatic/service/risk/`)

1. **Clustering** (`automatic/service/risk/cluster.py`). One SQL query per event type over the last 30 days:
   - Project with `ST_Transform(geom, 32616)` so distances are in meters.
   - `ST_ClusterDBSCAN(geom_utm, eps := 12, minpoints := 3) OVER ()`.
   - Per cluster: event count, distinct `ride_id` count, first and last `ts`.
   - Keep clusters with at least 2 distinct rides.
   - Polygon: `ST_Buffer(ST_ConvexHull(ST_Collect(geom_utm)), 8)`, transformed back to 4326.
   - `hard_brake` clusters become `kind: braking`; `bump` clusters become `kind: surface`.
2. **Scoring** (`automatic/service/risk/scoring.py`). Weight each event by age: `w = sum(0.5 ** (age_days / 7))`. Score is `min(1, w / 5)`. Five fresh events score 1.0; three fresh events score 0.6.
3. **Stable ids.** Recomputing must not hand out new ids each time, or the phone map flickers. Persist IDs by matching same-kind clusters to prior overlapping/nearby clusters; allocate a UUID for genuinely new clusters. Do not key solely by kind and H3 cell: multiple clusters may occupy one cell. On splits/merges, retain one matching ID and explicitly resolve retired IDs.
4. **Abandonment** (`automatic/service/risk/abandonment.py`).
   - From `points`, count distinct `ride_id` per `h3` cell per day.
   - Baseline: daily mean over days 3 to 14 ago. Recent: daily mean over the last 48 hours.
   - Flag a cell when baseline is at least 5, recent is under 30% of baseline, and some cell in `h3.grid_disk(cell, 2)` has recent above 130% of its own baseline.
   - Group flagged cells that touch into connected sets. Each set becomes one `kind: abandoned` hazard whose polygon is the merged outline of its cells, with score 0.7.
5. **Cells table.** Upsert every cell that has traffic: its two rates, the `abandoned` flag, its hexagon polygon, and `risk` as the highest score of any hazard overlapping it.
6. **Labels.** Default label is the kind and count, for example "Hard braking, 14 events". Street-name enrichment is optional and must not block publication.
7. **`recompute(session)`.** Rebuild private derived hazards and cells, preserve IDs, and enqueue changed publications atomically. Repeated evaluation of unchanged evidence must not create duplicate hazards. Never access the product hazard table.
8. **Demo mode.** When `DEMO_MODE=1`: cluster minimum is 1 event, the two-ride rule is off, and evidence is marked simulated. Use enough test evidence to exceed the product routing threshold when demonstrating route changes.

## Watch out for

- PostGIS polygons use longitude-first coordinates. H3 boundaries need conversion from latitude-first pairs.
- Time-dependent tests must freeze the evaluation timestamp; scoring intentionally changes as evidence ages.
- Add dependencies to the automatic service's own manifest. No imports from, or direct database access to, `backend/`.
- The publication API is the integration boundary; use fixtures and a mock server to develop independently.

## Done when

- Brake/bump and closure scenarios yield the expected hazards with stable IDs, including distinct clusters in the same H3 cell.
- Recomputing with identical observations and evaluation time preserves IDs and scores.
- Durable publication retries recover from product outages without duplicate hazards or stale overwrites.
- Resolutions and expiry refreshes reach the product API while manual reports remain untouched.
- The worker's tests run without the mobile app or Valhalla; manual reporting and routing work with the worker stopped.
