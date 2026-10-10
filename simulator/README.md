# Simulator

Reproducible HTTP scenarios for the manual product first and automation second (Lane F, slices
F1–F4). Python standard library only, plus a dependency-free Node adapter for detector replay. It
talks to the product and observation APIs over HTTP and never imports their code, reads their
databases or resets anything.

Scenario files are JSON rather than the YAML sketched in the lane plan, and the CLI runs from the
source tree with plain `python3` instead of `uv`, so the simulator needs no third-party package,
lockfile or build step.

## Commands

From the repository root (Python 3.11+, nothing to install; Node 22 for replay):

```sh
export PYTHONPATH=simulator/src
python3 -m simulator.cli scenarios
python3 -m simulator.cli manual --seed 42            # dry run: prints payloads
python3 -m unittest discover -s simulator/tests -t simulator
node --test simulator/replay-detector/
```

**Dry run is the default.** Nothing touches the network without `--demo-target` and an explicit
URL. There is no built-in endpoint and no cleanup command.

```sh
# Manual path, automation stopped
python3 -m simulator.cli manual --product-url URL --demo-target
python3 -m simulator.cli manual --scenario manual-expired --product-url URL --demo-target

# HTTP bridge before detection (key from the server-side environment, never an Expo variable)
AUTOMATION_PUBLISH_KEY=... python3 -m simulator.cli publication --product-url URL --demo-target
#   --stop-after create   leaves the simulated hazard on the map for inspection

# Synthetic observations -> worker -> published hazard
python3 -m simulator.cli observations --scenario demo-seed \
  --automation-url OBS_URL --product-url URL --demo-target [--at LAT,LON] [--wait 60]

# Route shape check
python3 -m simulator.cli routes --product-url URL --demo-target

# Recorded ride: trim, then replay through the detector
python3 -m simulator.cli trim --recording RAW_DIR --out TRIMMED_DIR
npm run build --prefix automatic/detector
python3 -m simulator.cli replay --recording TRIMMED_DIR --automation-url OBS_URL --demo-target

# Continue a run with the same IDs and bodies
python3 -m simulator.cli manual --product-url URL --demo-target --resume simulator/runs/FILE.json
```

## Scenarios

| Name | Kind | Expectation |
|---|---|---|
| `manual-report` | manual | 201, identical retry 200 with the same IDs, conflicting reuse 409, exactly one manual hazard with correct source, counts and 24 h expiry |
| `manual-expired` | manual | a report observed 25 h ago is accepted and retryable but never in the active feed |
| `publication-lifecycle` | publication | missing and invalid credential 401; revision 1 creates, retries, revision 2 updates, stale revision 1 gets 409, resolved revision 3 leaves the feed; public ID stable; a manual control report unchanged |
| `braking-spot` | observations | 5 hard brakes from 3 rides → one `braking` hazard, score near 1 |
| `bump-spot` | observations | 4 bumps from 2 rides → one `surface` hazard, no `braking` hazard |
| `two-clusters` | observations | two clusters about 40 m apart → two hazards |
| `demo-seed` | observations | 3 hard brakes from 2 rides → score near 0.6, enough for route exclusion |
| `demo-seed-negative` | observations | 2 events are accepted but nothing may be published |

Observation scenarios use the worker's own thresholds (12 m, 3 events, 2 rides); none lowers them.
Everything generated is labeled `simulated` and demo reports say `DEMO`. `--at LAT,LON` moves a
scenario, for example onto a route you can see in the app.

## Run identity

Each run freezes one clock reading and derives every ID with UUIDv5 from (scenario, seed, time),
so the same `--seed` and `--now` always print the same bodies. A live run writes a manifest under
`simulator/runs/` (ignored by git) holding the scenario hash, endpoints, every request body and
the evidence log. `--resume` replays those exact bodies and refuses a changed scenario, seed or
URL. The publication key is never written to a manifest or a log.

Temporary failures (network, 408, 429, 5xx) are retried a few times with the same bytes. 409 and
422 fail the scenario immediately.

## Reading the evidence

Each step prints one JSON line and the run ends with `PASS` or `FAIL`. These are different claims
and the output keeps them apart:

- **payload generated** (dry run) — nothing was sent;
- **accepted by the observation API** — not yet a hazard;
- **published hazard seen on the public feed** — the worker and bridge worked;
- **route response** — if the server answered with its fixed example (`X-Stage-0-Stub`), the output
  says so and does not count it as hazard-aware routing.

Device rendering is a separate manual check on a phone.

## Replay

`replay-detector/replay.mjs` reads `motion*.csv` and `gps*.csv`, merges them by timestamp (GPS fix
first on a tie), feeds Lane B's detector through its public interface and prints the events. It
never invents a final sample. `python -m simulator.cli replay` then uploads those events and the
GPS points as `source: replay`, shifted by one offset so the latest sample sits at the run time.
See [recorded/README.md](recorded/README.md) for the file format and privacy rules.

## What has and has not been verified

Verified: 42 Python tests (generators, validation, manifests, trimming, and every scenario flow
against in-memory HTTP stand-ins in `tests/fakes.py`) and 4 Node tests. The replay test also
passes against Lane B's real detector (one hard brake and one bump from the synthetic ride); on a
checkout with only the stage 0 detector skeleton it expects no events.

**Not verified:** no scenario has been run against the real product API, the real observation
service or Lane D's worker, and no real recording exists. The stand-ins implement only the
contract behaviour the scenarios check and prove nothing about the real services. Deferred:
`closure-diversion`/abandonment, the combined hosted rehearsal (F5) and real-ride tuning.
