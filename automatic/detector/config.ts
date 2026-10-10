/** Detector thresholds. Starting values come from ARCHITECTURE.md section 7; see TUNING.md. */
export type DetectorConfig = {
  brakeThresholdG: number; brakeReleaseG: number; brakeMinDurationMs: number; smoothingWindowMs: number;
  minSpeedBeforeMps: number; minSpeedDropMps: number; speedDropWindowMs: number; maxAccuracyM: number;
  brakeRefractoryMs: number; bumpThresholdG: number; bumpMaxDurationMs: number; bumpMinSpeedMps: number;
  bumpRefractoryMs: number; demoMode: boolean;
};

export const DEFAULT_CONFIG: Readonly<DetectorConfig> = Object.freeze({
  brakeThresholdG: 0.35,
  brakeReleaseG: 0.25,
  brakeMinDurationMs: 300,
  smoothingWindowMs: 200,
  minSpeedBeforeMps: 3,
  minSpeedDropMps: 2,
  speedDropWindowMs: 2000,
  maxAccuracyM: 20,
  brakeRefractoryMs: 3000,
  bumpThresholdG: 1.0,
  bumpMaxDurationMs: 150,
  bumpMinSpeedMps: 2,
  bumpRefractoryMs: 1000,
  demoMode: false,
});

const POSITIVE_KEYS = [
  'brakeThresholdG', 'brakeReleaseG', 'brakeMinDurationMs', 'smoothingWindowMs', 'minSpeedBeforeMps',
  'minSpeedDropMps', 'speedDropWindowMs', 'maxAccuracyM', 'brakeRefractoryMs', 'bumpThresholdG',
  'bumpMaxDurationMs', 'bumpMinSpeedMps', 'bumpRefractoryMs',
] as const;

/**
 * Merge a partial configuration over the defaults and reject anything that would silently
 * disable detection: unknown keys, nonfinite or nonpositive numbers, and a release level that
 * is not strictly below the brake threshold.
 */
export function validateConfig(partial: Partial<DetectorConfig> = {}): DetectorConfig {
  if (partial === null || typeof partial !== 'object') throw new TypeError('detector config must be an object');
  for (const key of Object.keys(partial)) {
    if (!(key in DEFAULT_CONFIG)) throw new RangeError(`unknown detector config key: ${key}`);
  }
  const defined = Object.fromEntries(Object.entries(partial).filter(([, value]) => value !== undefined));
  const config: DetectorConfig = { ...DEFAULT_CONFIG, ...defined };
  for (const key of POSITIVE_KEYS) {
    const value = config[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      throw new RangeError(`detector config ${key} must be a finite positive number, got ${String(value)}`);
    }
  }
  if (typeof config.demoMode !== 'boolean') throw new TypeError('detector config demoMode must be a boolean');
  if (config.brakeReleaseG >= config.brakeThresholdG) {
    throw new RangeError('detector config brakeReleaseG must be below brakeThresholdG');
  }
  return config;
}
