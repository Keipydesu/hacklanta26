# Collector

A separate, opt-in Expo app for the automatic track (Lane B, slices B2–B4). It reads motion and
GPS on the phone, runs the [detector](../detector/README.md) locally, removes the first and last
100 m of every ride, and uploads only detected events and trimmed location points to the
observation API. It has no product API URL and no publication credential, and `mobile/` does not
depend on it.

```text
DeviceMotion 50 Hz ─┐
                    ├─ adapter ─ detector ─ event ─┐
GPS 1 Hz ───────────┘                              ├─ privacy buffer ─ durable queue ─ POST observation API
        └────────────── point ─────────────────────┘
raw samples ─ (only if recording is switched on) ─ CSV files on this phone
```

## Modes

| Mode | What it does | Evidence label |
|---|---|---|
| Device ride | Motion + foreground GPS while the screen stays open. All quality and privacy gates on. | `device` |
| Indoor demo | Synthetic demonstration: fixed campus coordinates (GSU, 33.7531, -84.3853), no location permission, detector `demoMode`, no trimming. The screen shows a **DEMO** badge. Uploads events only, never points. | `simulated` |

The label is written into each observation when it is created and is part of the frozen upload
body, so switching mode can never relabel something already queued.

**Indoor demo walk-through.** Choose *Indoor demo*, turn on the agreement switch, start, then give
the phone one firm push lasting about half a second (a horizontal acceleration of 0.35 g or more
held for 300 ms). One `hard_brake` event appears under *Detected*, is saved, and is sent to the
observation API. A sharp tap along gravity produces a `bump`. The demo's speed fields echo
synthetic fixes (0 m/s); they are not measurements. Lane D only publishes a hazard from at least
3 events across at least 2 rides within 12 m, so run two short demo rides with three jerks in
total to see an automatic hazard appear.

## Privacy rule

`src/privacy/trim.ts` accumulates distance travelled from accepted GPS fixes. A point or event is
released to the upload queue only when it is more than 100 m past the start **and** the rider has
since travelled more than 100 m beyond it. Stopping the ride, or the app leaving the foreground,
discards everything still held. A ride of 200 m or less uploads nothing. Events are placed by the
time of their peak, not by when the detector reported them.

Starting gap/jump policy, to be revisited with device traces:

- fixes with unknown accuracy or accuracy worse than 20 m are ignored;
- a fix implying more than 15 m/s from the previous accepted fix is ignored as a jump;
- distance advances only after moving at least 5 m and at least the sum of both fixes' reported
  accuracy, so GPS jitter while parked cannot walk the rider out of the private zone;
- a fix with unknown speed still measures distance but is not uploaded as a point.

Nothing raw or held is ever written to the upload queue. If the app is killed mid-ride, held data
is lost by design.

## Upload queue

`src/queue/store.ts` persists each batch to AsyncStorage before any network call and resends the
identical bytes, so a lost response or a restart is safe (the observation API counts repeated UUIDs
as duplicates). Events are split at 500 per batch and points at 2000 per ride. Eligible points are
flushed about every 10 s and at the end of the ride.

| Outcome | Behaviour |
|---|---|
| network error, timeout, 408, 429, 5xx | bounded exponential backoff with jitter; `Retry-After` honoured; after 8 attempts the batch waits for an explicit *Retry the same batch* |
| 409, 422, other 4xx | the whole batch is marked rejected and shown; it is never mutated or retried, only discarded deliberately |
| queue holds 20,000 observations | new work is refused and the ride stops with a message |
| storage write fails | nothing is claimed as queued; the ride stops with a message |

Without `EXPO_PUBLIC_AUTOMATION_API_URL` observations stay queued on the phone.

## Local recorder

Off by default. When the *record raw sensors* switch is on for a ride, raw samples are written to
the app's private documents directory under `recordings/ride-<uuid>/`:

| File | Columns |
|---|---|
| `motion-NNNN.csv` | `t_ms,ax,ay,az,gx,gy,gz` — epoch ms; gravity-removed acceleration and gravity in m/s² |
| `gps-NNNN.csv` | `t_ms,lat,lon,speed_mps,accuracy_m` — blank speed/accuracy means unknown, never zero |
| `labels-NNNN.csv` | `t_ms,type` — optional manual labels |
| `meta.json` | ride id, units, `"trimmed": false` |

A recording is raw and contains the ride's endpoints. Before sharing one or using it for replay,
remove the first and last 100 m and the events inside them and set `trimmed: true`. Never commit a
raw recording. There is no in-app export yet; pull the files from the device with platform tools.

## Commands

From the repository root (Node 22 LTS):

```sh
npm ci --prefix automatic/collector
npm run typecheck --prefix automatic/collector
npm test --prefix automatic/collector
npm run build --prefix automatic/collector
EXPO_PUBLIC_AUTOMATION_API_URL=http://YOUR_LAN_IP:8001 npm start --prefix automatic/collector
```

`npm test` compiles the pure modules and the detector to `.test-dist/` and runs 44 Node tests:
adapter units and timestamps, privacy trimming, queue/transport retry and rejection, recorder
format, and the ride controller end to end with fake sensors.

`metro.config.js` adds `../detector` as a watch folder and maps its Node-style `.js` import
specifiers to the TypeScript sources.

## What has and has not been verified

Verified in Node: everything `npm test` covers, including that no released observation lies in
either endpoint zone, a short ride uploads nothing, denied permissions fail visibly, a restart
after an unknown HTTP outcome resends identical bytes, and one qualifying demo jerk yields exactly
one `simulated` event.

Verified by CI on the pull request (the collector job): `npm ci` with the lockfile below,
`npm run typecheck`, and `npm run build` (iOS and Android bundle export, which exercises the Metro
resolver for the detector folder).

About the lockfile: it was edited by hand because the change was written without access to the npm
registry. `expo-location`, `expo-crypto` and AsyncStorage entries are copied from
`mobile/package-lock.json`, `expo-keep-awake` and `expo-file-system` are the entries Expo already
pulled in (moved to the top level), and `expo-sensors` was added from registry metadata. `npm ci`
accepts it; running `npm install --prefix automatic/collector` once will normalize it.

**Not verified yet:**

- No physical phone has run this app. A bundle export is not a device test: sensor units, axis
  conventions, real sample rates, permission prompts and keep-awake behaviour must be checked on
  each target device, and the detector thresholds are untuned (see
  [TUNING.md](../detector/TUNING.md)).
- No real ride has been recorded.

## Dependencies added (review date 2026-10-10)

| Package | Version | Basis |
|---|---|---|
| `expo-sensors` | 55.0.18 (exact) | The version Expo SDK 55's `bundledNativeModules.json` names (`~55.0.18`); published from `expo/expo` by an Expo maintainer; one runtime dependency (`invariant`, already present); no install scripts; registry signature present, no provenance attestation. Deliberately not 55.0.19 or the 57.x `latest`. Publish date and advisory databases were not checked beyond an empty OSV listing — a reviewer should confirm before merge. |
| `expo-location` | 55.1.14 (exact) | Same version and lock entry Lane A reviewed in PR #10. |
| `@react-native-async-storage/async-storage` | 2.2.0 (exact) | Same version and lock entry Lane A reviewed in PR #9. |
| `expo-crypto` | ~55.0.8 → 55.0.19 | Same lock entry `mobile/` already uses; needed for random ride and observation UUIDs. |
| `expo-keep-awake`, `expo-file-system` | 55.0.8, 55.0.26 | Already installed as dependencies of `expo` itself; now imported directly. |

No product publication credential, analytics, or background-location capability is added.
