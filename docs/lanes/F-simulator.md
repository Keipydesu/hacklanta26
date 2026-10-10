# Lane F: Independent fixtures and simulation

Supports two demos: manual reporting first, automatic detection later.

**Owns:** `simulator/`. Uses HTTP only, with separate product and observation API base URLs.

## What to build

1. **Manual demo.** Submit a reproducible report fixture to `POST /v1/reports`. Confirm it appears in the combined hazard feed with automatic services stopped. Use a stable submission UUID for retry tests. Run synthetic manual reports only in the dedicated demo environment and label their descriptions as demo data.
2. **Automatic fixture publisher.** Send a known polygon to `PUT /v1/automatic/hazards/{external_id}` using the server-side key read from the CLI environment. Publish revision 1, retry it, update with revision 2, and resolve with revision 3. Show the unchanged manual app rendering it. This bypasses detection deliberately to test the integration boundary; mark evidence as simulated.
3. **Observation generation.** Send events and points to the separate automatic service. Use UUIDs for every item and `source: simulated`. Seed 14 days of campus baseline rides, a repeated hard-braking spot (`pothole` scenario), a closure with traffic diverted to a parallel route, and a two-event `demo_seed`. Scenario YAML contains expected output locations for worker tests. Support seed reproducibility, batching (500 events/2000 points), and dry-run output.
4. **Recorded replay.** Specify motion CSV (`t_ms,ax,ay,az,gx,gy,gz`), GPS CSV (`t_ms,lat,lon,speed_mps,accuracy_m`), and optional labels (`t_ms,type`). Lane B's collector writes them. Replay through the standalone detector to produce event fixtures; Python replay uploads derived events and GPS with timestamps shifted to now, source replay, stable UUIDs and adjustable speed. Remove identifying endpoints before committing real recordings.
5. **Combined demonstration.** Manual report → map, automatic observations → worker → publication API → same map, then route comparison. Stop automation and submit another manual report to prove independence. Keep synthetic data in the demo environment and evidence labels visible.

## Scenario requirements

- Include two parallel routes around GSU for closure and routing comparisons.
- Baseline exceeds 5 rides/cell/day; recent closed-route traffic falls below 30% while nearby diverted traffic exceeds 130% of its own baseline.
- Synthetic observations represent already-trimmed data; do not trim them a second time.
- `pothole` currently simulates braking evidence and must expect a `braking` hazard, not a surface classification.

## Done when

- Manual scenario works with the automatic service absent.
- Fixture publication/update/resolution works before real detection is available.
- Retry scenarios create no duplicate reports, observations or published hazards.
- Sensor scenarios produce the expected hazards through HTTP publication with visible evidence labels.
- Three privacy-reviewed recorded rides support detector tuning, without blocking manual release.
