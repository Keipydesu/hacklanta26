import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDetector, validateConfig, DEFAULT_CONFIG, projectMotion } from '../dist/index.js';
import { ride, feed, between, G } from './helpers.mjs';

test('defaults match the architecture starting values', () => {
  assert.deepEqual(validateConfig(), {
    brakeThresholdG: 0.35, brakeReleaseG: 0.25, brakeMinDurationMs: 300, smoothingWindowMs: 200,
    minSpeedBeforeMps: 3, minSpeedDropMps: 2, speedDropWindowMs: 2000, maxAccuracyM: 20,
    brakeRefractoryMs: 3000, bumpThresholdG: 1.0, bumpMaxDurationMs: 150, bumpMinSpeedMps: 2,
    bumpRefractoryMs: 1000, demoMode: false,
  });
  assert.ok(Object.isFrozen(DEFAULT_CONFIG));
});

test('invalid configuration fails loudly', () => {
  assert.throws(() => createDetector({ brakeThresholdG: 0 }), RangeError);
  assert.throws(() => createDetector({ brakeMinDurationMs: NaN }), RangeError);
  assert.throws(() => createDetector({ bumpThresholdG: -1 }), RangeError);
  assert.throws(() => createDetector({ brakeReleaseG: 0.35 }), RangeError);
  assert.throws(() => createDetector({ brakeReleaseG: 0.5 }), RangeError);
  assert.throws(() => createDetector({ notAThreshold: 1 }), RangeError);
  assert.throws(() => createDetector({ demoMode: 'yes' }), TypeError);
  assert.doesNotThrow(() => createDetector({ brakeThresholdG: undefined }));
});

test('projection separates horizontal and vertical in g', () => {
  const p = projectMotion({ t_ms: 5, accel: { x: 3, y: 4, z: -G }, gravity: { x: 0, y: 0, z: G } });
  assert.ok(Math.abs(p.horizontalG - 5 / G) < 1e-12);
  assert.ok(Math.abs(p.verticalG + 1) < 1e-12);
  assert.equal(projectMotion({ t_ms: 5, accel: { x: 1, y: 1, z: 1 }, gravity: { x: 0, y: 0, z: 0.2 } }), null);
});

test('default mode never emits from a hand jerk without measured speed loss', () => {
  const jerk = ride({ durationMs: 6000, horizontalG: between(2000, 2600, 0.7), speed: () => 0 });
  assert.deepEqual(feed(createDetector(), jerk), []);
});

test('demo mode emits one event for a qualifying jerk at the supplied location', () => {
  const jerk = ride({ durationMs: 6000, horizontalG: between(2000, 2600, 0.7), speed: () => 0 });
  const events = feed(createDetector({ demoMode: true }), jerk);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'hard_brake');
  // Speeds echo the supplied synthetic fixes; demo mode does not invent a speed drop.
  assert.equal(events[0].speed_before_mps, 0);
  assert.equal(events[0].speed_after_mps, 0);
});

test('demo mode still requires a sustained jerk and a supplied location', () => {
  const brief = ride({ durationMs: 6000, horizontalG: between(2000, 2150, 0.9), speed: () => 0 });
  assert.deepEqual(feed(createDetector({ demoMode: true }), brief), []);
  const noLocation = ride({ durationMs: 6000, horizontalG: between(2000, 2600, 0.7) }).filter((s) => s.kind === 'motion');
  assert.deepEqual(feed(createDetector({ demoMode: true }), noLocation), []);
});

test('demo mode bypasses the bump speed gate but not the location requirement', () => {
  const tap = ride({ durationMs: 6000, verticalG: between(2000, 2060, 1.6), speed: () => 0 });
  assert.equal(feed(createDetector({ demoMode: true }), tap).length, 1);
  assert.deepEqual(feed(createDetector({ demoMode: true }), tap.filter((s) => s.kind === 'motion')), []);
});
