import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDetector } from '../dist/index.js';
import { ride, feed, between } from './helpers.mjs';

// A curb hit: a 60 ms vertical spike of 1.8 g at t=3000 while rolling at 5 m/s.
const curb = (overrides = {}) => ride({ durationMs: 8000, verticalG: between(3000, 3060, 1.8), speed: () => 5, ...overrides });

test('a curb hit emits exactly one bump', () => {
  const events = feed(createDetector(), curb());
  assert.equal(events.length, 1);
  const [e] = events;
  assert.equal(e.type, 'bump');
  assert.ok(Math.abs(e.peak_g - 1.8) < 1e-6);
  assert.ok(e.duration_ms > 0 && e.duration_ms < 150);
  assert.equal(e.speed_before_mps, 5);
  assert.equal(e.speed_after_mps, 5);
});

test('spike direction along gravity does not matter', () => {
  assert.equal(feed(createDetector(), curb({ verticalG: between(3000, 3060, -1.8) })).length, 1);
  assert.equal(feed(createDetector(), curb({ down: { x: 0, y: 0, z: -1 } })).length, 1);
  assert.equal(feed(createDetector(), curb({ down: { x: 1, y: 1, z: 0.2 } })).length, 1);
});

test('a ringing spike is one bump', () => {
  const verticalG = (t) => (t >= 3000 && t < 3040 ? 1.8 : t >= 3040 && t < 3080 ? -1.5 : t >= 3080 && t < 3120 ? 0.2 : t >= 3120 && t < 3160 ? 1.1 : 0);
  assert.equal(feed(createDetector(), curb({ verticalG })).length, 1);
});

test('long vibration is not a bump', () => {
  assert.deepEqual(feed(createDetector(), curb({ verticalG: between(3000, 3400, 1.5) })), []);
  // Exactly at the limit is still too long: the spike must be strictly under 150 ms.
  assert.deepEqual(feed(createDetector(), curb({ verticalG: between(3000, 3160, 1.5) })), []);
});

test('a spike under the threshold is ignored', () => {
  assert.deepEqual(feed(createDetector(), curb({ verticalG: between(3000, 3060, 0.8) })), []);
});

test('a constant vertical offset is removed before thresholding', () => {
  // A 0.5 g bias plus a 0.8 g spike is not a 1 g spike; plus a 1.2 g spike it is.
  assert.deepEqual(feed(createDetector(), curb({ verticalG: (t) => 0.5 + (t >= 3000 && t < 3060 ? 0.8 : 0) })), []);
  assert.equal(feed(createDetector(), curb({ verticalG: (t) => 0.5 + (t >= 3000 && t < 3060 ? 1.2 : 0) })).length, 1);
});

test('stationary hand movement and walking are not bumps', () => {
  assert.deepEqual(feed(createDetector(), curb({ speed: () => 0 })), []);
  assert.deepEqual(feed(createDetector(), curb({ speed: () => 1.4 })), []);
  // Walking: 0.4 g vertical bounce at 2 Hz, 1.4 m/s.
  const walking = ride({ durationMs: 8000, verticalG: (t) => 0.4 * Math.sin(2 * Math.PI * 2 * t / 1000), speed: () => 1.4 });
  assert.deepEqual(feed(createDetector(), walking), []);
});

test('missing or poor GPS means no bump', () => {
  assert.deepEqual(feed(createDetector(), curb({ speed: () => null })), []);
  assert.deepEqual(feed(createDetector(), curb({ accuracy: () => 40 })), []);
  // No fix after the spike at all: speed after is unknown, so nothing is emitted.
  const samples = curb().filter((s) => s.kind === 'motion' || s.fix.t_ms <= 1_760_000_003_000);
  assert.deepEqual(feed(createDetector(), samples), []);
});

test('bump refractory suppresses a second spike within 1 s but not after', () => {
  const close = (t) => (t >= 3000 && t < 3060) || (t >= 3600 && t < 3660) ? 1.8 : 0;
  assert.equal(feed(createDetector(), curb({ verticalG: close })).length, 1);
  const apart = (t) => (t >= 3000 && t < 3060) || (t >= 4500 && t < 4560) ? 1.8 : 0;
  assert.equal(feed(createDetector(), curb({ verticalG: apart })).length, 2);
});

test('a brake and a bump on the same ride are reported separately', () => {
  const samples = ride({
    durationMs: 12000,
    horizontalG: between(3000, 4200, 0.5), verticalG: between(8000, 8060, 1.8),
    speed: (t) => (t <= 3000 ? 7 : t < 5000 ? 4 : 4),
  });
  const events = feed(createDetector(), samples);
  assert.deepEqual(events.map((e) => e.type), ['hard_brake', 'bump']);
});
