# Lane F: Independent fixtures and simulation

## Purpose, baseline and ownership

Provide reproducible HTTP demonstrations of the manual product first and automation second.
Follow [the architecture](../../ARCHITECTURE.md), [roadmap](../ROADMAP.md), and
[delivery workflow](../decisions/001-mvp-delivery-workflow.md).

**Owns:** `simulator/`. Slices F1–F4 are implemented: the scenario CLI, resumable HTTP
probes, observation generators, recording trimming and detector replay. F5 (the combined hosted
rehearsal), abandonment scenarios and real-ride tuning remain deferred. See the
[simulator README](../../simulator/README.md) for commands and verification limits.

Stage 0 in [PR #1](https://github.com/Keipydesu/hacklanta26/pull/1) supplied contract fixtures and
a standalone publication probe under `contracts/`; the simulator builds on those frozen API
semantics without changing them. The implementation uses JSON scenarios and a standard-library
Python CLI invoked from the source tree, replacing the original YAML and `uv` proposal. No
third-party simulator dependency, lockfile or package installation is required.

The simulator uses separate product and observation HTTP URLs. It never imports product or
observation service internals, queries their databases, or owns reset operations. A standalone
Node replay adapter may import Lane B's public detector API; it never imports the manual app.

## Implemented structure

```text
simulator/
  pyproject.toml              Python CLI metadata
  src/simulator/
    cli.py                   explicit subcommands and configuration
    models.py                scenario/run manifest validation
    clock.py                 frozen run time and timestamp rebasing
    identity.py              deterministic UUID allocation
    transport.py             bounded HTTP batches and response checks
    manual.py                report and read scenario
    publication.py           revision lifecycle bridge
    observations.py          braking/bump/cluster generation
    replay.py                upload detector output and GPS
    assertions.py            aggregate feed and route checks
  scenarios/                 JSON inputs and expected outcomes
  replay-detector/            Node adapter using Lane B's public interface
  recorded/README.md          CSV format, trimming and consent rules
  tests/                     pure generators and HTTP-stub scenarios
  README.md                  run commands and prerequisites
```

The Python CLI handles generation and HTTP requests using only the standard library. The
separately runnable Node adapter uses Lane B's public detector interface and the CSV format
documented in [recorded/README.md](../../simulator/recorded/README.md). Scenario files contain
configuration and expected outcomes, never secrets, raw private endpoints or database credentials.

## Data flow and methods

```text
scenario + seed + fixed run time → deterministic payloads → persisted run manifest
                                                 ↓
                  product reports/publications OR private observations API
                                                 ↓
                    bounded polling of public aggregate feed → assertions

privacy-reviewed CSV → Node detector replay → derived events + trimmed GPS → observation API
```

| Implemented entry point | Responsibility |
|---|---|
| `models.load_scenario` | Load and validate JSON scenario configuration before network writes. |
| `cli.start_run`, `models.RunManifest` | Freeze an aware UTC clock, persist run identity, endpoints and requests, and validate resume inputs without storing credentials. |
| `identity.run_namespace`, `identity.item_id` | Derive UUIDv5 identities from scenario/seed/time and stable item keys; resume reuses the saved bodies. |
| `manual.generate_manual`, `manual.run_manual` | Generate a demo report and check create/read/retry/conflicting-reuse behavior. |
| `observations.generate_observations`, `observations.send_observations` | Generate seeded simulated events and points, batch at 500 events/2000 points, and check identical retries. |
| `publication.run_publication_lifecycle` | Persist complete payloads, then probe authorization, create/retry/update/stale rejection/resolve and manual preservation. |
| `assertions.await_hazards` | Poll public aggregates within a bounded deadline; ingestion alone does not prove publication. |
| `assertions.compare_routes` | Check route shape and metrics and identify fixed stub responses. Real hazard-aware routing remains an integration check. |
| `replay.trim_recording`, `replay.rebase_recording`, `replay.send_replay` | Remove endpoint segments, shift timestamps by one offset preserving order, and upload replay evidence with stable IDs. |

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
- `demo-seed`: at least three fresh simulated events from at least two distinct rides within
  12 m, using the same clustering thresholds as D. Three fresh events score near 0.6 before
  decay and can demonstrate route exclusion. A two-event variant is a negative control: it
  ingests successfully but must not publish a cluster. No service demo flag implicitly lowers
  the agreed count/ride thresholds or proves real detection.

Synthetic observation coordinates represent already-trimmed data; do not trim them again.
Scenario JSON records relative timestamps, ride counts, evidence source, expected kinds,
location tolerances and prerequisites; the CLI seed is saved in the run manifest. Worker scoring
assertions freeze evaluation time where possible; live assertions use tolerances accounting for elapsed time. Publication must retain
simulated/replay/mixed labels all the way to the public feed.

## Recorded replay and privacy boundary

The implemented adapter accepts these files (see the recording README before collecting real rides):

- Motion CSV: `t_ms,ax,ay,az,gx,gy,gz`; epoch milliseconds, gravity-removed acceleration and gravity
  vectors in metres/second squared, matching the detector interface.
- GPS CSV: `t_ms,lat,lon,speed_mps,accuracy_m`; document blank speed as unknown internally and
  never coerce it to zero. Do not upload observations lacking required valid measurements.
- Optional labels CSV: `t_ms,type`; manually reviewed event labels, plus comparison tolerances in
  adjacent metadata.

The Node adapter merges streams by timestamp with GPS first on timestamp ties, calls
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

1. **F1 — Implemented: CLI and manual scenario.** JSON validation, dry-run, frozen-clock
   manifests, HTTP client and manual retry/read/expired-report flows have HTTP-stand-in coverage.
   Restart persistence and real routing remain integration checks against C's implementation.
2. **F2 — Implemented: publication lifecycle.** Resumable create/update/resolve, authorization
   probes and manual preservation use the product HTTP boundary. A checks device labels separately.
3. **F3 — Implemented: observation generators.** Braking/bump/two-cluster and demo-seed scenarios,
   bounded batching, retries and aggregate polling have HTTP-stand-in coverage. Real-worker
   verification of braking-spot, bump-spot and two-clusters remains outstanding.
4. **F4 — Implemented: replay integration.** CSV trimming, Node adapter, timestamp rebasing and
   stable replay identities have synthetic tests. Real recordings and sensor-quality validation
   remain outstanding; a stage-0 detector produces no events.
5. **F5 — Deferred: combined hosted rehearsal.** Manual report → map, observations → D publication
   → same map, routes using both sources, then stop automation and submit another manual report.
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

Simulator commands from the repository root (Python 3.11+, no Python installation step):

```sh
export PYTHONPATH=simulator/src
python3 -m simulator.cli scenarios
python3 -m simulator.cli manual --dry-run --seed 42
python3 -m unittest discover -s simulator/tests -t simulator
```

Live examples require demo URLs; replace `URL`, `OBS_URL` and `RUN_MANIFEST` with your targets.
Publication also requires `AUTOMATION_PUBLISH_KEY` in the server-side shell environment.

```sh
python3 -m simulator.cli manual --product-url URL --demo-target --seed 42
python3 -m simulator.cli publication --product-url URL --demo-target --resume RUN_MANIFEST
python3 -m simulator.cli observations --scenario braking-spot \
  --automation-url OBS_URL --product-url URL --demo-target
```

Replay and its Node tests require Node 22 and a built detector. From the repository root:

```sh
npm ci --prefix automatic/detector
npm run build --prefix automatic/detector
node --test simulator/replay-detector/*.test.mjs
# Replace the directory placeholders with your local recording paths:
python3 -m simulator.cli trim --recording RAW_DIR --out TRIMMED_DIR
python3 -m simulator.cli replay --recording TRIMMED_DIR --automation-url OBS_URL --demo-target
```

Dry-run is the default; network writes require explicit demo-target selection, and resume verifies
that selection against its manifest. No implicit production endpoint and no destructive cleanup.
G owns any explicitly selected demo-database reset. Unit tests cover deterministic IDs/time,
batching and rebasing; HTTP-stub tests cover identical retries and expected failures. Add a
Lane F CI job through G: the simulator manifest now exists, but its CI job is supplied separately
in [PR #18](https://github.com/Keipydesu/hacklanta26/pull/18). Use actual API smoke tests for the
manual and bridge gates rather than broad load testing.

Every handoff records scenario/seed/frozen time, target environment, IDs and statuses, source labels,
commands actually run and assertion output. Separate generated payloads, accepted ingestion,
published hazards and observed device rendering: each is different evidence. Report missing real
routing, worker, deployment or recorded rides explicitly instead of labeling the combined demo done.
