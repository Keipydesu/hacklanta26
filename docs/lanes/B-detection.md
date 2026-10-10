# Lane B: Independent detector and opt-in collector

## Goal, current state and ownership

Implement milestone 3's sensor path independently of the manual product, following
[ARCHITECTURE.md](../../ARCHITECTURE.md), [the roadmap](../ROADMAP.md) and
[decision 001](../decisions/001-mvp-delivery-workflow.md). Stage 0 is merged through
[PR #1](https://github.com/Keipydesu/hacklanta26/pull/1): the detector exports the agreed interface
but emits no events, and the collector sends simulated fixtures only. There are no real sensors,
recorder, privacy buffer or durable queues yet. The manual release does not wait on this lane.

**Owns:** `automatic/detector/` and `automatic/collector/`. Detector code is pure TypeScript with
no React Native imports; collector uses the separate observation API. No product credentials,
product database access or changes to `mobile/`. F owns shared recording/scenario files under
`simulator/`; agree their format rather than writing another lane's files without coordination.
New module/method names below are proposed implementation seams; the exported interface stays fixed.

## Structure and data flow

```text
automatic/detector/
  index.ts                   createDetector facade and event subscriptions
  config.ts                  validated threshold defaults
  signal.ts                  gravity projection and smoothing
  buffers.ts                 timestamp-window buffers
  brake.ts                   candidate/pending/refractory state
  bump.ts                    short vertical-spike state
  location.ts                quality, speed windows and peak location
  __tests__/                 deterministic synthetic/replay cases
  TUNING.md                  tested devices, thresholds and limitations

automatic/collector/
  App.tsx                    idle/collecting/stopping and explicit demo/recorder UI
  src/sensors/adapter.ts      Expo samples → detector units/timestamps
  src/ride/controller.ts      permissions, ride UUID, subscriptions and shutdown
  src/privacy/trim.ts         first/last 100m eligibility
  src/queue/store.ts          durable immutable upload batches
  src/queue/sender.ts         single-flight observation transport
  src/recording/csv.ts        deliberately enabled local diagnostic output
  src/api/schema.d.ts         existing generated observation types
```

Motion/location → adapter → detector → event with valid location → privacy eligibility → immutable
UUID observation → durable queue → separate ingestion HTTP API. Points follow the same privacy
filter. Raw motion goes only to explicitly enabled local recording, never the ingestion API.
The product app neither imports the detector nor starts/stops this pipeline.

## Detector methods and invariants

Retain `createDetector(config?: Partial<DetectorConfig>)` returning `pushMotion`, `pushLocation`,
`onEvent` (unsubscribe callback), and `reset` (clear sample/state, retain subscribers). All state
advances from pushed timestamps; no wall-clock timers or globals. Each detector instance owns its
buffers, candidates and refractory times. Injected sample clocks make replay deterministic.

| Method | Implementation |
|---|---|
| `validateConfig(partial) -> DetectorConfig` | Merge defaults below; require finite positive durations/thresholds and meaningful hysteresis (`release < threshold`). Fail clearly on invalid config instead of silently disabling detection. |
| `projectMotion(sample) -> Components or null` | Normalize gravity, compute vertical `v = accel·g`, horizontal `h = accel-v*g`, then divide by 9.80665 for g units. Reject nonfinite vectors and near-zero gravity; acceleration is already gravity-removed. |
| `WindowBuffer.push(t, value)` / `valuesSince(t)` | Bound motion to about 3s and location to about 5s. Evict by time, not sample count. Define deterministic duplicate/out-of-order handling per stream; never let old samples move detector time backward. |
| `smoothHorizontal(t, value) -> number` | Time-window moving average over 200ms with documented handling of irregular spacing and missing coverage. Drop/reset candidates on material gaps; missing sensor time cannot count toward sustained acceleration. |
| `advanceBrake(components, locations) -> candidate/event` | Maintain idle → candidate → pending → emitted/discarded transitions below. Require measured GPS speed loss outside explicit synthetic demo mode. |
| `advanceBump(components, locations) -> candidate/event` | Remove short moving vertical mean, track spike magnitude/duration/peak, enforce speed and refractory gates. Emit once after the spike ends and qualifies. |
| `locatePeak(t_peak) -> LocationFix or null` | Choose nearest timestamp fix within 3s with finite coordinates and known accuracy <=20m. Resolve equal-distance ties deterministically. Drop if none; never fabricate a device location. |
| `emit(candidate)` | Return finite, contract-valid location, accuracy, speeds, peak g and duration to subscribers. Collector assigns UUID/ride/source. Reset candidate before callbacks to avoid reentrant duplicate emission. |

Motion/location streams naturally interleave; per-stream ordering and event-time windows must not
mistake a later GPS callback for invalid motion. Specify a deterministic tie rule with F's replay
adapter and test it. `reset()` discards pending incomplete detections. End-of-recording replay does
not invent a final sample to force emission; any needed interface addition requires coordination.

| Config | Starting value |
|---|---|
| `brakeThresholdG`, `brakeReleaseG` | 0.35, 0.25 |
| `brakeMinDurationMs`, `smoothingWindowMs` | 300, 200 |
| `minSpeedBeforeMps`, `minSpeedDropMps` | 3, 2 |
| `speedDropWindowMs`, `maxAccuracyM` | 2000, 20 |
| `brakeRefractoryMs` | 3000 |
| `bumpThresholdG`, `bumpMaxDurationMs` | 1.0, 150 |
| `bumpMinSpeedMps`, `bumpRefractoryMs` | 2, 1000 |
| `demoMode` | false |

### Brake state machine

1. From idle, smoothed horizontal magnitude >=0.35g begins a candidate. Track time and peak.
2. Stay in candidate until below 0.25g; duration must reach 300ms. A shorter candidate is discarded.
3. A qualified candidate waits for valid speed observations through the 2s window from its start.
   Speed before is the last good fix before start; speed after is the lowest good fix within that
   window. Both must be known/accurate; require before >=3m/s and drop >=2m/s. Expire an unconfirmed
   candidate once the window closes. Do not treat unknown speed as zero or wait indefinitely.
4. Locate the peak and emit once, then suppress another brake for 3s. Hard acceleration or swerving
   at unchanged speed must not pass merely because horizontal magnitude is high.
5. In explicit demo mode only, bypass speed confirmation and emit when duration qualifies. Still
   require a supplied fixed test location and simulated evidence. The bypass never applies to a
   device-labeled observation; synthetic numeric fields must be documented as synthetic.

### Bump state machine

Track the detrended vertical spike, peak time and duration; accept magnitude >=1g lasting strictly
under 150ms at measured speed >=2m/s. Refractory period is 1s. Test positive/negative axis orientation
with the adapter, since gravity conventions differ. Long vibration and stationary hand movement
must not become device bumps. Required before/after speed fields must come from valid fixes under
an explicit documented window; do not fill missing values with zero. If demo mode bypasses a gate,
use fixed synthetic values and `source: simulated`, never imply measured scooter evidence.

## Collector methods and lifecycle

| Method | Behavior |
|---|---|
| `startRide(mode) -> RideSession` | Check explicit opt-in, request foreground location/motion capabilities as required by platform, create fresh random ride UUID, reset detector and privacy state, subscribe near 50Hz motion/1Hz GPS and keep screen awake. Prevent double-start. |
| `normalizeMotion(raw) -> MotionSample` | Map platform timestamps to epoch ms, ensure monotonic progression, convert units to m/s², compute gravity as accelerationIncludingGravity minus gravity-removed acceleration. Verify axis/unit conventions on each target device before real evidence claims. |
| `normalizeLocation(raw) -> LocationFix` | Convert invalid/negative speed to null; validate accuracy and coordinate range. Reject unusable fixes for detection/distance; never turn GPS uncertainty into fabricated speed. |
| `pushPoint(fix)` / `pushEvent(event)` | Feed quality-controlled distance and detector output to the privacy buffer. Attach source/ride identity consistently. Do not upload raw location callbacks directly. |
| `stopRide()` | Unsubscribe sensors, finalize recorder, discard trailing privacy zone, persist eligible batches and stop keep-awake. Incomplete detector candidates are discarded. Stopping twice is harmless. |
| `resumeUploads()` | Load only already-trimmed pending batches; recover unknown send outcomes by exact retry. It does not restart sensing or create a new ride automatically. |

Permissions denied, sensors unavailable or app suspension must be visible states. No background
tracking guarantee is required. On suspension/termination, stop collection or mark a gap and reset
detector windows before resuming; do not splice unrelated segments into one brake. Discard uncertain
trailing privacy data on abnormal shutdown rather than uploading a possible endpoint. Preserve
already-eligible upload batches across restart with their original ride/observation UUIDs.

## Privacy before persistence and upload

`PrivacyBuffer.pushFix(fix)` maintains cumulative traveled distance from accepted fixes. Drop the
first 100m. Hold at least the last 100m of the path in a trailing buffer; an interior point/event
becomes eligible only after the rider has traveled another 100m beyond it. `finish()` drops that
remaining tail. A ride <=200m with no interior uploads nothing. Map events to their peak's position
along the retained path and trim them by the same rule, not merely their delivery timestamp.

Reject poor-accuracy/impossible jumps before advancing cumulative distance; otherwise GPS noise
can prematurely release private endpoints. Decide and record the gap/jump policy using device
traces in B2. A fixed sample count or elapsed seconds is not a substitute for distance. Raw held
endpoints must not enter the durable upload queue. Store held data only as needed for collection;
if interrupted before privacy eligibility is known, discard it. Deliberate recorder mode is a
separate local diagnostic exception, never an upload shortcut.

Explicit indoor demo uses fixed campus coordinates, skips trimming/speed only for synthetic data,
and displays a DEMO badge. Mark events and points simulated at creation and retain the label across
queue retries; do not allow switching mode to relabel existing batches. Normal default is device
mode with all privacy and quality gates enabled.

## Queue, transport and recording

`enqueueEligible(observations)` assigns stable UUIDs once and persists immutable bodies before
network I/O. Split event batches at 500 and per-ride point batches at 2000, normally flushing points
about every 10s. The limits are maxima, not reasons to hold a short ride indefinitely. The event
schema includes ride UUID; point path supplies ride UUID and is part of retry identity.

`drainQueue()` is single-flight with connect/read timeouts and bounded exponential retry for
transport/temporary server failures. Accepted or duplicate counts acknowledge a complete batch.
409/422 reject atomically and move the batch to a visible failed state; do not loop forever, drop
individual items speculatively, or mutate the body while keeping its UUID. A lost receipt retries
identically. Cap queued storage visibly; when full, pause collection instead of claiming unsaved
data is queued. Credentials for product publication never enter this client.

`Recorder.start/write/stop` is opt-in, local-only CSV with motion
`t_ms,ax,ay,az,gx,gy,gz`, GPS `t_ms,lat,lon,speed_mps,accuracy_m`, and optional label `t_ms,type`.
Agree units, missing-speed encoding and privacy metadata with F before creating shared recordings.
Before sharing/upload replay, remove first/last 100m and corresponding derived events; metadata
records trimming so already-reviewed recordings are not trimmed twice. Never commit raw identifying
endpoints. Three consented, privacy-reviewed rides are a tuning goal, not a prerequisite for the
manual release. Synthetic data cannot satisfy the real-ride validation claim.

## Ordered implementation and validation

1. **B1 — Pure detector.** Implement config/math/buffers and brake/bump state machines against
   synthetic tests before sensor integration. Exit: clean brake and curb hit emit once; acceleration,
   swerve, walking, poor GPS, missing speed and refractory cases reject correctly. Test rotation,
   irregular sample spacing, reset and separate instance state in Node.
2. **B2 — Collector adapter/privacy.** Wire explicit lifecycle and sensor units, then first/last 100m
   trimming with deterministic path fixtures. Exit: no outbound observation contains either endpoint
   zone, a short ride uploads nothing, and denied permission/suspension fail visibly. Verify units
   on physical phones; mocked input alone cannot validate sensor conventions.
3. **B3 — Durable upload/recording.** Add eligible-only queue and single-flight sender to the existing
   separate observation client. Exit: restart after unknown HTTP result duplicates safely; oversized
   batches split correctly; conflict/invalid batches stop; recorder remains local-only. Test against
   D's stub/fixtures until persistence exists, without manual app running.
4. **B4 — Demo and replay.** Add explicit indoor synthetic mode and F's Node replay adapter contract.
   Exit: one qualifying hand jerk produces one labeled simulated event; repeat recorded replay with
   the same samples is deterministic. Tune only from labeled evidence and record thresholds/devices.
5. **B5 — Independent integration.** Collector → D ingest → derived publication is milestone 3/4
   evidence. F supplies scenarios/recordings and G observation URL; none blocks B1–B3 synthetic work.
   Record missing real rides/device checks instead of marking them passed.

Existing stage-0 commands (they prove skeleton build, not real detection):

```sh
npm ci --prefix automatic/detector
npm run build --prefix automatic/detector
npm test --prefix automatic/detector
npm ci --prefix automatic/collector
npm run typecheck --prefix automatic/collector
npm run build --prefix automatic/collector
EXPO_PUBLIC_AUTOMATION_API_URL=http://YOUR_LAN_IP:8001 npm start --prefix automatic/collector
```

Replace the no-op detector expectation when algorithms land; preserve public API compatibility.
Add privacy/queue tests and their exact verified command in the collector manifest/README when
implemented. Ask G to extend existing lane-filtered CI, not run sensors on CI. Local checks focus
on changed behavior; physical sensor/replay evidence belongs in the handoff. Verify the manual app
can still build without this tree in a disposable checkout, not by deleting a shared workspace.

Handoff: tested device/OS and sample rates, configuration, units, detector event counts versus labels,
privacy eligibility proof, replay commands, observation retry receipts and known limitations. No
sensor integration in the manual app, continuous background tracking, raw motion upload or product
publication credentials are part of this lane's MVP.
