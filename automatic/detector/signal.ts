/** Orientation-free decomposition of gravity-removed acceleration. */
export type Vector = { x: number; y: number; z: number };
export type MotionSample = { t_ms: number; accel: Vector; gravity: Vector };
/** Horizontal magnitude is unsigned; vertical keeps its sign along the gravity vector. Both in g. */
export type Components = { t_ms: number; horizontalG: number; verticalG: number };

export const STANDARD_GRAVITY = 9.80665;
/** A gravity vector shorter than this (m/s²) cannot define "down"; the sample is unusable. */
export const MIN_GRAVITY_MPS2 = 1;

const finiteVector = (v: Vector | null | undefined): v is Vector =>
  !!v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);

/**
 * `accel` is already gravity-removed. Vertical is its projection on the unit gravity vector,
 * horizontal is what remains, so the phone's orientation in a pocket or mount does not matter.
 */
export function projectMotion(sample: MotionSample): Components | null {
  if (!sample || !Number.isFinite(sample.t_ms) || !finiteVector(sample.accel) || !finiteVector(sample.gravity)) return null;
  const { accel: a, gravity: g } = sample;
  const norm = Math.hypot(g.x, g.y, g.z);
  if (!(norm >= MIN_GRAVITY_MPS2)) return null;
  const ux = g.x / norm, uy = g.y / norm, uz = g.z / norm;
  const vertical = a.x * ux + a.y * uy + a.z * uz;
  const horizontal = Math.hypot(a.x - vertical * ux, a.y - vertical * uy, a.z - vertical * uz);
  if (!Number.isFinite(vertical) || !Number.isFinite(horizontal)) return null;
  return { t_ms: sample.t_ms, horizontalG: horizontal / STANDARD_GRAVITY, verticalG: vertical / STANDARD_GRAVITY };
}
