const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createRideController, DEMO_LOCATION, FLUSH_INTERVAL_MS } = require('../.test-dist/collector/src/ride/controller.js');
const { createUploadQueue } = require('../.test-dist/collector/src/queue/store.js');
const { createRecorder } = require('../.test-dist/collector/src/recording/csv.js');
const { haversineM } = require('../.test-dist/collector/src/privacy/trim.js');
const { G, memoryStorage, uuids, north, flat } = require('./helpers.cjs');

const START = 1_760_000_000_000;

function harness({ motion = true, motionPermission = true, locationPermission = true, storage = memoryStorage(), recorder = false } = {}) {
  const h = { now: START, asked: [], awake: [], sent: [], files: [], snapshots: [], timers: new Map(), motionCb: null, locationCb: null, removed: 0 };
  let timerId = 0;
  const uuid = uuids(7);
  h.platform = {
    now: () => h.now, uuid,
    motionAvailable: async () => motion,
    requestMotionPermission: async () => { h.asked.push('motion'); return motionPermission; },
    requestLocationPermission: async () => { h.asked.push('location'); return locationPermission; },
    watchMotion: (interval, cb) => { h.motionCb = cb; h.motionInterval = interval; return { remove() { h.motionCb = null; h.removed++; } }; },
    watchLocation: async cb => { h.locationCb = cb; return { remove() { h.locationCb = null; h.removed++; } }; },
    keepAwake: on => h.awake.push(on),
    setInterval: (fn, ms) => { h.timers.set(++timerId, { fn, ms }); return timerId; },
    clearInterval: id => h.timers.delete(id),
  };
  h.storage = storage;
  h.queue = createUploadQueue({
    storage, now: () => h.now, random: () => 0.5, uuid: uuids(8),
    send: async batch => { h.sent.push({ kind: batch.kind, rideId: batch.rideId, body: JSON.parse(batch.payload) }); return { accepted: batch.count, duplicates: 0 }; },
  });
  h.recorder = recorder ? createRecorder({ write: async (dir, name, contents) => { h.files.push({ dir, name, contents }); } }) : undefined;
  h.controller = createRideController({ platform: h.platform, queue: h.queue, recorder: h.recorder, onChange: s => h.snapshots.push(s) });
  /** Deliver sensors for `ms`: motion at 50 Hz, GPS at 1 Hz, from callbacks describing the ride. */
  h.run = async (ms, { horizontalG = () => 0, verticalG = () => 0, speed = () => 0, gps = true, offset = 0 } = {}) => {
    h.position ??= 0;
    for (let t = 0; t < ms; t += 20) {
      h.now += 20;
      const elapsed = offset + t;
      h.position += speed(elapsed) * 0.02;
      if (gps && h.locationCb && t % 1000 === 0) {
        h.locationCb({ timestamp: h.now, coords: { ...latlon(h.position), accuracy: 5, speed: speed(elapsed) } });
      }
      if (h.motionCb) h.motionCb(flat(horizontalG(elapsed) * G, 0, verticalG(elapsed) * G));
      if (t % FLUSH_INTERVAL_MS === 0) { for (const timer of h.timers.values()) timer.fn(); await settle(); }
    }
  };
  h.events = () => h.sent.filter(s => s.kind === 'events').flatMap(s => s.body.events);
  h.points = () => h.sent.filter(s => s.kind === 'points').flatMap(s => s.body.points);
  return h;
}
const latlon = meters => { const p = north(meters); return { latitude: p.lat, longitude: p.lon }; };
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(r => setImmediate(r)); };
const jerk = (from, to, g) => t => (t >= from && t < to ? g : 0);

test('collection is opt-in', async () => {
  const h = harness();
  assert.equal(await h.controller.startRide({ mode: 'device', consent: false }), false);
  assert.deepEqual(h.asked, []);
  assert.equal(h.controller.snapshot().phase, 'idle');
  assert.match(h.controller.snapshot().message, /opt-in/);
});

test('denied permissions and missing sensors fail visibly and collect nothing', async () => {
  for (const [options, pattern] of [[{ motion: false }, /not available/], [{ motionPermission: false }, /Motion permission/], [{ locationPermission: false }, /Location permission/]]) {
    const h = harness(options);
    assert.equal(await h.controller.startRide({ mode: 'device', consent: true }), false);
    const s = h.controller.snapshot();
    assert.equal(s.phase, 'idle');
    assert.match(s.message, pattern);
    assert.equal(h.motionCb, null);
    assert.equal(h.locationCb, null);
    assert.equal(h.timers.size, 0);
  }
});

test('indoor demo: one qualifying hand jerk is one labeled simulated event', async () => {
  const h = harness();
  assert.equal(await h.controller.startRide({ mode: 'demo', consent: true }), true);
  assert.deepEqual(h.asked, ['motion'], 'the demo never asks for location');
  assert.equal(h.locationCb, null);
  await h.run(6000, { horizontalG: jerk(2000, 2600, 0.7) });
  await h.controller.stopRide();
  await settle();
  const events = h.events();
  assert.equal(events.length, 1);
  const [e] = events;
  assert.equal(e.source, 'simulated');
  assert.equal(e.type, 'hard_brake');
  assert.deepEqual([e.lat, e.lon], [DEMO_LOCATION.lat, DEMO_LOCATION.lon]);
  assert.equal(e.ride_id, h.controller.snapshot().rideId);
  assert.match(e.id, /^[0-9a-f-]{36}$/);
  assert.ok(!Number.isNaN(Date.parse(e.ts)));
  for (const key of ['accuracy_m', 'speed_before_mps', 'speed_after_mps', 'peak_g', 'duration_ms']) assert.ok(Number.isFinite(e[key]) && e[key] >= 0, key);
  assert.deepEqual(h.points(), [], 'the demo uploads no points');
  assert.equal(h.controller.snapshot().detected, 1);
});

test('indoor demo: a weak or brief shake produces nothing', async () => {
  const h = harness();
  await h.controller.startRide({ mode: 'demo', consent: true });
  await h.run(6000, { horizontalG: jerk(2000, 2150, 0.9) });
  await h.controller.stopRide();
  await settle();
  assert.deepEqual(h.events(), []);
});

test('device ride: only interior observations are queued, labeled device', async () => {
  const h = harness();
  await h.controller.startRide({ mode: 'device', consent: true });
  assert.deepEqual(h.asked, ['motion', 'location']);
  assert.equal(h.motionInterval, 20);
  // 8 m/s cruise with two identical hard stops: one 40 m in (private zone) and one mid-ride.
  const brakes = [5000, 60_000];
  const speed = t => {
    for (const b of brakes) {
      if (t >= b && t < b + 1500) return 8 - 5 * (t - b) / 1500;
      if (t >= b + 1500 && t < b + 4000) return 3 + 5 * (t - b - 1500) / 2500;
    }
    return 8;
  };
  const horizontalG = t => (brakes.some(b => t >= b && t < b + 1500) ? 0.5 : 0);
  await h.run(140_000, { speed, horizontalG });
  const total = h.position;
  const live = h.controller.snapshot();
  assert.equal(live.detected, 2);
  assert.ok(live.motionHz > 45 && live.motionHz < 55, `measured ${live.motionHz} Hz`);
  await h.controller.stopRide();
  await settle();

  const events = h.events();
  assert.equal(events.length, 1, 'the brake inside the first 100 m is never uploaded');
  assert.equal(events[0].source, 'device');
  const origin = north(0);
  const alongM = o => haversineM(origin, o);
  assert.ok(alongM(events[0]) > 100 && alongM(events[0]) < total - 100);

  const points = h.points();
  assert.ok(points.length > 50);
  for (const p of points) {
    assert.equal(p.source, 'device');
    assert.ok(alongM(p) > 100, `point ${alongM(p).toFixed(1)} m from the start`);
    assert.ok(alongM(p) < total - 100, `point ${(total - alongM(p)).toFixed(1)} m from the end`);
  }
  const ids = new Set([...points.map(p => p.id), ...events.map(e => e.id)]);
  assert.equal(ids.size, points.length + events.length, 'observation UUIDs are unique');
  assert.ok(h.sent.filter(s => s.kind === 'points').every(s => s.rideId === events[0].ride_id));
  const done = h.controller.snapshot();
  assert.equal(done.phase, 'idle');
  assert.equal(done.trimmedEvents, 1);
  assert.ok(done.trimmedPoints > 20);
  assert.equal(done.heldPoints, 0);
});

test('a short device ride uploads nothing', async () => {
  const h = harness();
  await h.controller.startRide({ mode: 'device', consent: true });
  await h.run(30_000, { speed: () => 5 }); // 150 m
  await h.controller.stopRide();
  await settle();
  assert.deepEqual(h.sent, []);
  assert.equal(h.storage.data.size, 0);
});

test('double start is refused; stopping twice is harmless and releases everything', async () => {
  const h = harness();
  assert.equal(await h.controller.startRide({ mode: 'device', consent: true }), true);
  assert.equal(await h.controller.startRide({ mode: 'demo', consent: true }), false);
  assert.equal(h.controller.snapshot().mode, 'device');
  assert.deepEqual(h.awake, [true]);
  await h.controller.stopRide();
  await h.controller.stopRide();
  assert.equal(h.motionCb, null);
  assert.equal(h.locationCb, null);
  assert.equal(h.timers.size, 0);
  assert.deepEqual(h.awake, [true, false]);
  assert.equal(h.controller.snapshot().phase, 'idle');
});

test('leaving the foreground stops the ride and discards the uncertain tail', async () => {
  const h = harness();
  await h.controller.startRide({ mode: 'device', consent: true });
  await h.run(60_000, { speed: () => 6 }); // 360 m
  const queuedBefore = h.points().length;
  const held = h.controller.snapshot().heldPoints;
  assert.ok(held > 0);
  await h.controller.onBackground();
  await settle();
  const s = h.controller.snapshot();
  assert.equal(s.phase, 'idle');
  assert.match(s.message, /left the foreground/);
  assert.equal(h.motionCb, null);
  const origin = north(0);
  for (const p of h.points()) assert.ok(haversineM(origin, p) < h.position - 100);
  assert.ok(h.points().length >= queuedBefore);
});

test('a new ride gets a fresh ride UUID and earlier batches keep their label', async () => {
  const h = harness();
  // The product is "down": nothing is delivered, so batches stay queued across rides.
  const original = h.queue;
  let online = false;
  const queue = { ...original, drain: async () => { if (online) await original.drain(); } };
  h.controller = createRideController({ platform: h.platform, queue });
  await h.controller.startRide({ mode: 'demo', consent: true });
  const firstRide = h.controller.snapshot().rideId;
  await h.run(6000, { horizontalG: jerk(2000, 2600, 0.7) });
  await h.controller.stopRide();
  await settle();
  const before = original.snapshot().map(b => b.payload);
  assert.equal(before.length, 1);

  await h.controller.startRide({ mode: 'device', consent: true });
  assert.notEqual(h.controller.snapshot().rideId, firstRide);
  await h.controller.stopRide();
  await settle();
  assert.deepEqual(original.snapshot().map(b => b.payload), before, 'switching mode cannot relabel a queued batch');
  assert.equal(JSON.parse(before[0]).events[0].source, 'simulated');
  online = true;
  await h.controller.resumeUploads();
  assert.equal(h.events().length, 1);
  assert.equal(h.motionCb, null, 'resuming uploads never restarts sensing');
});

test('if observations cannot be saved the ride stops and says so', async () => {
  const h = harness();
  await h.controller.startRide({ mode: 'demo', consent: true });
  h.storage.failWrites = true;
  await h.run(12_000, { horizontalG: jerk(2000, 2600, 0.7) });
  await settle();
  const s = h.controller.snapshot();
  assert.equal(s.phase, 'idle');
  assert.match(s.message, /could not be saved/);
  assert.equal(s.queuedEvents, 0);
  assert.deepEqual(h.sent, []);
});

test('raw motion goes only to the local recorder, and only when asked', async () => {
  const off = harness({ recorder: true });
  await off.controller.startRide({ mode: 'demo', consent: true });
  await off.run(3000);
  await off.controller.stopRide();
  assert.deepEqual(off.files, []);

  const on = harness({ recorder: true });
  await on.controller.startRide({ mode: 'demo', consent: true, record: true });
  assert.equal(on.controller.snapshot().recording, true);
  await on.run(3000, { horizontalG: jerk(1000, 1600, 0.7) });
  await on.controller.stopRide();
  await settle();
  assert.ok(on.files.some(f => f.name === 'motion-0000.csv'));
  assert.equal(JSON.parse(on.files.find(f => f.name === 'meta.json').contents).trimmed, false);
  for (const sent of on.sent) assert.deepEqual(Object.keys(sent.body), ['events'], 'uploads contain derived events only');
});

test('leaving the foreground while permission prompts are open cancels the start', async () => {
  const h = harness();
  let release;
  h.platform.requestMotionPermission = () => new Promise(resolve => { release = () => resolve(true); });
  const starting = h.controller.startRide({ mode: 'device', consent: true });
  await settle();
  assert.equal(h.controller.snapshot().phase, 'starting');
  await h.controller.onBackground();
  assert.equal(h.controller.snapshot().phase, 'idle');
  release();
  assert.equal(await starting, false);
  assert.equal(h.controller.snapshot().phase, 'idle');
  assert.equal(h.motionCb, null);                     // never subscribed to sensors
  assert.equal(h.locationCb, null);
  assert.ok(!h.awake.includes(true));                 // screen never kept awake
  // A fresh ride afterwards still works.
  h.platform.requestMotionPermission = async () => true;
  assert.equal(await h.controller.startRide({ mode: 'device', consent: true }), true);
  await h.controller.stopRide();
});

test('the indoor demo updates the screen when something is detected', async () => {
  const h = harness();
  assert.equal(await h.controller.startRide({ mode: 'demo', consent: true }), true);
  const before = h.snapshots.length;
  await h.run(6000, { horizontalG: jerk(2000, 2600, 0.7) });
  assert.ok(h.snapshots.length > before + 2);
  assert.ok(h.snapshots.some(s => s.detected > 0));
  await h.controller.stopRide();
});
