const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PrivacyBuffer, haversineM } = require('../.test-dist/collector/src/privacy/trim.js');
const { north } = require('./helpers.cjs');

/** Ride straight north at `speed` m/s for `meters`, one fix per second. Returns released items. */
function straightRide(meters, { speed = 5, events = [], accuracy = 5 } = {}) {
  const buffer = new PrivacyBuffer();
  const out = { points: [], events: [] };
  const pendingEvents = [...events].sort((a, b) => a.atM - b.atM);
  for (let d = 0, t = 0; d <= meters; d += speed, t += 1000) {
    const released = buffer.pushFix({ t_ms: t, ...north(d), accuracy_m: accuracy }, { d });
    out.points.push(...released.points); out.events.push(...released.events);
    while (pendingEvents.length && pendingEvents[0].atM <= d) {
      const e = pendingEvents.shift();
      buffer.pushEvent(Math.round((e.atM / speed) * 1000), e);
    }
  }
  const discarded = buffer.finish();
  return { ...out, discarded, buffer };
}

test('haversine matches a known short distance', () => {
  assert.ok(Math.abs(haversineM(north(0), north(100)) - 100) < 0.01);
});

test('neither endpoint zone is ever released', () => {
  const { points } = straightRide(1000);
  assert.ok(points.length > 0);
  for (const p of points) {
    // Constructed distances carry sub-millimetre float error, hence the tolerance.
    assert.ok(p.d > 100 - 1e-3, `point at ${p.d} m is inside the start zone`);
    assert.ok(p.d < 900 + 1e-3, `point at ${p.d} m is inside the end zone`);
  }
  assert.ok(points[0].d <= 115, 'trimming does not remove much more than the zone');
  assert.ok(points[points.length - 1].d >= 885);
});

test('a ride of 200 m or less uploads nothing', () => {
  for (const meters of [0, 50, 150, 195]) {
    const { points, events } = straightRide(meters, { events: [{ atM: Math.min(meters, 100) }] });
    assert.deepEqual(points, [], `${meters} m ride released points`);
    assert.deepEqual(events, [], `${meters} m ride released events`);
  }
  assert.ok(straightRide(230).points.length >= 1, 'a slightly longer ride has an interior');
});

test('points are released only after another 100 m has been travelled', () => {
  const buffer = new PrivacyBuffer();
  const released = [];
  for (let d = 0; d <= 250; d += 5) {
    const r = buffer.pushFix({ t_ms: d * 200, ...north(d), accuracy_m: 5 }, { d });
    released.push(...r.points.map(p => ({ p: p.d, at: d })));
  }
  assert.ok(released.length > 0);
  for (const { p, at } of released) assert.ok(at - p > 100 - 1e-6);
  assert.equal(buffer.held.points > 0, true);
});

test('events are trimmed by where their peak was, not when they were delivered', () => {
  const { events } = straightRide(1000, { events: [{ atM: 40 }, { atM: 99 }, { atM: 300 }, { atM: 600 }, { atM: 905 }, { atM: 990 }] });
  assert.deepEqual(events.map(e => e.atM), [300, 600]);
});

test('an event delivered late is still placed at its peak', () => {
  const buffer = new PrivacyBuffer();
  const out = [];
  for (let d = 0; d <= 1000; d += 5) {
    out.push(...buffer.pushFix({ t_ms: d * 200, ...north(d), accuracy_m: 5 }).events);
    // Peak at 60 m (inside the start zone) but delivered when the rider is at 400 m.
    if (d === 400) buffer.pushEvent(60 * 200, { name: 'early' });
    // Peak at 500 m delivered at 520 m.
    if (d === 520) buffer.pushEvent(500 * 200, { name: 'interior' });
  }
  assert.deepEqual(out.map(e => e.name), ['interior']);
});

test('GPS jitter while standing still does not walk out of the private zone', () => {
  const buffer = new PrivacyBuffer();
  const released = [];
  // Ten minutes parked, bouncing 3 m around the same spot every second.
  for (let i = 0; i < 600; i++) {
    const offset = (i % 2 ? 3 : -3);
    released.push(...buffer.pushFix({ t_ms: i * 1000, ...north(offset), accuracy_m: 5 }, { i }).points);
  }
  assert.deepEqual(released, []);
  assert.ok(buffer.travelledM < 10, `travelled ${buffer.travelledM} m while parked`);
});

test('poor accuracy and impossible jumps do not advance distance', () => {
  const buffer = new PrivacyBuffer();
  buffer.pushFix({ t_ms: 0, ...north(0), accuracy_m: 5 });
  buffer.pushFix({ t_ms: 1000, ...north(500), accuracy_m: 5 });      // 500 m/s jump
  buffer.pushFix({ t_ms: 2000, ...north(400), accuracy_m: 80 });     // poor accuracy
  buffer.pushFix({ t_ms: 3000, ...north(300), accuracy_m: null });   // unknown accuracy
  buffer.pushFix({ t_ms: 500, ...north(8), accuracy_m: 5 });         // out of order
  assert.equal(buffer.travelledM, 0);
  buffer.pushFix({ t_ms: 4000, ...north(20), accuracy_m: 5 });
  assert.ok(Math.abs(buffer.travelledM - 20) < 0.01);
});

test('finish discards the tail and resets for the next ride', () => {
  const buffer = new PrivacyBuffer();
  for (let d = 0; d <= 180; d += 5) buffer.pushFix({ t_ms: d * 200, ...north(d), accuracy_m: 5 }, { d });
  buffer.pushEvent(150 * 200, { name: 'tail' });
  const discarded = buffer.finish();
  assert.ok(discarded.points > 0);
  assert.equal(discarded.events, 1);
  assert.deepEqual(buffer.held, { points: 0, events: 0 });
  assert.equal(buffer.travelledM, 0);
  // A new ride starts its own 100 m start zone.
  assert.deepEqual(buffer.pushFix({ t_ms: 10_000_000, ...north(5000), accuracy_m: 5 }, { d: 0 }).points, []);
});

test('an event before any accepted fix is dropped', () => {
  const buffer = new PrivacyBuffer();
  buffer.pushEvent(1000, { name: 'unlocated' });
  assert.equal(buffer.held.events, 0);
  assert.equal(buffer.droppedCounts.events, 1);
});
