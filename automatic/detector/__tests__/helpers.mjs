// Deterministic synthetic rides for detector tests. No randomness, no wall clock.
export const G = 9.80665;
export const GSU = { lat: 33.7531, lon: -84.3853 };

/** Orthonormal frame for an arbitrary phone orientation: `down` plus two horizontal axes. */
export function frame(down = { x: 0, y: 0, z: 1 }) {
  const n = Math.hypot(down.x, down.y, down.z);
  const d = { x: down.x / n, y: down.y / n, z: down.z / n };
  const seed = Math.abs(d.x) < 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
  const dot = seed.x * d.x + seed.y * d.y + seed.z * d.z;
  let h1 = { x: seed.x - dot * d.x, y: seed.y - dot * d.y, z: seed.z - dot * d.z };
  const m = Math.hypot(h1.x, h1.y, h1.z);
  h1 = { x: h1.x / m, y: h1.y / m, z: h1.z / m };
  const h2 = { x: d.y * h1.z - d.z * h1.y, y: d.z * h1.x - d.x * h1.z, z: d.x * h1.y - d.y * h1.x };
  return { d, h1, h2 };
}

/**
 * Build interleaved samples.
 *   horizontalG(t), verticalG(t): acceleration in g at time t (ms from start)
 *   speed(t): GPS speed in m/s, or null for unknown
 * Returns [{kind:'motion'|'location', ...}] sorted by time with the fix first on a tie.
 */
export function ride({
  durationMs, horizontalG = () => 0, verticalG = () => 0, speed = () => 5, accuracy = () => 5,
  down, motionHz = 50, gpsHz = 1, startMs = 1_760_000_000_000, motionTimes, position = () => GSU,
}) {
  const { d, h1 } = frame(down);
  const out = [];
  const times = motionTimes ?? Array.from({ length: Math.floor(durationMs * motionHz / 1000) + 1 }, (_, i) => Math.round(i * 1000 / motionHz));
  for (const t of times) {
    const h = horizontalG(t) * G, v = verticalG(t) * G;
    out.push({ kind: 'motion', sample: {
      t_ms: startMs + t,
      accel: { x: h * h1.x + v * d.x, y: h * h1.y + v * d.y, z: h * h1.z + v * d.z },
      gravity: { x: d.x * G, y: d.y * G, z: d.z * G },
    } });
  }
  for (let t = 0; t <= durationMs; t += Math.round(1000 / gpsHz)) {
    const p = position(t);
    out.push({ kind: 'location', fix: { t_ms: startMs + t, lat: p.lat, lon: p.lon, speed_mps: speed(t), accuracy_m: accuracy(t) } });
  }
  const order = { location: 0, motion: 1 };
  const stamp = (item) => (item.kind === 'motion' ? item.sample.t_ms : item.fix.t_ms);
  return out.sort((a, b) => stamp(a) - stamp(b) || order[a.kind] - order[b.kind]);
}

export function feed(detector, samples) {
  const events = [];
  const off = detector.onEvent((event) => events.push(event));
  for (const item of samples) {
    if (item.kind === 'motion') detector.pushMotion(item.sample);
    else detector.pushLocation(item.fix);
  }
  off();
  return events;
}

export const between = (from, to, value, otherwise = 0) => (t) => (t >= from && t < to ? value : otherwise);
/** Speed that falls linearly from `high` to `low` between `from` and `to` ms. */
export const ramp = (from, to, high, low) => (t) => (t <= from ? high : t >= to ? low : high + (low - high) * (t - from) / (to - from));
