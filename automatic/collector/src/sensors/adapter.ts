/**
 * Platform samples → detector units. Pure functions over structural types so they run in Node
 * tests; the Expo bindings live in src/platform.ts.
 *
 * Sensor conventions still need checking on each physical device before any real-evidence claim:
 * Expo documents DeviceMotion acceleration in m/s² on both platforms, but the sign of
 * accelerationIncludingGravity differs between iOS and Android. The detector only uses the
 * gravity direction to split horizontal from vertical and takes magnitudes, so that sign does not
 * change detection; a unit mismatch (g instead of m/s²) would.
 */
import type { LocationFix, MotionSample } from '../../../detector/index';

export type RawVector = { x: number; y: number; z: number } | null | undefined;
/** Shape of an expo-sensors DeviceMotionMeasurement, reduced to what is used. */
export type RawMotion = { acceleration?: RawVector; accelerationIncludingGravity?: RawVector; interval?: number };
/** Shape of an expo-location LocationObject, reduced to what is used. */
export type RawLocation = {
  timestamp: number;
  coords: { latitude: number; longitude: number; accuracy: number | null; speed: number | null };
};

export const NOMINAL_MOTION_INTERVAL_MS = 20; // 50 Hz
/** Burst spacing may push stamps ahead of real time, but never by more than this: beyond it, samples are dropped. */
export const MAX_STAMP_LEAD_MS = 250;

const finite = (v: RawVector): v is { x: number; y: number; z: number } =>
  !!v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);

/**
 * DeviceMotion callbacks carry no absolute timestamp and can arrive in bursts. Each sample is
 * stamped with its arrival time, except that a sample arriving less than half an interval after
 * the previous stamp is assumed to be queued and is spaced one interval later. Stamps therefore
 * always increase and a burst keeps its real duration instead of collapsing into one instant.
 */
export function createMotionNormalizer(nominalIntervalMs = NOMINAL_MOTION_INTERVAL_MS) {
  let last: number | null = null;
  return {
    normalize(raw: RawMotion, nowMs: number): MotionSample | null {
      const accel = raw?.acceleration, including = raw?.accelerationIncludingGravity;
      if (!finite(accel) || !finite(including) || !Number.isFinite(nowMs)) return null;
      const step = typeof raw.interval === 'number' && Number.isFinite(raw.interval) && raw.interval > 0 ? raw.interval : nominalIntervalMs;
      const t = last === null || nowMs >= last + step / 2 ? nowMs : last + step;
      // A platform delivering faster than its stated rate would push stamps ever further ahead of the GPS clock,
      // misplacing events on the path the privacy trimming relies on. Drop the excess instead.
      if (t - nowMs > MAX_STAMP_LEAD_MS) return null;
      last = t;
      return {
        t_ms: t,
        accel: { x: accel.x, y: accel.y, z: accel.z },
        // Gravity is whatever the gravity-removed reading left out.
        gravity: { x: including.x - accel.x, y: including.y - accel.y, z: including.z - accel.z },
      };
    },
    reset(): void { last = null; },
  };
}

/**
 * Unknown stays unknown: a negative or nonfinite speed/accuracy becomes null, never zero. A fix
 * without a usable timestamp or coordinates is rejected outright.
 */
export function normalizeLocation(raw: RawLocation): LocationFix | null {
  const c = raw?.coords;
  if (!c || !Number.isFinite(raw.timestamp)) return null;
  if (!Number.isFinite(c.latitude) || !Number.isFinite(c.longitude) || Math.abs(c.latitude) > 90 || Math.abs(c.longitude) > 180) return null;
  const nonnegative = (v: number | null) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);
  return { t_ms: Math.round(raw.timestamp), lat: c.latitude, lon: c.longitude, speed_mps: nonnegative(c.speed), accuracy_m: nonnegative(c.accuracy) };
}
