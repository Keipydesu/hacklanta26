const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createMotionNormalizer, normalizeLocation } = require('../.test-dist/collector/src/sensors/adapter.js');
const { G, flat } = require('./helpers.cjs');

test('gravity is derived from the two acceleration readings', () => {
  const n = createMotionNormalizer();
  const s = n.normalize({ acceleration: { x: 1, y: 2, z: 3 }, accelerationIncludingGravity: { x: 1, y: 2, z: 3 - G }, interval: 20 }, 1000);
  assert.deepEqual(s.accel, { x: 1, y: 2, z: 3 });
  assert.ok(Math.abs(s.gravity.z + G) < 1e-12);
  assert.equal(s.gravity.x, 0);
  assert.equal(s.t_ms, 1000);
});

test('timestamps always increase and a burst keeps its duration', () => {
  const n = createMotionNormalizer();
  const stamps = [1000, 1020, 1021, 1021, 1021, 1100, 1090].map(now => n.normalize(flat(), now).t_ms);
  assert.deepEqual(stamps, [1000, 1020, 1040, 1060, 1080, 1100, 1120]);
  for (let i = 1; i < stamps.length; i++) assert.ok(stamps[i] > stamps[i - 1]);
});

test('reset forgets the previous stamp', () => {
  const n = createMotionNormalizer();
  n.normalize(flat(), 5000);
  n.reset();
  assert.equal(n.normalize(flat(), 100).t_ms, 100);
});

test('unusable motion readings are rejected', () => {
  const n = createMotionNormalizer();
  assert.equal(n.normalize({ acceleration: null, accelerationIncludingGravity: { x: 0, y: 0, z: G } }, 1), null);
  assert.equal(n.normalize({ acceleration: { x: NaN, y: 0, z: 0 }, accelerationIncludingGravity: { x: 0, y: 0, z: G } }, 1), null);
  assert.equal(n.normalize({ acceleration: { x: 0, y: 0, z: 0 } }, 1), null);
});

test('unknown speed and accuracy stay unknown', () => {
  const base = { timestamp: 1700000000123.7, coords: { latitude: 33.75, longitude: -84.38, accuracy: 4, speed: 5 } };
  assert.deepEqual(normalizeLocation(base), { t_ms: 1700000000124, lat: 33.75, lon: -84.38, speed_mps: 5, accuracy_m: 4 });
  assert.equal(normalizeLocation({ ...base, coords: { ...base.coords, speed: -1 } }).speed_mps, null);
  assert.equal(normalizeLocation({ ...base, coords: { ...base.coords, speed: null } }).speed_mps, null);
  assert.equal(normalizeLocation({ ...base, coords: { ...base.coords, speed: NaN } }).speed_mps, null);
  assert.equal(normalizeLocation({ ...base, coords: { ...base.coords, accuracy: null } }).accuracy_m, null);
  assert.equal(normalizeLocation({ ...base, coords: { ...base.coords, latitude: 95 } }), null);
  assert.equal(normalizeLocation({ ...base, timestamp: NaN }), null);
});

test('a platform flooding samples cannot push stamps far ahead of real time', () => {
  const { createMotionNormalizer, MAX_STAMP_LEAD_MS } = require('../.test-dist/collector/src/sensors/adapter.js');
  const n = createMotionNormalizer();
  const raw = { acceleration: { x: 0, y: 0, z: 0 }, accelerationIncludingGravity: { x: 0, y: 0, z: 9.8 }, interval: 20 };
  const start = 1_760_000_000_000;
  let kept = 0, maxLead = 0;
  for (let i = 0; i < 2000; i++) { // 1000 Hz arrivals against a 50 Hz stated interval
    const s = n.normalize(raw, start + i);
    if (s) { kept++; maxLead = Math.max(maxLead, s.t_ms - (start + i)); }
  }
  assert.ok(maxLead <= MAX_STAMP_LEAD_MS, `lead ${maxLead}`);
  assert.ok(kept > 0 && kept < 2000);
});
