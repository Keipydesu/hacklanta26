/** Hard-brake state machine: idle → candidate → pending → emitted or discarded. */
import type { DetectorConfig } from './config.js';
import type { LocationTrack } from './location.js';

export type BrakeEvent = {
  type: 'hard_brake'; t_ms: number; lat: number; lon: number; accuracy_m: number;
  speed_before_mps: number; speed_after_mps: number; peak_g: number; duration_ms: number;
};

/**
 * GPS callbacks trail the motion stream. After the speed window closes on the motion clock, wait
 * this much longer for a late fix before giving up on an unconfirmed candidate.
 */
export const LOCATION_LATENESS_MS = 2000;

type Candidate = {
  /** Start of the continuous at-or-above-threshold run that qualifies (or may still qualify). */
  startMs: number;
  /** Null while the signal sits between release and threshold before qualification. */
  aboveSinceMs: number | null;
  qualified: boolean;
  peakG: number;
  peakMs: number;
  lastMs: number;
  /** Set once the signal falls below release (or a gap ends the candidate). */
  endMs: number | null;
};

export class BrakeTracker {
  private candidate: Candidate | null = null;
  /** No new candidate may start before this motion timestamp. */
  private blockedUntilMs = -Infinity;
  /** An event was emitted while the signal was still high; refractory starts at its release. */
  private awaitingRelease = false;

  constructor(private readonly config: DetectorConfig) {}

  /** `smoothedG` is null when the smoothing window lacks coverage (stream start or after a gap). */
  onMotion(t: number, smoothedG: number | null): void {
    const { brakeThresholdG: threshold, brakeReleaseG: release, brakeMinDurationMs, brakeRefractoryMs } = this.config;
    if (this.awaitingRelease) {
      if (smoothedG === null || smoothedG < release) {
        this.awaitingRelease = false;
        this.blockedUntilMs = t + brakeRefractoryMs;
      }
      return;
    }
    const c = this.candidate;
    if (!c) {
      if (smoothedG !== null && smoothedG >= threshold && t >= this.blockedUntilMs) {
        this.candidate = { startMs: t, aboveSinceMs: t, qualified: false, peakG: smoothedG, peakMs: t, lastMs: t, endMs: null };
      }
      return;
    }
    if (c.endMs !== null) return; // pending: waiting for speed confirmation
    if (smoothedG === null) { this.endActive(c, c.lastMs); return; }
    c.lastMs = t;
    if (smoothedG >= threshold) {
      if (c.aboveSinceMs === null) {
        // The earlier run never reached the minimum duration. Time spent between release and
        // threshold cannot count, so the candidate restarts with this run.
        c.startMs = t; c.aboveSinceMs = t; c.peakG = smoothedG; c.peakMs = t;
      } else if (smoothedG > c.peakG) {
        c.peakG = smoothedG; c.peakMs = t;
      }
      if (t - c.aboveSinceMs >= brakeMinDurationMs) c.qualified = true;
    } else if (smoothedG >= release) {
      if (!c.qualified) c.aboveSinceMs = null;
    } else {
      this.endActive(c, t);
    }
  }

  /** A material gap in motion samples: nothing sustained can be claimed across it. */
  onGap(): void {
    if (this.awaitingRelease) { this.awaitingRelease = false; this.blockedUntilMs = -Infinity; }
    const c = this.candidate;
    if (c && c.endMs === null) this.endActive(c, c.lastMs);
  }

  private endActive(c: Candidate, endMs: number): void {
    if (c.qualified) c.endMs = endMs;
    else this.candidate = null;
  }

  /** Confirm, expire or keep waiting. Call after every motion sample and location fix. */
  poll(motionMs: number | null, track: LocationTrack): BrakeEvent | null {
    const c = this.candidate;
    if (!c || !c.qualified) return null;
    const { speedDropWindowMs, minSpeedBeforeMps, minSpeedDropMps, brakeRefractoryMs, demoMode } = this.config;
    const windowEnd = c.startMs + speedDropWindowMs;
    const motionPastWindow = motionMs !== null && motionMs >= windowEnd;
    const locationMs = track.latestMs;
    const locationPastWindow = locationMs !== null && locationMs >= windowEnd;
    const settled = c.endMs !== null || motionPastWindow;

    const before = track.speedAtOrBefore(c.startMs);
    const slowest = track.slowestIn(c.startMs, windowEnd);
    let speeds: { before: number; after: number } | null = null;
    if (demoMode) {
      // Synthetic demonstration only: no measured speed loss is required, and the speed fields
      // simply echo the supplied (synthetic) fixes. A supplied location is still mandatory.
      const reference = before ?? slowest;
      if (reference) speeds = { before: reference.speed_mps, after: Math.min(reference.speed_mps, slowest?.speed_mps ?? reference.speed_mps) };
    } else if (before && slowest && before.speed_mps >= minSpeedBeforeMps && before.speed_mps - slowest.speed_mps >= minSpeedDropMps) {
      speeds = { before: before.speed_mps, after: slowest.speed_mps };
    }

    if (speeds && settled) {
      const fix = track.locatePeak(c.peakMs);
      const endMs = c.endMs ?? motionMs ?? c.lastMs;
      this.candidate = null;
      if (c.endMs !== null) this.blockedUntilMs = c.endMs + brakeRefractoryMs;
      else this.awaitingRelease = true;
      if (!fix) return null;
      return {
        type: 'hard_brake', t_ms: c.peakMs, lat: fix.lat, lon: fix.lon, accuracy_m: fix.accuracy_m,
        speed_before_mps: speeds.before, speed_after_mps: speeds.after, peak_g: c.peakG,
        duration_ms: Math.max(0, endMs - c.startMs),
      };
    }

    // Every in-window fix has been seen once the ordered location stream passes the window; the
    // motion clock alone needs the extra lateness allowance. Unknown speed is never treated as zero.
    const expired = locationPastWindow || (motionMs !== null && motionMs >= windowEnd + LOCATION_LATENESS_MS);
    if (!speeds && expired) this.candidate = null;
    return null;
  }

  reset(): void { this.candidate = null; this.blockedUntilMs = -Infinity; this.awaitingRelease = false; }
}
