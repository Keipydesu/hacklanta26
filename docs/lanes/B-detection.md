# Lane B: Independent detection and collector

Turns raw phone motion into "hard brake" and "bump" events. Pure TypeScript with no React Native imports, so it runs and tests in plain Node.

**Owns:** `automatic/detector/`, `automatic/collector/`.
**Connects to:** the separate observation API, never the product database or manual mobile app.
**Reads:** `simulator/recorded/` (real ride CSVs).
**Exports:** `createDetector` as defined in ARCHITECTURE.md section 6.

## What to build

1. **Config** (`automatic/detector/config.ts`). `DetectorConfig` with defaults:

   | Field | Default | Meaning |
   |---|---|---|
   | `brakeThresholdG` | 0.35 | Smoothed horizontal g that starts a candidate |
   | `brakeReleaseG` | 0.25 | Level that ends a candidate (hysteresis) |
   | `brakeMinDurationMs` | 300 | Shorter candidates are discarded |
   | `smoothingWindowMs` | 200 | Moving-average window |
   | `minSpeedBeforeMps` | 3 | Slower than this is walking |
   | `minSpeedDropMps` | 2 | Required GPS speed drop |
   | `speedDropWindowMs` | 2000 | Window for the drop |
   | `maxAccuracyM` | 20 | Worse fixes are ignored |
   | `brakeRefractoryMs` | 3000 | Minimum gap between brake events |
   | `bumpThresholdG` | 1.0 | Vertical spike size |
   | `bumpMaxDurationMs` | 150 | Longer than this is not a bump |
   | `bumpMinSpeedMps` | 2 | Bumps only count while moving |
   | `bumpRefractoryMs` | 1000 | Minimum gap between bump events |
   | `demoMode` | false | Skips the GPS speed check |

2. **Signal math** (`signal.ts`). For each `MotionSample`:
   - Unit gravity: `g = gravity / |gravity|`.
   - Vertical component: `v = accel · g`.
   - Horizontal vector: `h = accel - v * g`.
   - Horizontal g: `|h| / 9.80665`. Vertical g: `v / 9.80665`.
   This needs no knowledge of how the phone sits in a pocket.
3. **Buffers** (`buffers.ts`). Time-based ring buffers: about 3 s of motion and 5 s of location fixes. Use timestamps, not sample counts, because the real sample rate jitters.
4. **Brake state machine** (`brake.ts`).
   - *Idle → candidate* when smoothed horizontal g reaches `brakeThresholdG`. Record the start time.
   - While in candidate, track peak g.
   - *Candidate → pending* when it drops below `brakeReleaseG`, if the duration is at least `brakeMinDurationMs`. Otherwise back to idle.
   - *Pending → emit or discard.* Wait for location fixes up to `speedDropWindowMs` after the start. Speed before is the last good fix before the start. Speed after is the lowest good fix inside the window. Emit only if speed before is at least `minSpeedBeforeMps` and the drop is at least `minSpeedDropMps`.
   - In `demoMode`, skip the speed test and emit as soon as the candidate qualifies. A location fix is still required; the collector supplies fixed ones in demo mode.
   - After emitting, ignore new candidates for `brakeRefractoryMs`.
5. **Bump detector** (`bump.ts`). Subtract a short moving mean from vertical g, then look for a spike of at least `bumpThresholdG` that lasts under `bumpMaxDurationMs` while the latest speed is at least `bumpMinSpeedMps`.
6. **Event location.** Use the good fix nearest in time to the peak. If there is no fix within 3 s that meets `maxAccuracyM`, drop the event.
7. **Public API** (`index.ts`). `createDetector(config)` returning `pushMotion`, `pushLocation`, `onEvent`, `reset`. No timers and no globals: all state advances only when samples are pushed, which makes replay tests exact.
8. **Tests** (`__tests__/`).
   - Synthetic: clean brake, hard acceleration (no event), sharp swerve at constant speed (no event), walking (no event), brake with bad GPS accuracy (no event), two brakes inside the refractory period (one event), curb hit (one bump).
   - Recorded: load each ride in `simulator/recorded/` and compare against its labels file when one exists.
9. **Tuning notes** (`TUNING.md`). After real rides, write down what the thresholds were changed to and why.

## Collector (also owned by this lane)

Build a separate Expo test app in `automatic/collector/`. This is a development tool for automatic sensing, not another monitoring web app or a dependency of the manual user app.

1. **Collection lifecycle.** Explicit start/stop; ask for foreground location and motion permission, create a random ride UUID, keep the screen on, and reset the detector on start. Feed motion at 50 Hz and location at 1 Hz. Compute gravity as accelerationIncludingGravity minus acceleration, and validate axis conventions on both phone platforms.
2. **Privacy and uploads.** Trim the first and last 100 m before upload using a trailing buffer. Give each event and location point a stable UUID. Send events and 10-second point batches to the observation API from ARCHITECTURE.md section 6; persist an offline queue and retry identical payloads. Never include the worker's product-publication credential.
3. **Recorder.** Deliberately enabled local CSV capture matching `simulator/recorded/README.md`. Remove identifying endpoints before sharing real fixtures. Recorder output and labeled rides support detector tests without the manual app.
4. **Indoor demo.** Supply a fixed test coordinate, disable speed checks and privacy trimming only in explicit demo mode, mark outgoing evidence as simulated, and show a visible DEMO badge.
5. **Independent smoke test.** Collector → observation API works with the manual app closed. Recorded data replays through the detector in Node; the manual app builds with the entire `automatic/` tree absent.

## Watch out for

- The speed-drop check is what separates braking from accelerating or cornering, since horizontal magnitude has no sign. Do not remove it outside `demoMode`.
- GPS speed lags by a second or two. That is why confirmation waits rather than deciding at the moment of the spike.
- iOS reports invalid speed as a negative number. the collector converts it to `null`; treat `null` as unknown, not zero.
- Starting values are guesses. Scooter decks vibrate a lot, so expect to raise the smoothing window before lowering thresholds.

## Done when

- All synthetic tests pass in plain Node.
- At least three recorded rides replay with the expected events.
- In `demoMode`, one hand jerk produces exactly one event.
- `index.ts` matches the section 6 interface exactly.

- Collector uploads retryable, privacy-trimmed data without modifying `mobile/`.
