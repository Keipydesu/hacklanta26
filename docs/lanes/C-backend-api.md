# Lane C: Product API, persistence and routing

## Goal, baseline and boundaries

Deliver milestones 1–2 of [the roadmap](../ROADMAP.md): durable manual reporting, a shared map,
and real route comparison with every automatic process stopped. Follow
[ARCHITECTURE.md](../../ARCHITECTURE.md) and [decision 001](../decisions/001-mvp-delivery-workflow.md).

Stage 0 merged through [PR #1](https://github.com/Keipydesu/hacklanta26/pull/1). It supplies contract-aligned schemas, memory-backed endpoints, bounded live
notifications, expiry/revision regression tests and fixed route fixtures. It does not use PostGIS
or calculate routes. Build on that work; do not rebuild its API or claim persistence
from a healthy but unused database. The methods and new files below are proposed internal seams.

**Owns:** `backend/` except `app/schemas.py` (Lane 0) and `Dockerfile` (Lane G).
Own the Python manifest, migrations, product models, API and route tests. No observation ingest,
risk-worker imports, product-to-automation calls, or automatic DB credentials belong here.
The checked-in product OpenAPI is frozen; coordinate any boundary change with Lane 0 and consumers.

## Target structure and request flow

```text
backend/
  app/main.py                 app factory, lifespan, dependency wiring
  app/config.py               validated product settings
  app/schemas.py              existing contract-aligned models; Lane 0 owns
  app/api/
    reports.py                manual HTTP adapter
    publications.py           authenticated automatic adapter
    hazards.py                bbox reads
    routes.py                 route request adapter
    live.py                   socket lifecycle
    health.py                 product DB readiness
  app/db/
    session.py                pool, transaction boundaries, shutdown
    models.py                 reports, hazards and publication identity
    reports.py                atomic report creation/retry
    publications.py           revision-serialized upsert
    hazards.py                spatial/expiry queries
  app/geometry.py             meter-based manual buffer and validation
  app/live.py                 bounded fan-out of change hints
  app/expiry.py               expiry scan and notification bookkeeping
  app/routing/
    valhalla.py                one shared async client, request/response adapter
    planner.py                 exclusions, fallback and risk metrics
  migrations/                 versioned product schema changes
  tests/api/                  DB-backed behavior and concurrency
  tests/routing/fixtures/     recorded upstream responses
```

HTTP validation/authentication → service/repository transaction → commit → change hint → response.
Queries use the same active/unexpired predicate for map and routing. The route handler obtains a
consistent hazard snapshot, then releases its DB connection before waiting on Valhalla. FastAPI
adapters translate known domain outcomes into existing HTTP statuses; they do not embed SQL or
retry loops. Dependency injection supplies a clock, DB session, router client and notifier so
failure cases can be tested without live automation or Valhalla.

## Product storage and transaction methods

Use one product database with PostGIS. Introduce a migration tool and async database adapter in
`backend/pyproject.toml`, pin resolved dependencies, and document their verified commands in the
backend README. Coordinate migration startup with G; the app must not race multiple schema writers.

| Record | Required data and constraints |
|---|---|
| `manual_reports` | Submission UUID primary key, kind, WGS84 point, observed/received UTC times, normalized original payload, description. Retain retry identity after public expiry. |
| `hazards` | Public UUID, source/kind, valid Polygon SRID 4326, label, score, lifecycle timestamps/status, counts and evidence source. A unique nullable manual-report link creates at most one manual hazard per report. |
| Publication identity | Unique `(publisher, external_id)`, latest positive revision, normalized accepted body and stable hazard UUID. May be columns on the automatic hazard row or a separate record; deletion/expiry must never erase accepted revision identity. |
| Expiry bookkeeping | Last notified lifecycle/version or expiry timestamp, enabling conditional updates and repeat-safe scans without deleting a newer reactivation. |

Add a GiST geometry index and suitable active/expiry indexes. Enforce source/count/identity
consistency: manual has one report, zero sensor counts and null evidence; automatic has zero reports.
Use constraints and row locks for correctness across concurrent requests, not process-local dicts.
Normalize timestamps, omitted description and numeric values exactly as existing schemas do; compare
the normalized semantic body, not arbitrary JSON key order. A hash can accelerate comparisons but
must not redefine equality. Keep accepted identity records for the MVP; define retention separately
before pruning them. Do not grow an unbounded in-process cache of all persisted hazards.

| Proposed method | Implementation and outcome |
|---|---|
| `create_report(session, body, now) -> CreateResult` | Insert report and buffered hazard atomically. Unique conflict loads the committed original and compares normalized bodies: identical returns original IDs/duplicate; different raises conflict. Handle a concurrent insert with a savepoint or insert-on-conflict, avoiding a poisoned transaction. |
| `buffer_report_point(lon, lat, radius_m=8) -> Polygon` | Preserve stage-0 point-centered meter-based projection (or verified equivalent geodesic behavior), transform back with longitude first, validate finite/nonempty geometry. Do not restore Atlanta-only UTM for arbitrary valid world coordinates. Preserve controlled 422 for unsupported polar/antimeridian geometry instead of a 500. |
| `publish(session, publisher, external_id, body) -> PublicationResult` | Serialize by publisher/external identity. Safely create a missing row with uniqueness handling, then lock/read the accepted revision. Same revision/body duplicates; older or conflicting same revision rejects; higher revision replaces public fields and advances identity together. Keep public UUID unchanged. |
| `list_active(session, bbox, now) -> list[Hazard]` | Parameterized spatial intersection with the WGS84 bbox and `status=active AND expires_at>now`. Return combined sources, never raw reports or traces. Validate finite increasing bounds before querying; antimeridian-crossing bbox is unsupported. |
| `snapshot_for_trip(session, origin, destination, now) -> list[Hazard]` | Query the trip search envelope using the same lifecycle predicate, materialize immutable records, and release transaction before upstream I/O. Ensure the envelope covers returned candidate routes as described below. |
| `health(session) -> HealthResult` | Short-timeout product DB readiness probe. Never make automation or Valhalla availability a prerequisite for product health. Align status/body with the canonical contract. |

Manual writes set `source=manual`, score 0.5 and expiry `observed_at + 24h`. Accept already-expired
queued reports durably but exclude them from reads. Reject observations over five minutes in the
future. Automatic auth derives publisher identity from the server-only credential; never trust a
publisher name from JSON. Missing/invalid credentials produce 401; new writes 201, updates/retries
200, conflicts 409 and invalid input 422. A publisher cannot target manual records by guessing IDs.

## Lifecycle and live updates

`publish_changed(hazard_id)` emits only the existing `hazards.changed` hint after successful commit.
Do not hold row locks while waiting for a socket. Retain bounded concurrent sends and bounded
close timeouts from stage 0; remove stalled sockets. Use a bounded in-process notification queue
if decoupling from requests; coalesce duplicate IDs and make overflow trigger connection reset
rather than silently promising reliable delivery. Reconnecting clients refetch their visible bbox.
Durable public event replay is not an MVP requirement and must not become a new public endpoint.

`scan_expirations(now, limit)` selects eligible records in bounded batches and conditionally records
notification progress in a transaction. Recheck lifecycle/version while updating; commit the entire
batch before awaiting socket work. A newer active revision must survive a scan that began before
it arrived. Keep identity rows and request-time filtering even if notification cleanup is delayed.
Resolution is already a higher-revision publication and emits its hint after commit. Expiry hints
may arrive after reactivation; clients always refetch current state, never treat the hint as deletion.

Start with one API process and one expiry scheduler, matching the existing deployment. Do not add
multiple workers until a shared notification/scheduler coordination design exists; otherwise phones
connected to another process miss changes. This deployment constraint belongs in the G handoff.

## Routing methods and algorithm

Expose `async plan(origin, destination, hazards) -> RouteResponse` in `routing/planner.py`. It
receives product hazards only. No worker, observation DB or sensor process is required.

| Method | How it works |
|---|---|
| `ValhallaClient.route(origin, destination, exclusions) -> Candidate` | Reuse lifespan-owned `httpx.AsyncClient`, set bounded connect/read/overall budgets, send pedestrian costing with walking speed 16 km/h and heavy step penalty (starting value 600). Convert summary km to meters and decode every leg's polyline6 into longitude-first LineString, removing duplicate leg joins. Validate finite geometry/metrics. |
| `select_exclusions(hazards, origin, destination) -> rings` | Keep active unexpired score >=0.4 from both sources. Skip polygons containing or touching either endpoint to avoid trapping the route. Rank by metric distance to trip and take at most 20 while keeping the combined closed-ring coordinate count at most 100 (decision 027); stop before the first ring that exceeds the budget; serialize exterior rings in `[lon, lat]` order. Preserve all eligible hazards for risk scoring, including endpoint/cap exclusions. |
| `score_route(line, hazards) -> (risk, ids)` | Intersect candidate line with polygons; deduplicate IDs. Compute `1 - product(1 - score)` over intersected hazards. Empty intersection gives zero. This heuristic is not a probability or safety guarantee. |
| `plan(...) -> RouteResponse` | Obtain the baseline route without exclusions, then the lower-risk candidate using selected exclusions. Score both against the same complete active/unexpired snapshot, including scores below 0.4; the cutoff applies only to exclusions. Map to contract kinds `shortest` and `safest`; user-facing wording remains lower-risk. |
| `pick_alternatives(candidates, shown, hazards, covered)` | Valhalla `alternates: 2` on the baseline call, scored on the same final snapshot; drop repeats, routes riskier and no faster than one shown, and routes outside loaded coverage; at most 2 ([decision 026](../decisions/026-route-alternatives.md)). |
| `classify_upstream_error(response) -> NoPath or Unavailable` | Recognize a real no-path response for the pinned upstream version. Do not treat every HTTP 400 as no-path: malformed requests/configuration failures must surface operationally. Timeouts, invalid responses and upstream outages map to product 503. |

Only if the exclusion request has no path and the baseline succeeded, return that baseline under
both kinds with `safest_available=false`. A verified baseline no-path response returns 422. Other
engine errors, including unknown HTTP 400 codes, malformed response bodies and nonfinite metrics,
return 503 on either call. Reporting and map
reads continue during either case. See [decision 006](../decisions/006-routing-errors-and-refreshed-hazard-snapshots.md),
which supersedes decision 005's generic rejected-request fallback. A successful lower-risk result
may share geometry with the baseline;
do not invent an alternative or promise it avoids every hazard.

The [Valhalla API reference](https://github.com/valhalla/valhalla/blob/master/docs/docs/api/route/api-reference.md)
documents pedestrian speed units, exterior-ring exclusions and internal no-path code 442. Pin and
record the tested upstream version with G before depending on its error shape or service limits.
Compare pedestrian versus bicycle on three real GSU trips; keep pedestrian as the architecture's
starting choice and record evidence about walkways/stairs, not an untested change of costing.
The contract's `shortest` is the baseline under that costing; do not silently enable an upstream
shortest option that discards the intended penalties.

For spatial selection, initially use a documented bounded campus trip envelope expanded around
origin/destination; check returned geometry against it. If a candidate leaves it, load active hazards
covering the returned line before scoring and reconsider exclusions within a bounded second pass.
After expansion, replace the full union-envelope snapshot at a fresh evaluation time, dropping
resolved, expired or moved-out hazards absent from that query. Rescore both candidates against the
same final snapshot and use it for the next exclusion pass. Do not retain old entries by unioning
records across refreshes. If the second pass leaves covered bounds again, return 503 rather than
assign risk from incomplete coverage; keep reporting and map reads available.
Record the search bounds/limit and test a detour; never claim risk for an unseen area is zero.
Choose the concrete envelope and timeout budgets with measured GSU routes during C4; no new API
field or unsupported global routing promise is introduced by this plan.

## Place search

`GET /v1/places` proxies Photon for trip endpoint search (`app/places.py`, decision 020): metro-Atlanta
bbox, rounded ranking point, 3-100 character queries, a short cache, and 503 on provider failure. It
never touches product storage or routing, and routing keeps taking lat/lon.

## Implementation sequence and dependencies

1. **C1 — Persistence foundation (milestone 1).** After stage 0, add DB configuration, migrations,
   constraints, pool lifecycle and transaction tests. Coordinate G's dedicated product role and
   migration execution. Exit: fresh database migrates, manual row/hazard commit together, restart
   preserves IDs. Keep fixed routing visibly stubbed while this slice lands.
2. **C2 — Durable boundary.** Replace memory report/publication repositories; implement concurrent
   retry/revision handling and spatial reads. Exit: identical concurrent submissions produce one
   hazard; stale concurrent revisions cannot overwrite newer state; manual survives automatic
   updates/resolution. Use standalone publisher fixtures, not D as a dependency.
3. **C3 — Live manual gate.** Move expiry task to conditional DB batches, retain bounded sockets,
   wire DB health and verify two-phone refresh/reconnect with A. Exit: offline retries, API restart,
   expiration/reactivation and a slow socket all preserve correct feed state with automation off.
   **Current status:** backend behavior implemented; five focused PostGIS checks passed on
   2026-10-10, including the corrected slow-socket test invocation. The physical two-phone gate
   remains pending in [issue #19](https://github.com/Keipydesu/hacklanta26/issues/19).
   Follow the [C3 rehearsal checklist](../../backend/C3-rehearsal.md); LAN connectivity is sufficient
   for C3, while hosted HTTPS/real routing remain separate A4/C5 requirements.
4. **C4 — Routing adapter (milestone 2).** Agree pinned Valhalla and sample campus requests with G,
   record responses/errors, implement client/decoder and three-trip costing comparison. Until G's
   engine exists, recorded responses drive unit tests; fixtures do not complete the live gate.
5. **C5 — Route planner and release.** Implement eligibility/exclusion/risk/fallback; exercise both
   source types and routing outage isolation. A supplies UI comparison, G supplies HTTPS. Exit:
   a live manual report changes route comparison on a phone using hosted product API with all
   automation stopped. Remove fixed-route header/copy only when real routing is selected.
6. **C6 — Automatic integration (milestone 4).** D replaces fixture publisher with durable outbox.
   Verify revisions, expiry, simulated labels and manual preservation; no C-side clustering added.

Campus bike-lane coverage (issue #29) is checked-in OSM data in `backend/bike_lanes/`, with evidence
rules and a refresh procedure in [its README](../../backend/bike_lanes/README.md). Nothing consumes it yet;
using it in route scoring is follow-up work that must not replace pedestrian costing implicitly
([decision 012](../decisions/012-osm-bike-lane-coverage.md)).

## Verification and delivery evidence

These existing stage-0 commands run from repository root:

```sh
uv sync --project backend --frozen
uv run --project backend pytest -c backend/pyproject.toml backend/tests -q
uv run --project backend uvicorn app.main:app --app-dir backend --host 0.0.0.0 --port 8000
# Against a dedicated running demo instance, with server/CLI publisher credentials configured:
python3 contracts/scripts/smoke_product.py
```

The smoke script accepts memory or PostGIS storage; it is an HTTP probe, not proof of restart
durability or two-phone behavior. Migrations run at API startup under an advisory lock; manual
migration and disposable PostGIS test commands are documented in the [backend README](../../backend/README.md).
Use small changes and CI as routine gate, not an exhaustive local suite before every push.

Required tests: atomic rollback, restart persistence, exact/conflicting retries, simultaneous first
publication, out-of-order revisions, resolved/expired filtering, bbox intersection, world-coordinate
buffer regression, expired queued report, future timestamp rejection, post-commit notification,
slow sockets and expiry/reactivation race. Routing tests replay baseline/alternative/no-path/outage
responses and assert polyline precision, units, both-source risk, endpoint exclusions and cap
behavior. Include a sub-0.4 hazard intersecting a route and a detour outside the initial bounds;
neither may silently disappear from risk scoring.

Handoff records schema version/migration commands, confirmed DB durability, API and routing probes,
which real-device checks A ran, tested Valhalla version/campus pairs, configuration, failures and
remaining stubs. Physical-device and HTTPS gates cannot be replaced by fixture tests. Defer soft-cost
OSMnx routing, cross-source merging (hazard feedback follows decision 013), raw event APIs and horizontal scaling until the manual
release works. No contracts or implementation are changed by this planning PR.
