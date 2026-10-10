/** Stage 0 interface only. Deliberately emits no detections; Lane B supplies algorithms. */
export type Vector = { x: number; y: number; z: number };
export type MotionSample = { t_ms: number; accel: Vector; gravity: Vector };
export type LocationFix = { t_ms: number; lat: number; lon: number; speed_mps: number | null; accuracy_m: number | null };
export type DetectedEvent = { type: 'hard_brake' | 'bump'; t_ms: number; lat: number; lon: number; accuracy_m: number; speed_before_mps: number; speed_after_mps: number; peak_g: number; duration_ms: number };
export type DetectorConfig = {
  brakeThresholdG: number; brakeReleaseG: number; brakeMinDurationMs: number; smoothingWindowMs: number;
  minSpeedBeforeMps: number; minSpeedDropMps: number; speedDropWindowMs: number; maxAccuracyM: number;
  brakeRefractoryMs: number; bumpThresholdG: number; bumpMaxDurationMs: number; bumpMinSpeedMps: number;
  bumpRefractoryMs: number; demoMode: boolean;
};
export function createDetector(_config: Partial<DetectorConfig> = {}) {
  const listeners = new Set<(event: DetectedEvent) => void>();
  return {
    pushMotion(_sample: MotionSample): void {},
    pushLocation(_fix: LocationFix): void {},
    onEvent(listener: (event: DetectedEvent) => void): () => void {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    reset(): void { /* In Lane B reset sample state, retaining event subscribers. */ },
  };
}
