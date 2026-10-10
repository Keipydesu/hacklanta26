# Lane F: Independent fixtures and simulation

## Purpose, baseline and ownership

Provide reproducible HTTP demonstrations of the manual product first and automation second.
Follow [the architecture](../../ARCHITECTURE.md), [roadmap](../ROADMAP.md), and
[delivery workflow](../decisions/001-mvp-delivery-workflow.md).

**Owns:** `simulator/`. This directory is planned, not implemented. Stage 0 in
[PR #1](https://github.com/Keipydesu/hacklanta26/pull/1) supplies contract fixtures and a standalone
publication probe under `contracts/`; PR #1 is now merged. Reuse that probe to
validate the bridge now; the simulator adds scenarios, durable run identity and replay later.
Do not duplicate or silently change the frozen APIs. Method names and the layout below are
proposals for implementation, not claims about existing commands.

The simulator uses separate product and observation HTTP URLs. It never imports product or
observation service internals, queries their databases, or owns reset operations. A standalone
Node replay adapter may import Lane B's public detector API; it never imports the manual app.

## Proposed structure

```text
simulator/
  pyproject.toml              Python CLI/dependencies owned here
  src/simulator/
    cli.py                   explicit subcommands and configuration
    models.py                scenario/run manifest validation
    clock.py                 frozen run time and timestamp rebasing
    identity.py              deterministic UUID allocation
    transport.py             bounded HTTP batches and response checks
    manual.py                report and read scenario
    publication.py           revision lifecycle bridge
    observations.py          baseline/braking/diversion generation
    replay.py                upload detector output and GPS
    assertions.py            aggregate feed and route checks
  scenarios/                 YAML inputs and expected outcomes
  replay-detector/            Node adapter using Lane B's public interface
  recorded/README.md          CSV format, trimming and consent rules
  tests/                     pure generators and HTTP-stub scenarios
  README.md                  run commands and prerequisites
```

Use a Python CLI for generation and HTTP requests; add dependencies only to the simulator's own
manifest. Keep the Node adapter separately runnable for the TypeScript detector and agree its
CSV/output interface with B before either side implements it. Scenario files contain configuration
and expected outcomes, never secrets, raw private endpoints or database credentials.

## Data flow and methods

```text
scenario + seed + fixed run time → deterministic payloads → persisted run manifest
                                                 ↓
                  product reports/publications OR private observations API
                                                 ↓
                    bounded polling of public aggregate feed → assertions

privacy-reviewed CSV → Node detector replay → derived events + trimmed GPS → observation API
```

| Proposed method | Responsibility and implementation |
|---|---|
| `load_scenario(path) -> Scenario` | Validate coordinates, relative times, counts, evidence source and expectation tolerances before any network writes. Reject missing or contradictory inputs. |
| `new_run(scenario, seed, now) -> RunManifest` | Freeze an aware UTC clock once; allocate a run UUID namespace and persist scenario version/hash, endpoints, IDs, payloads and next publication revision. Do not persist credentials. |
| `item_id(run_id, scenario, item_key) -> UUID` | Use UUIDv5 over stable logical item keys. An explicit resume reuses the namespace and exact body; a fresh run gets a new namespace and may rebase timestamps. |
| `generate_manual(run) -> Report` | Produce a current GSU report with a description explicitly identifying demo data. Generate ID and observation time once. |
| `generate_observations(run, scenario) -> ObservationSet` | Generate distinct ride UUIDs, events and per-ride points using a seeded RNG and the frozen clock; all synthetic evidence has `source: simulated`. |
| `send_batch(endpoint, frozen_body) -> IngestResult` | Enforce limits of 500 events or 2000 points, preserving per-ride point paths. Retry transport errors/temporary server errors with bounded backoff using identical payloads. Treat 409/422 as a failed scenario, not an endless retry. |
| `run_publication_lifecycle(run, client) -> Evidence` | Persist each complete payload before sending, then create/retry/update/stale-probe/resolve. Check stable public ID, revisions and expected status codes at each step. |
| `await_hazards(expected, deadline) -> Evidence` | Poll a bounded GSU bbox until aggregate predicates pass or a fixed deadline expires. Report missing expectations and last response on timeout; never infer success from ingestion alone. |
| `compare_routes(origin, destination) -> Evidence` | Check response kinds, source hazard IDs, availability flag and nonnegative metrics; do not promise a distinct lower-risk line when the API reports no alternative. |
| `rebase_recording(samples, run_time) -> samples` | Shift all timestamps by one offset while preserving gaps and event order, ensuring the latest sample is no later than run time. Playback speed controls scheduling, not sensor timestamps. |

A run manifest lives in an ignored local output directory. Resume refuses a changed scenario,
endpoint or payload rather than pairing old IDs with new bodies. Dry-run emits deterministic
payloads and expected requests without network activity. Output logs omit bearer headers.
HTTP clients have connect/read timeouts and a bounded retry budget; errors include scenario,
operation, item ID and status, never credentials.

## Scenario design and expected results

### Manual release path (milestones 1–2)

`manual-report` creates a demo-labeled report, reads its returned hazard ID from the GSU bbox,
repeats the exact submission, then deliberately probes conflicting reuse. Expect 201, duplicate
200, then 409; there must still be one manual hazard. Check source/counts/expiry and that the
returned ID survives an API restart once C persistence exists. Restart is an operator/infra step,
not a simulator database operation. Run with automatic services stopped.

A separate expired-report case uses an observation older than 24 hours: acceptance and duplicate
identity must work, but the hazard must stay off active reads. Route comparison waits for C/G's
real routing; a fixed stage-0 route response cannot prove hazard-aware routing. Device rendering
is an A-owned manual check alongside this API evidence.

### HTTP bridge before detection (milestones 0/3)

`publication-lifecycle` sends a known GSU polygon with `evidence_source: simulated` and a
server-side CLI credential from `AUTOMATION_PUBLISH_KEY`. Revision 1 creates, identical revision
1 retries, changed revision 2 updates, stale revision 1 rejects, and complete resolved revision
3 removes it from active reads. Preserve public ID throughout; include a manual control hazard
and assert it remains unchanged. Allow a deliberate stop after create so A can inspect labels.
The collector must never receive this credential. Missing/invalid credentials are separate
expected 401 probes. This scenario bypasses detection deliberately.

### Automatic observations (milestones 3–4)

- `braking-spot` (legacy `pothole` scenario): at least three hard-brake events from at least two
  rides within 12 m; five fresh events provide score near 1 before decay. Expect `braking`, not
  `surface`, near the configured spot. A bump scenario uses bump events and expects `surface`.
  Do not mistake accepted events for a published hazard: wait for D's aggregate result.
- `two-clusters`: place same-kind clusters more than 12 m apart, optionally within one configured
  H3 cell. Each independently satisfies count/ride thresholds. Expect two persistent identities
  after repeat evaluation; geometry matching uses distance/overlap tolerances, not hardcoded UUIDs.
- `closure-diversion` (deferred abandonment): provide daily rides over the full days-3-through-14
  baseline and recent 48-hour window on two nearby parallel GSU corridors. Compare daily means,
  not a two-day total against a one-day baseline. Example: baseline 10 rides/day on each corridor,
  recent closed corridor 2/day and diverted corridor 15/day. Expect under 30% and over 130%
  respectively, with diversion within two H3 rings. Agree H3 resolution and UTC day boundaries
  with D before generation; do not invent them as a public contract here.
- `demo_seed`: at least three fresh simulated events from at least two distinct rides within
  12 m, using the same clustering thresholds as D. Three fresh events score near 0.6 before
  decay and can demonstrate route exclusion. A two-event variant is a negative control: it
  ingests successfully but must not publish a cluster. No service demo flag implicitly lowers
  the agreed count/ride thresholds or proves real detection.

Synthetic observation coordinates represent already-trimmed data; do not trim them again.
Scenario YAML records seed, relative timestamps, ride counts, evidence source, expected kinds,
location tolerances and prerequisites. Worker scoring assertions freeze evaluation time where
possible; live assertions use tolerances accounting for elapsed time. Publication must retain
simulated/replay/mixed labels all the way to the public feed.

## Recorded replay and privacy boundary

Agree these files with Lane B before recording:

- Motion CSV: `t_ms,ax,ay,az,gx,gy,gz`; epoch milliseconds, gravity-removed acceleration and gravity
  vectors in metres/second squared, matching the detector interface.
- GPS CSV: `t_ms,lat,lon,speed_mps,accuracy_m`; document blank speed as unknown internally and
  never coerce it to zero. Do not upload observations lacking required valid measurements.
- Optional labels CSV: `t_ms,type`; manually reviewed event labels, plus comparison tolerances in
  adjacent metadata.

The Node adapter merges streams by timestamp with a deterministic tie rule agreed with B, calls
`pushMotion`/`pushLocation`, captures `onEvent` and resets between rides. Use the detector API as
is; propose any missing end-of-stream behavior to B rather than fabricating samples or changing
its interface. Python uploads derived events and GPS with stable UUIDs and `source: replay`.

Real recordings must lose their first and last 100 m before upload or sharing, including derived
events in those segments. Track trimming provenance in metadata so the privacy-reviewed fixture
is not trimmed repeatedly. Preserve complete unshared local recordings only in B's deliberate
recorder workflow. A stopped/short ride with no interior must upload nothing. Never commit raw
identifying endpoints; three consented, reviewed rides support later tuning but do not block the
manual release. If recordings are unavailable, report that gap and use synthetic tests honestly.

## Implementation slices and dependencies

1. **F1 — CLI and manual scenario.** Using the merged stage-0 contracts, add own manifest,
   validated config, dry-run, frozen-clock run manifests, HTTP client and manual retry/read flow.
   Develop against the product stub. Exit: exact retry bodies and expected status codes; mark
   restart persistence and real routing as pending C. Supply commands to G for demo seeding.
2. **F2 — Publication lifecycle.** Reuse stage-0 fixture semantics, add resume and assertion output.
   Exit: create/update/resolve and manual preservation work against product HTTP before D exists.
   A confirms visible source/evidence labels independently.
3. **F3 — Observation generators.** Add braking/bump/two-cluster scenarios, batching and observation
   retries with stub HTTP tests. D supplies the worker for hazard assertions; until then record
   ingestion-only evidence explicitly. Agree expected geometry and score tolerances with D.
4. **F4 — Replay integration.** Agree CSV metadata with B, implement Node adapter and rebased
   uploads, and test with synthetic CSV before consented rides exist. Exit: same data/seed/clock
   produces identical events and retry payloads. Sensor quality claims await recorded labels.
5. **F5 — Combined rehearsal.** Manual report → map, observations → D publication → same map,
   routes using both eligible sources, then stop automation and submit another manual report.
   G supplies demo URLs and lifecycle controls, A checks phones, C/D provide service behavior.
   A product outage must leave D publications pending and recover without duplicates.
6. **Later:** closure-diversion/abandonment and real-ride tuning follow the brake/bump path. Do not
   let them block milestones 1–2 or add dashboard, continuous rider tracking or database dual writes.

## Verification, commands and handoff

The existing stage-0 probe is runnable today:

```sh
python3 contracts/scripts/publish_fixture.py --dry-run
# Against an explicitly selected demo product API with a CLI environment credential:
python3 contracts/scripts/publish_fixture.py --lifecycle
```

Proposed simulator CLI commands, to become runnable in F1–F4 and documented in its README:

```sh
uv sync --project simulator
uv run --project simulator python -m simulator.cli manual --dry-run --seed 42
uv run --project simulator python -m simulator.cli manual --product-url URL --demo-target --seed 42
uv run --project simulator python -m simulator.cli publication --resume RUN_MANIFEST
uv run --project simulator python -m simulator.cli observations --scenario braking-spot --automation-url URL --demo-target
uv run --project simulator python -m simulator.cli replay --recording DIRECTORY --automation-url URL --demo-target
```

Dry-run is the default; network writes require explicit demo-target selection, and resume verifies
that selection against its manifest. No implicit production endpoint and no destructive cleanup.
G owns any explicitly selected demo-database reset. Unit tests cover deterministic IDs/time,
batching and rebasing; HTTP-stub tests cover identical retries and expected failures. Add a
Lane F CI job through G only once the runnable manifest exists. Use actual API smoke tests for the
manual and bridge gates rather than broad load testing.

Every handoff records scenario/seed/frozen time, target environment, IDs and statuses, source labels,
commands actually run and assertion output. Separate generated payloads, accepted ingestion,
published hazards and observed device rendering: each is different evidence. Report missing real
routing, worker, deployment or recorded rides explicitly instead of labeling the combined demo done.
