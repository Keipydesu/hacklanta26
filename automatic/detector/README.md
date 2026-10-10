# Detector

Pure TypeScript hard-brake and bump detection (Lane B, slice B1). No React Native imports, no
wall-clock timers and no globals: each `createDetector(config?)` instance owns its buffers and
advances only from the timestamps pushed into it, so replaying the same samples gives the same
events.

```ts
const detector = createDetector();            // or createDetector({ demoMode: true })
const off = detector.onEvent((event) => {});  // returns unsubscribe
detector.pushLocation(fix);                   // { t_ms, lat, lon, speed_mps|null, accuracy_m|null }
detector.pushMotion(sample);                  // { t_ms, accel, gravity } in m/s², accel gravity-removed
detector.reset();                             // drop samples/candidates/refractory, keep subscribers
```

Events carry `type` (`hard_brake | bump`), `t_ms` (the peak), `lat`/`lon`/`accuracy_m` of the GPS
fix nearest the peak, `speed_before_mps`, `speed_after_mps`, `peak_g` and `duration_ms`. The
collector assigns the observation UUID, ride UUID and `source`. This interface is internal to the
automatic track; `mobile/` never imports it.

## Modules

| File | Role |
|---|---|
| `index.ts` | `createDetector` facade, stream ordering, gap handling, event delivery |
| `config.ts` | defaults and `validateConfig` (invalid values throw instead of disabling detection) |
| `signal.ts` | `projectMotion`: horizontal/vertical components in g, independent of phone orientation |
| `buffers.ts` | time-weighted moving average with a coverage requirement |
| `location.ts` | GPS quality control, speed lookups and `locatePeak` |
| `brake.ts` | idle → candidate → pending → emitted/discarded |
| `bump.ts` | detrended short vertical spike while moving |

Thresholds, the exact rules for gaps, late GPS callbacks and refractory periods, and what has and
has not been validated are in [TUNING.md](TUNING.md).

## Rules worth knowing before feeding it data

- Timestamps are epoch milliseconds and must strictly increase **within each stream**. Duplicate,
  older and malformed samples are ignored. Motion and location may interleave, and a GPS fix may
  arrive after later motion samples.
- When a motion sample and a fix share a timestamp, push the fix first. Replay adapters follow the
  same rule so runs are reproducible.
- A fix with unknown accuracy or accuracy worse than 20 m is dropped. Unknown, negative or
  nonfinite speed stays unknown; it is never read as zero.
- Nothing is emitted without a real fix within 3 s of the peak. The detector never invents a
  position, and end of input does not force an unfinished detection.
- `demoMode` is for labeled synthetic demonstrations only. It skips the measured-speed checks,
  still needs supplied fixes, and its speed fields just echo those fixes. The collector must label
  such observations `simulated`.

## Commands

From the repository root (Node 22 LTS):

```sh
npm ci --prefix automatic/detector
npm run build --prefix automatic/detector
npm test --prefix automatic/detector
```

`npm test` builds and runs 42 deterministic synthetic cases with Node's test runner: clean brake
and curb hit emit once; acceleration, swerve, slow movement, walking, poor GPS, unknown speed,
short pulses, the 0.30 g plateau, sensor gaps, long vibration and stationary handling are rejected;
rotation, irregular spacing, late GPS, duplicates, reset, separate instances and demo mode are
covered.

These are synthetic signals. No recorded scooter rides exist yet, so thresholds are untuned
starting values and no real-ride accuracy is claimed.

## Conventions fixed during review

- Bump duration is measured to the first sample back under the threshold (it includes the final sample period), so with 50 Hz sampling a spike must be at most ~7 samples above threshold to stay under `bumpMaxDurationMs`.
- A brake is emitted only after its full `speedDropWindowMs` of fixes has been seen (location stream past the window, or the motion clock past it plus a 2 s lateness allowance), so `speed_after_mps` is independent of GPS callback latency. An event that cannot yet be placed on a fix waits; it never arms the refractory unless emitted.
- A motion gap during an already-reported stop keeps that stop's refractory. Bumps require measured speed above `bumpMinSpeedMps` on both sides of the spike.
- Listener exceptions are isolated; pass `createDetector(config, { onListenerError })` to observe them.
