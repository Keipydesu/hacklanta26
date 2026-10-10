/** Bump state machine: a short vertical spike while moving. */
import { TimeWeightedWindow } from './buffers.js';
import type { DetectorConfig } from './config.js';
import { MAX_FIX_DISTANCE_MS, type LocationTrack } from './location.js';
import { LOCATION_LATENESS_MS } from './brake.js';

export type BumpEvent = {
  type: 'bump'; t_ms: number; lat: number; lon: number; accuracy_m: number;
  speed_before_mps: number; speed_after_mps: number; peak_g: number; duration_ms: number;
};

/** Window for the moving vertical mean that is removed before looking for a spike. */
export const BUMP_BASELINE_WINDOW_MS = 500;

type Candidate = { startMs: number; baselineG: number; peakG: number; peakMs: number; lastMs: number; overlong: boolean };
type Pending = { peakMs: number; peakG: number; durationMs: number };

export class BumpTracker {
  private readonly baseline: TimeWeightedWindow;
  private candidate: Candidate | null = null;
  private pending: Pending[] = [];
  private blockedUntilMs = -Infinity;

  constructor(private readonly config: DetectorConfig, maxHoldMs: number) {
    this.baseline = new TimeWeightedWindow(BUMP_BASELINE_WINDOW_MS, maxHoldMs);
  }

  onMotion(t: number, verticalG: number): void {
    const { bumpThresholdG, bumpMaxDurationMs, bumpRefractoryMs } = this.config;
    const c = this.candidate;
    if (!c) {
      const mean = this.baseline.mean();
      if (mean !== null && t >= this.blockedUntilMs && Math.abs(verticalG - mean) >= bumpThresholdG) {
        // The spike itself is kept out of the baseline it is measured against.
        this.candidate = { startMs: t, baselineG: mean, peakG: Math.abs(verticalG - mean), peakMs: t, lastMs: t, overlong: false };
        return;
      }
      this.baseline.push(t, verticalG);
      return;
    }
    const magnitude = Math.abs(verticalG - c.baselineG);
    if (magnitude >= bumpThresholdG) {
      c.lastMs = t;
      if (magnitude > c.peakG) { c.peakG = magnitude; c.peakMs = t; }
      if (t - c.startMs >= bumpMaxDurationMs) c.overlong = true;
      return;
    }
    // Spike ended at the first sample back under the threshold.
    const durationMs = t - c.startMs;
    this.candidate = null;
    // One physical bump rings; whatever the outcome, do not start another candidate inside it.
    this.blockedUntilMs = c.peakMs + bumpRefractoryMs;
    if (c.overlong || durationMs >= bumpMaxDurationMs) this.baseline.clear();
    else this.pending.push({ peakMs: c.peakMs, peakG: c.peakG, durationMs });
    this.baseline.push(t, verticalG);
  }

  /** A material gap: an unfinished spike cannot be timed, and the baseline is stale. */
  onGap(): void {
    this.candidate = null;
    this.baseline.clear();
  }

  /** Emit bumps whose surrounding speed is now known; drop those that can no longer be confirmed. */
  poll(motionMs: number | null, track: LocationTrack): BumpEvent[] {
    const { bumpMinSpeedMps, demoMode } = this.config;
    const events: BumpEvent[] = [];
    const waiting: Pending[] = [];
    const locationMs = track.latestMs;
    for (const p of this.pending) {
      const before = track.speedAtOrBefore(p.peakMs);
      const after = track.speedAfter(p.peakMs);
      if (before && after) {
        // Stationary handling and walking fail the measured-speed gate. Demo mode bypasses only
        // this gate and still needs supplied fixes on both sides of the spike.
        if (!demoMode && before.speed_mps < bumpMinSpeedMps) continue;
        const fix = track.locatePeak(p.peakMs);
        if (!fix) continue;
        events.push({
          type: 'bump', t_ms: p.peakMs, lat: fix.lat, lon: fix.lon, accuracy_m: fix.accuracy_m,
          speed_before_mps: before.speed_mps, speed_after_mps: after.speed_mps, peak_g: p.peakG, duration_ms: p.durationMs,
        });
        continue;
      }
      const deadline = p.peakMs + MAX_FIX_DISTANCE_MS;
      const locationDone = locationMs !== null && (locationMs >= deadline || (!before && locationMs > p.peakMs));
      const motionDone = motionMs !== null && motionMs >= deadline + LOCATION_LATENESS_MS;
      if (!locationDone && !motionDone) waiting.push(p);
    }
    this.pending = waiting;
    return events;
  }

  reset(): void { this.candidate = null; this.pending = []; this.blockedUntilMs = -Infinity; this.baseline.clear(); }
}
