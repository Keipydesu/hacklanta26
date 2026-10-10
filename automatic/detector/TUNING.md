# Detector tuning notes

Status: **starting values, validated on synthetic signals only.** No device, OS, sample rate or
recorded ride has been tested yet. Fill in the table at the bottom when real evidence exists; do
not change a threshold without labeled data to justify it.

## Configuration (`DetectorConfig`)

| Key | Value | Meaning |
|---|---|---|
| `brakeThresholdG` | 0.35 | smoothed horizontal magnitude that starts/sustains a brake candidate |
| `brakeReleaseG` | 0.25 | below this the brake has ended (hysteresis) |
| `brakeMinDurationMs` | 300 | continuous time at or above the threshold needed to qualify |
| `smoothingWindowMs` | 200 | moving-average window for horizontal magnitude |
| `minSpeedBeforeMps` | 3 | GPS speed required before the brake |
| `minSpeedDropMps` | 2 | GPS speed loss required inside the window |
| `speedDropWindowMs` | 2000 | window, from candidate start, for the speed loss |
| `maxAccuracyM` | 20 | fixes worse than this (or of unknown accuracy) are dropped |
| `brakeRefractoryMs` | 3000 | quiet time after a brake ends before another may start |
| `bumpThresholdG` | 1.0 | detrended vertical spike magnitude |
| `bumpMaxDurationMs` | 150 | spike must be strictly shorter than this |
| `bumpMinSpeedMps` | 2 | GPS speed required at the bump |
| `bumpRefractoryMs` | 1000 | quiet time after a spike's peak |
| `demoMode` | false | synthetic demonstrations only; see below |

## Internal constants (not configurable)

| Constant | Value | Why |
|---|---|---|
| `MAX_MOTION_GAP_MS` | 100 | five missed samples at 50 Hz is a material gap; smoothing restarts and unfinished candidates are dropped |
| smoothing coverage | 75 % | the 200 ms window must be at least 150 ms covered by samples before it yields a value |
| `BUMP_BASELINE_WINDOW_MS` | 500 | moving vertical mean removed before thresholding |
| `MAX_FIX_DISTANCE_MS` | 3000 | a fix further than this from the peak (or from "before"/"after") is not used |
| `LOCATION_LATENESS_MS` | 2000 | extra wait, on the motion clock, for a late GPS callback before expiring |
| `LOCATION_HORIZON_MS` | 8000 | retained fixes; covers before-fix + speed window + lateness |

## Exact rules

**Smoothing.** Horizontal magnitude is averaged over the trailing 200 ms, weighting each sample by
the time since the previous one (capped at 100 ms). Irregular callback spacing therefore does not
bias the mean, and missing time is never counted as sustained acceleration. The average lags the
raw signal: a step to 0.5 g crosses 0.35 g after about 140 ms, so a real brake must last roughly
450 ms or more to qualify.

**Brake.** A candidate starts when the smoothed value reaches the threshold. It qualifies after
300 ms continuously at or above the threshold. A dip into the 0.25–0.35 g band before qualification
resets the timer and, if the signal rises again, the candidate restarts from that new run. After
qualification the candidate lasts until the signal falls below release. Confirmation needs the last
known-speed fix at or before the start (at most 3 s old) to be ≥ 3 m/s and the slowest known-speed
fix within 2 s after the start to be ≥ 2 m/s lower. The event is emitted once the brake has ended
or the 2 s window has passed on the motion clock, whichever is first. An unconfirmed candidate
expires when the location stream passes the window, or 2 s after that on the motion clock.

**Brake refractory.** Measured from the end of the emitted brake (its release). If the event was
emitted while the signal was still high, the 3 s starts when it releases. One long stop is one
event.

**Bump.** The vertical component has its trailing 500 ms mean removed (the spike itself is kept
out of that mean). A spike starts at the first sample ≥ 1 g from the mean and ends at the first
sample back under it; it must last strictly less than 150 ms. Either direction along gravity
counts. `speed_before` is the last known-speed fix at or before the peak and `speed_after` the
first one after it, both within 3 s; the bump is dropped if either is missing, and `speed_before`
must be ≥ 2 m/s. Any spike, accepted or not, blocks a new candidate for 1 s from its peak so one
physical hit that rings is one event.

**Location.** The event position is the accepted fix nearest the peak in time, within 3 s; an
equal distance resolves to the earlier fix. No fix, no event.

**Stream order.** Each stream must be strictly increasing; a sample with a duplicate or older
timestamp is ignored. Tie rule for replay: on equal timestamps the location fix is pushed before
the motion sample.

**Demo mode.** Brake: no speed requirement, but the jerk must still be sustained for 300 ms and a
supplied fix must exist; `speed_before`/`speed_after` echo the supplied fixes and show no measured
drop. Bump: the 2 m/s gate is skipped; fixes on both sides of the spike are still required. Demo
output is synthetic evidence and must be labeled `simulated` by the caller.

## Known limitations

- Horizontal magnitude is unsigned, so the accelerometer alone cannot tell braking from
  accelerating or cornering; the GPS speed loss is what decides. At 1 Hz GPS a very short, sharp
  stop may not show a 2 m/s loss inside the window.
- A rider standing on a vibrating deck, a phone in a loose pocket, and handlebar mounts will give
  different amplitudes. Expect to retune `brakeThresholdG` and `bumpThresholdG` per mounting.
- Sustained rough surface (cobbles) produces many short spikes; it is reported at most once per
  second, and a spike longer than 150 ms is discarded as vibration.
- Sample rates far below 50 Hz reduce bump sensitivity: a 40 ms spike can fall between samples.

## Evidence log

| Date | Device / OS | Mount | Motion Hz | Rides | Labeled brakes / detected | Labeled bumps / detected | Config changes |
|---|---|---|---|---|---|---|---|
| — | none yet | — | — | 0 | — | — | starting values |
