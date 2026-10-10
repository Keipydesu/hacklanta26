/**
 * Pure TypeScript brake/bump detector. No React Native imports, no wall-clock timers, no globals:
 * every instance owns its state and advances only from the timestamps pushed into it, so replaying
 * the same samples always produces the same events.
 */
import { TimeWeightedWindow } from './buffers.js';
import { BrakeTracker } from './brake.js';
import { BumpTracker } from './bump.js';
import { validateConfig, type DetectorConfig } from './config.js';
import { LocationTrack, type LocationFix } from './location.js';
import { projectMotion, type MotionSample, type Vector } from './signal.js';

export type { DetectorConfig, LocationFix, MotionSample, Vector };
export { DEFAULT_CONFIG, validateConfig } from './config.js';
export { projectMotion, STANDARD_GRAVITY } from './signal.js';

export type DetectedEvent = { type: 'hard_brake' | 'bump'; t_ms: number; lat: number; lon: number; accuracy_m: number; speed_before_mps: number; speed_after_mps: number; peak_g: number; duration_ms: number };

/**
 * A hole this long between motion samples is a material gap (nominal spacing is 20 ms at 50 Hz).
 * Smoothing restarts and unfinished candidates are dropped rather than bridged.
 */
export const MAX_MOTION_GAP_MS = 100;

export function createDetector(config: Partial<DetectorConfig> = {}) {
  const settings = validateConfig(config);
  const listeners = new Set<(event: DetectedEvent) => void>();
  const smoothing = new TimeWeightedWindow(settings.smoothingWindowMs, MAX_MOTION_GAP_MS);
  const track = new LocationTrack(settings.maxAccuracyM);
  const brake = new BrakeTracker(settings);
  const bump = new BumpTracker(settings, MAX_MOTION_GAP_MS);
  let lastMotionMs: number | null = null;

  function flush(): void {
    const events: DetectedEvent[] = [];
    const braked = brake.poll(lastMotionMs, track);
    if (braked) events.push(braked);
    events.push(...bump.poll(lastMotionMs, track));
    if (!events.length) return;
    // Detector state is already advanced past these events, so a listener that pushes more
    // samples or calls reset() cannot cause a duplicate emission.
    events.sort((a, b) => a.t_ms - b.t_ms || (a.type < b.type ? -1 : 1));
    for (const event of events) for (const listener of [...listeners]) listener(event);
  }

  return {
    /** Motion timestamps must strictly increase; duplicates, older and malformed samples are ignored. */
    pushMotion(sample: MotionSample): void {
      const components = projectMotion(sample);
      if (!components) return;
      const t = components.t_ms;
      if (lastMotionMs !== null) {
        if (t <= lastMotionMs) return;
        if (t - lastMotionMs > MAX_MOTION_GAP_MS) { smoothing.clear(); brake.onGap(); bump.onGap(); }
      }
      lastMotionMs = t;
      smoothing.push(t, components.horizontalG);
      brake.onMotion(t, smoothing.mean());
      bump.onMotion(t, components.verticalG);
      flush();
    },
    /**
     * Location timestamps must strictly increase within their own stream. A fix may arrive after
     * later motion samples; when a motion sample and a fix share a timestamp, replay pushes the
     * fix first.
     */
    pushLocation(fix: LocationFix): void {
      if (track.push(fix)) flush();
    },
    onEvent(listener: (event: DetectedEvent) => void): () => void {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    /** Discard samples, candidates, pending detections and refractory state; keep subscribers. */
    reset(): void {
      lastMotionMs = null;
      smoothing.clear(); track.clear(); brake.reset(); bump.reset();
    },
  };
}

export type Detector = ReturnType<typeof createDetector>;
