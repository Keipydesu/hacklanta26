import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDetector } from '../dist/index.js';
import { ride, feed, between, ramp, GSU } from './helpers.mjs';

// A clean stop: 0.5 g for 1.2 s from t=3000 while GPS speed falls from 6 to 1 m/s.
const cleanBrake = (overrides = {}) => ride({
  durationMs: 9000, horizontalG: between(3000, 4200, 0.5), speed: ramp(3000, 4500, 6, 1), ...overrides,
});

test('a clean brake emits exactly one contract-valid event', () => {
  const events = feed(createDetector(), cleanBrake());
  assert.equal(events.length, 1);
  const [e] = events;
  assert.equal(e.type, 'hard_brake');
  assert.equal(e.lat, GSU.lat); assert.equal(e.lon, GSU.lon);
  assert.equal(e.accuracy_m, 5);
  assert.equal(e.speed_before_mps, 6);
  assert.ok(e.speed_before_mps - e.speed_after_mps >= 2, 'records the measured speed loss');
  assert.ok(Math.abs(e.peak_g - 0.5) < 1e-6);
  assert.ok(e.duration_ms >= 1000 && e.duration_ms <= 1300, `duration ${e.duration_ms}`);
  for (const value of Object.values(e)) if (typeof value === 'number') assert.ok(Number.isFinite(value) && value >= -180);
});

test('phone orientation does not change the result', () => {
  const flat = feed(createDetector(), cleanBrake());
  for (const down of [{ x: 0, y: 1, z: 0 }, { x: 1, y: -2, z: 0.5 }, { x: 0, y: 0, z: -1 }]) {
    const events = feed(createDetector(), cleanBrake({ down }));
    assert.equal(events.length, 1);
    assert.equal(events[0].t_ms, flat[0].t_ms);
    assert.ok(Math.abs(events[0].peak_g - flat[0].peak_g) < 1e-9);
  }
});

test('hard acceleration is not braking', () => {
  const events = feed(createDetector(), cleanBrake({ speed: ramp(3000, 4500, 2, 7) }));
  assert.deepEqual(events, []);
});

test('a swerve at unchanged speed is not braking', () => {
  const events = feed(createDetector(), cleanBrake({ speed: () => 6 }));
  assert.deepEqual(events, []);
});

test('slow movement below the minimum speed is not braking', () => {
  const events = feed(createDetector(), cleanBrake({ speed: ramp(3000, 4500, 2.5, 0) }));
  assert.deepEqual(events, []);
});

test('poor GPS accuracy is dropped, not trusted', () => {
  assert.deepEqual(feed(createDetector(), cleanBrake({ accuracy: () => 35 })), []);
  assert.deepEqual(feed(createDetector(), cleanBrake({ accuracy: () => null })), []);
});

test('unknown speed is never treated as zero', () => {
  assert.deepEqual(feed(createDetector(), cleanBrake({ speed: () => null })), []);
  // Speed known before the brake but unknown afterwards: still unconfirmed.
  assert.deepEqual(feed(createDetector(), cleanBrake({ speed: (t) => (t <= 3000 ? 6 : null) })), []);
  // A negative speed (platform "unknown") must not read as a stop.
  assert.deepEqual(feed(createDetector(), cleanBrake({ speed: (t) => (t <= 3000 ? 6 : -1) })), []);
});

test('a brief pulse followed by 300 ms at 0.30 g does not qualify', () => {
  const horizontalG = (t) => (t >= 3000 && t < 3200 ? 0.5 : t >= 3200 && t < 3500 ? 0.3 : 0);
  const events = feed(createDetector(), cleanBrake({ horizontalG }));
  assert.deepEqual(events, []);
});

test('time between release and threshold does not count toward the sustained duration', () => {
  // Two 200 ms runs above threshold joined by 0.30 g: neither run alone reaches 300 ms.
  const horizontalG = (t) => (t >= 3000 && t < 3200) || (t >= 3600 && t < 3800) ? 0.6 : (t >= 3200 && t < 3600 ? 0.3 : 0);
  assert.deepEqual(feed(createDetector(), cleanBrake({ horizontalG })), []);
});

test('a short spike under 300 ms does not qualify', () => {
  assert.deepEqual(feed(createDetector(), cleanBrake({ horizontalG: between(3000, 3200, 0.9) })), []);
});

test('refractory period suppresses a second brake within 3 s', () => {
  const horizontalG = (t) => (t >= 3000 && t < 3800) || (t >= 5000 && t < 5800) ? 0.5 : 0;
  const speed = (t) => (t <= 3000 ? 8 : t <= 4000 ? 5 : t <= 5000 ? 5 : 2);
  const events = feed(createDetector(), ride({ durationMs: 12000, horizontalG, speed }));
  assert.equal(events.length, 1);
});

test('two brakes far enough apart both emit', () => {
  const horizontalG = (t) => (t >= 3000 && t < 3800) || (t >= 9000 && t < 9800) ? 0.5 : 0;
  const speed = (t) => (t <= 3000 ? 8 : t < 9000 ? 5 : t === 9000 ? 5 : 2);
  const events = feed(createDetector(), ride({ durationMs: 15000, horizontalG, speed }));
  assert.equal(events.length, 2);
  assert.ok(events[1].t_ms - events[0].t_ms >= 3000);
});

test('one long brake is one event', () => {
  const events = feed(createDetector(), ride({ durationMs: 14000, horizontalG: between(3000, 8500, 0.5), speed: ramp(3000, 8000, 9, 0) }));
  assert.equal(events.length, 1);
});

test('irregular sample spacing still detects a real brake and ignores a short one', () => {
  const jitter = [0, 7, -6, 9, -8, 4, -3, 8, -9, 5];
  const times = Array.from({ length: 451 }, (_, i) => i * 20 + jitter[i % jitter.length]).filter((t) => t >= 0);
  assert.equal(feed(createDetector(), cleanBrake({ motionTimes: times })).length, 1);
  assert.deepEqual(feed(createDetector(), cleanBrake({ motionTimes: times, horizontalG: between(3000, 3200, 0.9) })), []);
});

test('a gap in motion samples cannot be bridged into a sustained brake', () => {
  // 0.5 g is only observed for 200 ms on each side of a 600 ms sensor dropout.
  const times = Array.from({ length: 451 }, (_, i) => i * 20).filter((t) => t < 3200 || t >= 3800);
  const events = feed(createDetector(), cleanBrake({ motionTimes: times, horizontalG: between(3000, 4000, 0.5) }));
  assert.deepEqual(events, []);
});

test('a just-material gap resets an unqualified candidate', () => {
  // 0.5 g for 440 ms qualifies when every sample arrives...
  const horizontalG = between(3000, 3440, 0.5);
  assert.equal(feed(createDetector(), cleanBrake({ horizontalG })).length, 1);
  // ...but not when 140 ms of it was never observed.
  const times = Array.from({ length: 451 }, (_, i) => i * 20).filter((t) => t <= 3200 || t >= 3340);
  assert.deepEqual(feed(createDetector(), cleanBrake({ horizontalG, motionTimes: times })), []);
});

test('duplicate and out-of-order samples are ignored', () => {
  const samples = cleanBrake();
  const noisy = [];
  for (const item of samples) {
    noisy.push(item);
    if (item.kind === 'motion') noisy.push({ kind: 'motion', sample: { ...item.sample, t_ms: item.sample.t_ms - 40, accel: { x: 90, y: 90, z: 90 } } });
    noisy.push(item);
  }
  assert.deepEqual(feed(createDetector(), noisy), feed(createDetector(), samples));
});

test('malformed samples are rejected without disturbing detection', () => {
  const samples = cleanBrake();
  const detector = createDetector();
  detector.pushMotion({ t_ms: NaN, accel: { x: 0, y: 0, z: 0 }, gravity: { x: 0, y: 0, z: 9.8 } });
  detector.pushMotion({ t_ms: 1, accel: { x: Infinity, y: 0, z: 0 }, gravity: { x: 0, y: 0, z: 9.8 } });
  detector.pushMotion({ t_ms: 2, accel: { x: 5, y: 0, z: 0 }, gravity: { x: 0, y: 0, z: 0 } });
  detector.pushLocation({ t_ms: 3, lat: 123, lon: 0, speed_mps: 5, accuracy_m: 3 });
  detector.reset();
  assert.equal(feed(detector, samples).length, 1);
});

test('a late GPS callback still confirms the brake', () => {
  // Deliver every fix 900 ms late relative to the motion stream.
  const samples = cleanBrake();
  const motion = samples.filter((s) => s.kind === 'motion');
  const fixes = samples.filter((s) => s.kind === 'location');
  const late = [...motion.map((m) => ({ at: m.sample.t_ms, item: m })), ...fixes.map((f) => ({ at: f.fix.t_ms + 900, item: f }))]
    .sort((a, b) => a.at - b.at).map((x) => x.item);
  const events = feed(createDetector(), late);
  assert.equal(events.length, 1);
  assert.deepEqual(events, feed(createDetector(), samples));
});

test('reset discards pending work and keeps subscribers', () => {
  const samples = cleanBrake();
  const detector = createDetector();
  const seen = [];
  detector.onEvent((event) => seen.push(event));
  // Stop mid-brake, before any confirmation is possible.
  for (const item of samples.filter((s) => (s.kind === 'motion' ? s.sample.t_ms : s.fix.t_ms) < 1_760_000_003_500)) {
    if (item.kind === 'motion') detector.pushMotion(item.sample); else detector.pushLocation(item.fix);
  }
  detector.reset();
  assert.equal(seen.length, 0);
  // An earlier-timestamped ride is accepted after reset, and the old subscriber still hears it.
  for (const item of cleanBrake({ startMs: 1_750_000_000_000 })) {
    if (item.kind === 'motion') detector.pushMotion(item.sample); else detector.pushLocation(item.fix);
  }
  assert.equal(seen.length, 1);
});

test('end of recording does not force an unfinished detection', () => {
  const samples = cleanBrake().filter((s) => (s.kind === 'motion' ? s.sample.t_ms : s.fix.t_ms) < 1_760_000_003_900);
  assert.deepEqual(feed(createDetector(), samples), []);
});

test('instances do not share state', () => {
  const a = createDetector(), b = createDetector();
  const fromA = [], fromB = [];
  a.onEvent((e) => fromA.push(e)); b.onEvent((e) => fromB.push(e));
  const samples = cleanBrake();
  const quiet = ride({ durationMs: 9000 });
  samples.forEach((item, i) => {
    if (item.kind === 'motion') a.pushMotion(item.sample); else a.pushLocation(item.fix);
    const other = quiet[i];
    if (other.kind === 'motion') b.pushMotion(other.sample); else b.pushLocation(other.fix);
  });
  assert.equal(fromA.length, 1);
  assert.equal(fromB.length, 0);
});

test('replay is deterministic and unsubscribe stops delivery', () => {
  const first = feed(createDetector(), cleanBrake());
  const second = feed(createDetector(), cleanBrake());
  assert.deepEqual(first, second);
  const detector = createDetector();
  let count = 0;
  const off = detector.onEvent(() => count++);
  off();
  feed(detector, cleanBrake());
  assert.equal(count, 0);
});

test('a listener that resets the detector cannot cause a duplicate emission', () => {
  const detector = createDetector();
  let count = 0;
  detector.onEvent(() => { count++; detector.reset(); });
  for (const item of cleanBrake()) {
    if (item.kind === 'motion') detector.pushMotion(item.sample); else detector.pushLocation(item.fix);
  }
  assert.equal(count, 1);
});

test('event location is the fix nearest the peak', () => {
  const position = (t) => ({ lat: 33.75 + t * 1e-7, lon: -84.385 });
  const events = feed(createDetector(), cleanBrake({ position }));
  assert.equal(events.length, 1);
  const offset = events[0].t_ms - 1_760_000_000_000;
  const nearest = Math.round(offset / 1000) * 1000;
  assert.ok(Math.abs(events[0].lat - (33.75 + nearest * 1e-7)) < 1e-12, 'uses the nearest 1 Hz fix');
});

test('a gap during a long stop does not duplicate the event', () => {
  const samples = [];
  const seen = [];
  const detector = createDetector();
  detector.onEvent((e) => seen.push(e));
  const t0 = 1_760_000_000_000;
  for (let ms = 0; ms <= 7000; ms += 20) {
    if (ms >= 3200 && ms < 3400) continue; // 200 ms sensor stall mid-stop
    detector.pushMotion({ t_ms: t0 + ms, accel: { x: 0.5 * 9.80665, y: 0, z: 0 }, gravity: { x: 0, y: 0, z: 9.80665 } });
    if (ms % 1000 === 0) detector.pushLocation({ t_ms: t0 + ms, lat: 33.7531, lon: -84.3853, speed_mps: Math.max(0, 14 - 2 * (ms / 1000)), accuracy_m: 5 });
  }
  assert.equal(seen.filter((e) => e.type === 'hard_brake').length, 1);
});

test('a throwing listener neither hides the event from others nor throws into the sensor callback', () => {
  const errors = [];
  const detector = createDetector({}, { onListenerError: (e) => errors.push(e) });
  const heard = [];
  detector.onEvent(() => { throw new Error('boom'); });
  detector.onEvent((e) => heard.push(e));
  const events = feed(detector, cleanBrake());
  assert.equal(heard.length, 1);
  assert.equal(errors.length, 1);
});

test('config rejects prototype keys and windows the buffers cannot honour', () => {
  assert.throws(() => createDetector({ constructor: 1 }), /unknown detector config key/);
  assert.throws(() => createDetector({ speedDropWindowMs: 9000 }), /speedDropWindowMs/);
  assert.throws(() => createDetector({ smoothingWindowMs: 10 }), /smoothingWindowMs/);
});
