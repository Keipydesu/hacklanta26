const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createTrip, endpointLabel, endpointPoint } = require('../.test-dist/trip/trip.js');

function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
function harness() {
  const fixes = [], origins = [], destinations = [];
  const trip = createTrip({
    locate: () => { const d = deferred(); fixes.push(d); return d.promise; },
    setOrigin: p => origins.push(p), setDestination: p => destinations.push(p), onChange: () => {},
  });
  return { trip, fixes, origins, destinations };
}
const GSU = { name: 'Georgia State University', address: '33 Gilmer Street SE', lat: 33.7536, lon: -84.3854 };
const KLAUS = { name: 'Klaus Building', address: '266 Ferst Drive NW', lat: 33.7772, lon: -84.3962 };

test('a new trip defaults to Current location and resolves it once when planning starts', async () => {
  const h = harness();
  assert.equal(endpointLabel(h.trip.state().origin), 'Current location');
  assert.equal(h.fixes.length, 0, 'no location request until a trip is planned');
  const started = h.trip.start();
  assert.equal(h.trip.state().origin.status, 'locating');
  h.fixes[0].resolve({ ok: true, lat: 33.75, lon: -84.38 });
  await started;
  assert.deepEqual(h.trip.state().origin, { kind: 'current', status: 'ready', point: { lat: 33.75, lon: -84.38 } });
  assert.deepEqual(h.origins.at(-1), { lat: 33.75, lon: -84.38 });
  await h.trip.start();
  assert.equal(h.fixes.length, 1, 'an already resolved location is not requested again');
});

test('denied or unavailable location leaves no origin and can be retried; never a substitute point', async () => {
  const h = harness();
  const started = h.trip.start();
  h.fixes[0].resolve({ ok: false, reason: 'denied' });
  await started;
  assert.deepEqual(h.trip.state().origin, { kind: 'current', status: 'denied', point: null });
  assert.equal(h.origins.at(-1), null);
  const retried = h.trip.retryLocation();
  h.fixes[1].resolve({ ok: false, reason: 'unavailable' });
  await retried;
  assert.equal(h.trip.state().origin.status, 'unavailable');
});

test('a late location fix never overwrites a custom origin', async () => {
  const h = harness();
  const started = h.trip.start();
  h.trip.choose('origin', GSU);
  h.fixes[0].resolve({ ok: true, lat: 1, lon: 1 });
  await started;
  assert.equal(endpointLabel(h.trip.state().origin), 'Georgia State University');
  assert.deepEqual(h.origins.at(-1), { lat: GSU.lat, lon: GSU.lon });
});

test('choosing a destination keeps an explicit origin; editing a field clears its point until a new choice', () => {
  const h = harness();
  h.trip.choose('origin', GSU);
  h.trip.choose('destination', KLAUS);
  assert.equal(endpointLabel(h.trip.state().origin), 'Georgia State University');
  h.trip.edit('destination');
  assert.equal(h.trip.state().destination.kind, 'none');
  assert.equal(h.destinations.at(-1), null);
  h.trip.edit('destination');
  assert.equal(h.destinations.length, 2, 'editing an already empty field changes nothing');
});

test('swap exchanges points and labels together; refused while locating', async () => {
  const h = harness();
  const started = h.trip.start();
  assert.equal(h.trip.canSwap(), false);
  h.trip.swap();
  assert.equal(h.trip.state().origin.status, 'locating', 'no swap mid-fix');
  h.fixes[0].resolve({ ok: true, lat: 33.75, lon: -84.38 });
  await started;
  h.trip.choose('destination', KLAUS);
  h.trip.swap();
  assert.equal(endpointLabel(h.trip.state().origin), 'Klaus Building');
  assert.equal(endpointLabel(h.trip.state().destination), 'Current location');
  assert.deepEqual(h.origins.at(-1), { lat: KLAUS.lat, lon: KLAUS.lon });
  assert.deepEqual(h.destinations.at(-1), { lat: 33.75, lon: -84.38 });
});

test('clearing resets to Current location and an empty destination; map points are secondary endpoints', async () => {
  const h = harness();
  h.trip.choose('origin', GSU);
  h.trip.pick('destination', { lat: 33.76, lon: -84.39 });
  assert.equal(endpointLabel(h.trip.state().destination), 'Point on map');
  assert.deepEqual(endpointPoint(h.trip.state().destination), { lat: 33.76, lon: -84.39 });
  const cleared = h.trip.clear();
  assert.equal(h.trip.state().destination.kind, 'none');
  assert.equal(h.trip.state().origin.kind, 'current');
  h.fixes[0].resolve({ ok: true, lat: 33.75, lon: -84.38 });
  await cleared;
  assert.equal(h.trip.state().origin.status, 'ready');
});

test('Use current location restores the default after a custom origin', async () => {
  const h = harness();
  h.trip.choose('origin', GSU);
  const restored = h.trip.useCurrentLocation();
  assert.equal(h.trip.state().origin.kind, 'current');
  h.fixes[0].resolve({ ok: true, lat: 33.75, lon: -84.38 });
  await restored;
  assert.deepEqual(h.origins.at(-1), { lat: 33.75, lon: -84.38 });
});
