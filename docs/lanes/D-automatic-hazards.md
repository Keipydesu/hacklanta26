# Lane D: Private observations, hazard worker and durable publication

## Goal, baseline and ownership

Deliver independent automation for milestones 3–4 of [the roadmap](../ROADMAP.md), following
[ARCHITECTURE.md](../../ARCHITECTURE.md) and
[decision 001](../decisions/001-mvp-delivery-workflow.md). Stage 0 merged through
[PR #1](https://github.com/Keipydesu/hacklanta26/pull/1): observation ingestion validates UUID batches
in memory and `app/publisher.py` validates/sends a publication over HTTP. Neither persists data,
recomputes hazards nor retries durably. Extend this boundary; do not describe the current publisher
client as an outbox worker. Manual milestones 1–2 must work with this entire service stopped.

**Owns:** `automatic/service/`, `automatic/tests/`, and its Python manifest/migrations.
Own private `events`, `points`, `cells`, `derived_hazards` and `outbox`. Use only
`AUTOMATION_DATABASE_URL`; no product DB credential, direct product writes or backend imports.
G owns the image/deployment, B owns collection/detection, F owns scenarios/replay, Lane 0 owns
shared contracts. New methods below are internal proposals; public schemas remain frozen.

## Structure and flow

```text
automatic/service/
  app/main.py                   observation API factory/lifespan
  app/config.py                 private DB, product URL, worker settings
  app/schemas.py                contract-aligned observation models
  app/api/ingest.py              event/point HTTP adapters
  app/db/session.py              transactions and connection pool
  app/db/models.py               observation, identity, derived and outbox records
  app/ingest.py                  atomic UUID batch logic
  app/worker.py                  serialized scheduling/recompute orchestration
  app/risk/
    cluster.py                  metric DBSCAN and buffered hulls
    scoring.py                  frozen-time decay
    identity.py                 deterministic match/split/merge lifecycle
    abandonment.py              daily traffic analysis (implemented; see decision 007)
  app/publisher.py               existing HTTP adapter, shared async client
  app/outbox.py                  claim, send, acknowledge, retry/conflict state
  migrations/                   private DB schema evolution
  README.md                     separate API/worker run commands
  product-api.d.ts               checked-in product types for tooling

automatic/tests/                 ingest, worker, publisher and integration behavior
```

Trimmed B/F observations → ingestion transaction → durable dirty-work signal → serialized evaluation
→ derived state plus immutable outbox payload in one transaction → HTTP publication → outbox ack.
The product endpoint is the only cross-track write. Product outages do not roll back accepted
observations; automation outages do not interrupt manual operations. Release DB locks before HTTP.

## Private data model and ingestion

| Record | Contents and invariants |
|---|---|
| `events` | UUID primary key, ride UUID, type/time, WGS84 point, required measurements, source, normalized original body. Spatial/time/type indexes. |
| `points` | Globally unique UUID, ride UUID from path, time/point/speed/accuracy/source, normalized original identity including ride UUID. Unique identity is not scoped only within a ride. |
| `cells` | H3 ID/resolution, UTC time-window traffic aggregates, geometry and derived flag/risk, after abandonment is implemented. No public ordered trace endpoint. |
| `derived_hazards` | Stable external UUID, kind, geometry, counts/times/score, evidence provenance, status, last evaluated/published state, latest allocated revision and product receipt ID. |
| `outbox` | Unique `(external_id, revision)`, immutable full body, pending/sending/delivered/blocked state, attempt count, due time, lease/claim metadata and last error. Persist before sending. |
| Worker metadata | Dirty/evaluation watermark and scheduler lease if needed, allowing accepted observations to be recomputed after restart even if a process-local wake was lost. |

Keep original observation identity for retry comparisons. Canonicalize timezone/numbers consistently
with stage-0 schemas; omitted/null handling must not change silently. Ingestion constraints and
normalization are independent of real-time sensing: backdated simulations are valid, timestamps
more than five minutes in the future are not. Finite nonnegative required measurements, UUIDs,
source enum and batch limits are validated before writes. Empty batches return zero counts.

| Method | Implementation and result |
|---|---|
| `ingest_events(session, batch, now) -> IngestReceipt` | Validate <=500, detect conflicts within batch and against persisted UUIDs, insert all genuinely new events atomically and count identical duplicates. A conflict rejects every write with 409. |
| `ingest_points(session, ride_id, batch, now) -> IngestReceipt` | Same algorithm with <=2000 and path ride UUID included in identity. Reusing a point UUID under another ride conflicts, even if its body matches. |
| `compare_and_insert(session, items) -> counts` | Deduplicate normalized input, use uniqueness constraints plus transactional conflict handling. Concurrent batches cannot both accept contradictory bodies. Use savepoints/upsert-read or appropriate isolation; test the losing transaction, not just sequential retries. |
| `mark_dirty(session, time_range)` | Commit a durable recompute marker with the observations. Trigger an in-process wake only after commit; periodic scans recover any lost wake. Duplicate-only batches need not create redundant evaluations. |
| `health(session) -> HealthResult` | Probe the private observation database, independently of product/Valhalla. Report actual worker readiness operationally without inventing new contract fields. |

Do not add a public raw events/points read API. Document the observation ingress exposure with G;
the current unauthenticated development stub is not an unreviewed production ingestion policy.
Keep any future access-control proposal separate from frozen schema implementation.

## Serialized recompute and clustering methods

`request_recompute()` debounces new committed work by about 2s. `run_due(now)` coalesces bursts and
serializes evaluations, using one worker for the MVP. Schedule periodic evaluation even without new
ingestion to handle decay, expiry refresh and resolution. Choose/document the interval in D2 with
F's test clock and G's process lifecycle; restart must scan pending work rather than wait for a new
request. Additional workers require a DB-level lease/lock, not an optimistic in-memory flag.

Each evaluation freezes an aware UTC `now`, reads a consistent observation snapshot, computes new
state, and commits identity changes plus outbox entries atomically. A concurrent new ingest remains
dirty for the next pass. Do not clear a newer dirty marker when finishing an older snapshot.

| Method | Algorithm |
|---|---|
| `cluster_events(session, kind, now) -> list[Cluster]` | Select matching observations from the last 30 days, transform to EPSG:32616, and run `ST_ClusterDBSCAN` with eps 12m and minpoints 3. Use deterministic input ordering for repeatable border assignment. Keep >=2 distinct rides. Build hull buffered 8m in meters, then transform Polygon to WGS84. |
| `score_events(events, now) -> float` | `min(1, sum(0.5 ** (age_days / 7)) / 5)`. Use one evaluation clock and a nonnegative evidence age policy for accepted slight-future timestamps; document/clamp age at zero until timestamp is reached rather than amplify evidence above fresh weight. |
| `summarize(cluster) -> Candidate` | Derive event/ride counts, first/last evidence times, kind mapping (`hard_brake→braking`, `bump→surface`) and a label such as “Hard braking, 14 events.” Manual reports never enter this calculation. |
| `evidence_source(events) -> label` | All one origin maps to device/simulated/replay; any mixture maps to mixed. Preserve provenance through clustering, matching and republication. Demo mode may generate simulated inputs but must never relabel ingested device or replay evidence; mixed inputs remain mixed. |
| `match_clusters(previous, candidates) -> Matches` | Match same-kind spatially overlapping/nearby clusters one-to-one using deterministic ranking and tie breaks. Persist chosen external UUIDs; do not derive identity only from H3 cell or current DBSCAN label. |
| `build_changes(matches, now) -> publications` | Retain matched IDs, allocate UUIDs for genuinely new clusters, resolve disappeared/retired IDs and create complete higher-revision bodies for changed public state. |
| `commit_evaluation(session, changes, watermark)` | Write derived state and outbox rows together, advancing persisted revisions only with a committed publication. Commit before any HTTP request; a failed transaction allocates no visible publication. |

UTM 16N clustering is scoped to Atlanta evidence, as specified by the architecture; do not silently
claim worldwide metric clustering. Validate/support other regions through a separate design change.
Deterministic matching should specify a metric distance/overlap rule and tie-break by stable prior
ID during D2, with split/merge fixtures from F. On split, one child retains the old ID; others get
new IDs. On merge, one predecessor survives and the others resolve. Both outcomes must preserve
separate same-kind clusters in one H3 cell. Record chosen tolerance in configuration/tuning notes;
nearby does not mean every cluster in the same cell is interchangeable.

At identical evidence and evaluation time, no state or revision changes. For periodic evaluations,
compare canonical public payload fields and an explicit refresh schedule, not only raw timestamps.
Do not renew every hazard's expiry on every 2s wake by accident. Compute decay on each due evaluation;
publish material changed state and scheduled refreshes. Define score precision/change comparison
and refresh margin explicitly in D2 and cover them with frozen-clock tests; do not change scoring
formula or product routing cutoff. Active refreshed expiry is evaluation time +24h, only while
thresholds/evidence still qualify. When evidence no longer qualifies, enqueue complete resolved
state with higher revision. When the worker stops, product-side expiry removes stale hazards.

## Durable outbox and HTTP behavior

Retain the existing contract validator and a lifespan-owned `httpx.AsyncClient` in the publisher.
Product URL and bearer credential are server-side environment configuration. Validate full payloads
before enqueuing/sending; never log the key or store it in an outbox body.

| Method | Behavior |
|---|---|
| `enqueue_publication(session, hazard, payload)` | Allocate/persist monotonic revision and immutable complete payload with derived-state change in one transaction. Stable external ID survives restart. |
| `claim_due(now, limit) -> jobs` | Claim pending work with a bounded lease. Serialize sends per external ID so revision N is acknowledged before N+1; different hazards may send concurrently within a bounded limit. |
| `send(job) -> Receipt` | PUT to the frozen product path using exactly the persisted body/revision. Use bounded request timeouts; map success/error into explicit outbox outcomes. No DB transaction held across the request. |
| `ack(job, receipt)` | Validate stable public ID and expected revision, mark delivered transactionally. A crash after remote acceptance but before local ack retries identically and gets duplicate success. |
| `retry(job, error)` | Schedule capped exponential backoff with jitter for transport failures/temporary server errors (and bounded rate-limit delay if applicable). Preserve exact payload and ID. Surface persistent outage/oldest pending age operationally. |
| `block(job, reason)` | 401 signals credential/configuration failure; 422 signals payload defect; 409 signals revision disagreement. Preserve record and stop blind retries for that hazard until reconciled. |
| `reconcile_conflict(external_id)` | Compare durable accepted receipts, local revision chain and any concurrent publisher ownership. Resume only after establishing correct ownership/state; do not simply increment revision until accepted. |

There is no product “get latest publication revision” endpoint in the frozen contract. Do not
invent one or assume the public hazard feed exposes publisher revision. A 409 with insufficient
local evidence becomes a visible operator/owner reconciliation task, using controlled server-side
diagnostics with C. Document how that block is cleared after reconciliation. Keep the newest desired
state queued, but do not discard history or overwrite a newer unknown publication to clear an alarm.
Persisted ordered retry with one publisher should make conflicts exceptional.

Resolve using the same complete schema, not a partial patch. Never let retries of older active
state run after a newer resolved state has been acknowledged. Initial implementation keeps ordered
outbox rows; coalescing intermediate unsent states is deferred until a proven crash-safe policy exists.
Observation ingestion continues when the product is down. Product reporting continues when this
worker is down. Tests must exercise both directions independently.

## Abandonment extension after brake/bump integration

Implemented after the brake/bump bridge (`app/abandonment.py`); H3 resolution and window boundaries are internal tuning. Agree H3 resolution and UTC
window boundaries with F before fixtures are generated; neither is a new public HTTP field.

`aggregate_traffic(points, now)` counts distinct ride IDs per cell/day, with rolling 24 h days 2–13 forming
the daily-mean baseline and last 48h forming recent daily mean. Include zero-traffic days in the
baseline denominator. Require baseline >=5 rides/day, recent <30% of baseline, and a neighbor within
2 rings with recent >130% of its own baseline. Handle no-history/zero-baseline neighbors explicitly
rather than dividing by zero or declaring evidence from missing data.

`find_abandoned_cells(days)` returns flagged cells, per-cell rates and, for each flagged cell, the neighbor cells whose gain qualified it (their traffic sources count toward the hazard's `evidence_source`); `group_cells(cells)` joins touching candidates.
Build valid longitude-first geometry from H3 boundaries, respecting the library's coordinate order.
Merged outlines may be multipart or touch only at a point: the product schema accepts Polygon,
not MultiPolygon. Split into valid connected Polygon publications with stable identities, or propose
a coordinated contract change before using a different geometry type; never silently convex-hull
across unaffected space. Record the component/identity policy with F's expected scenarios.

Use kind abandoned, score 0.7 and explicit source provenance. Specify meaningful counts/lifecycle
from contributing traffic observations in the implementation decision rather than inventing sensor
event counts. `upsert_cells` stores computed baseline/recent rates, flag, polygon and highest
overlapping hazard score privately. A closure scenario tests abandonment, not manual closure report
clustering. Optional street names cannot block hazard publication.

## Implementation slices and acceptance

1. **D1 — Durable observation API.** Add private models/migrations/adapter and atomic ingest while
   preserving stage-0 response behavior. Coordinate G's separate role/DB. Exit: retry survives
   restart, concurrent conflicts reject whole batch, point identity includes ride path, no product
   credentials needed. Use B/F contract fixtures before real sensors exist.
2. **D2 — Brake/bump recompute and identity.** Add serialized scheduler, frozen-clock metric clusters,
   score/provenance/matching and persistent derived records. Exit: deterministic result at same time,
   two clusters in one cell remain distinct, split/merge resolves retired IDs, late ingest not lost.
   Define matching/score comparison/refresh settings in lane-owned docs before integration.
3. **D3 — Transactional outbox.** Commit state+payload/revision together, implement ordered claims,
   receipt ack and retry/blocked outcomes. Use mock HTTP first. Exit: crash after accepted PUT,
   worker restart and product outage recover without duplicate hazards or stale overwrites; 409
   blocks with diagnostics rather than looping. Test resolve/refresh with a controlled clock.
4. **D4 — Independent publication gate (milestone 3).** Run F synthetic brake/bump inputs through
   ingestion/worker into the product fixture boundary. Confirm simulated labels and manual control
   hazard preservation. G can host optional service later; local separate processes are sufficient
   for this gate, not the combined hosted milestone.
5. **D5 — Combined hosted gate (milestone 4).** G supplies separate HTTPS observation endpoint and
   worker deployment; A/C render and route the combined feed. Stop product, queue updates, restore;
   stop automation, create manual report and route. Capture IDs/revisions/receipts and device labels.
6. **D6 — Abandonment extension.** Add H3 aggregates and F closure/diversion scenario only after the
   brake/bump bridge works. Does not block manual milestone 2 or justify cross-track DB coupling.

## Verification, commands and handoff

Current stage-0 commands from repository root:

```sh
uv sync --project automatic/service --frozen
uv run --project automatic/service pytest -c automatic/service/pyproject.toml automatic/tests -q
uv run --project automatic/service uvicorn app.main:app --app-dir automatic/service --host 0.0.0.0 --port 8001
```

They verify/run an observation stub, not a worker. Add migration/worker/recompute CLI commands only
when implemented, verify them, and update README plus shared Commands through coordination. G adds
a disposable observation PostGIS CI service when D1 lands. Keep jobs scoped to service/tests and
shared contracts; no live product/Valhalla dependency in routine worker tests.

Tests cover whole-batch rollback including within-batch conflicts, restart identity, future/invalid
values, same-time determinism, 7-day decay, kind/provenance, minimum rides, cluster identity, outbox
transaction rollback, duplicate ack, ordered revisions, expired leases, auth/payload/conflict blocks,
resolution and refresh before expiry. Include device/replay/mixed evidence while demo mode is
enabled and verify original provenance survives publication. Time-dependent tests freeze `now`.
A dedicated HTTP acceptance probe preserves a manual report through every automatic operation; compare public fields/ID before
and after rather than only checking response status. Never claim persistence from the old memory tests.

Handoff records schema/migration versions, service/worker entrypoints, evaluation settings, fixtures
and clock, derived/external/public IDs, revision receipts, outage recovery and blocked conflicts.
Report missing real-device data separately from simulated success. Deferred: cross-source merging,
public raw traces, multi-worker scale, unrelated dashboard and product-database direct access. This
planning PR changes no runtime behavior or frozen schema.
