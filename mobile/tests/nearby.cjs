const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createNearbyPrompter, distanceM, NEARBY_RADIUS_M } = require('../.test-dist/feedback/nearby.js');

const square = (lon, lat, d = 0.00005) => [[lon - d, lat - d], [lon + d, lat - d], [lon + d, lat + d], [lon - d, lat + d], [lon - d, lat - d]];
const at = (lat, lon) => ({ lat, lon });

test('distance is in metres', () => {
  const d = distanceM(at(33.7531, -84.3853), -84.3853, 33.7531 + 0.001);
  assert.ok(Math.abs(d - 111.2) < 1, String(d));
});

test('prompts the closest hazard within 40 m, once per hazard per session', () => {
  const prompter = createNearbyPrompter();
  const hazards = [{ id: 'far', ring: square(-84.3853, 33.7545) }, { id: 'near', ring: square(-84.3853, 33.75325) }, { id: 'nearer', ring: square(-84.3853, 33.75315) }];
  const here = at(33.7531, -84.3853);
  assert.equal(prompter.next(here, hazards), 'nearer');
  assert.equal(prompter.next(here, hazards), 'near', 'the next closest once the first was prompted');
  assert.equal(prompter.next(here, hazards), null, 'the far hazard is outside the radius and nothing repeats');
  assert.equal(NEARBY_RADIUS_M, 40);
});

test('large hazard areas count from their edge, not only their centre', () => {
  const prompter = createNearbyPrompter();
  const wide = { id: 'wide', ring: square(-84.3853, 33.7560, 0.0027) };
  assert.equal(prompter.next(at(33.7531, -84.3853), [wide]), 'wide');
});

test('no hazards or an empty ring prompts nothing', () => {
  const prompter = createNearbyPrompter();
  assert.equal(prompter.next(at(33.7531, -84.3853), []), null);
  assert.equal(prompter.next(at(33.7531, -84.3853), [{ id: 'x', ring: [] }]), null);
});

test('a rider inside a hazard area is at distance zero', () => {
  const prompter = createNearbyPrompter();
  assert.equal(prompter.next(at(33.7560, -84.3853), [{ id: 'inside', ring: square(-84.3853, 33.7560, 0.003) }]), 'inside');
});

const { createNearbyWatcher, cellBbox, CELL_DEG, REFETCH_MS } = require('../.test-dist/feedback/nearby.js');
function watcherHarness(features) {
  const loads = [], prompts = [];
  let now = Date.parse('2026-10-10T12:00:00Z'), busy = false, fail = false;
  const pending = [];
  const watcher = createNearbyWatcher({
    load: bbox => { loads.push(bbox); return new Promise((resolve, reject) => pending.push(() => fail ? reject(new Error('offline')) : resolve({ features }))); },
    now: () => now,
    busy: () => busy,
    onPrompt: h => prompts.push(h.properties.id),
  });
  const flush = async () => { while (pending.length) pending.shift()(); await new Promise(r => setImmediate(r)); };
  return { watcher, loads, prompts, flush, tick: ms => { now += ms; }, setBusy: b => { busy = b; }, setFail: f => { fail = f; } };
}
const feature = (id, lat, lon, extra = {}) => ({ geometry: { coordinates: [square(lon, lat)] },
  properties: { id, status: 'active', expires_at: '2026-10-11T00:00:00Z', ...extra } });

test('a stationary first fix that arrives before the lookup is prompted once the lookup returns', async () => {
  const h = watcherHarness([feature('near', 33.75315, -84.3853)]);
  const pending = h.watcher.position(at(33.7531, -84.3853));
  assert.deepEqual(h.prompts, []);
  await h.flush(); await pending;
  assert.deepEqual(h.prompts, ['near']);
});

test('the lookup covers the grid block around the rider, not the viewport and not the exact position', async () => {
  const h = watcherHarness([]);
  const pending = h.watcher.position(at(33.7531, -84.3853));
  await h.flush(); await pending;
  const [west, south, east, north] = h.loads[0].split(',').map(Number);
  assert.ok(west <= -84.3853 - CELL_DEG && east >= -84.3853 + CELL_DEG && south <= 33.7531 - CELL_DEG && north >= 33.7531 + CELL_DEG,
    'at least one full cell of margin, more than the 40 m prompt radius');
  assert.equal(cellBbox(at(33.7531, -84.3853)), cellBbox(at(33.7549, -84.3851)), 'positions in one cell send the same box');
  assert.notEqual(cellBbox(at(33.7531, -84.3853)), cellBbox(at(33.7531, -84.3801)), 'the next cell sends a different box');
  for (const v of [west, south, east, north]) assert.ok(Math.abs(v / CELL_DEG - Math.round(v / CELL_DEG)) < 1e-6, 'box edges sit on the grid');
});

test('an open panel defers the prompt; it fires once the panel closes', async () => {
  const h = watcherHarness([feature('near', 33.75315, -84.3853)]);
  h.setBusy(true);
  const pending = h.watcher.position(at(33.7531, -84.3853));
  await h.flush(); await pending;
  assert.deepEqual(h.prompts, []);
  h.setBusy(false);
  h.watcher.evaluate();
  assert.deepEqual(h.prompts, ['near']);
});

test('refetches on entering a new cell, after a minute, or when hazards change; not on every fix', async () => {
  const h = watcherHarness([]);
  const go = async p => { const pending = h.watcher.position(p); await h.flush(); await pending; };
  await go(at(33.7531, -84.3853));
  await go(at(33.7545, -84.3853));
  assert.equal(h.loads.length, 1, 'moving within the cell reuses the lookup');
  await go(at(33.7551, -84.3853));
  assert.equal(h.loads.length, 2, 'entering the next cell refetches');
  h.tick(REFETCH_MS);
  await go(at(33.7551, -84.3853));
  assert.equal(h.loads.length, 3, 'stale after a minute');
  const invalidated = h.watcher.invalidate(); await h.flush(); await invalidated;
  assert.equal(h.loads.length, 4, 'a live hazard change refetches');
});

test('a failed lookup is retried on the next fix, and resolved or expired hazards never prompt', async () => {
  const h = watcherHarness([feature('gone', 33.75315, -84.3853, { status: 'resolved' }),
    feature('old', 33.75312, -84.3853, { expires_at: '2026-10-10T11:00:00Z' })]);
  h.setFail(true);
  let pending = h.watcher.position(at(33.7531, -84.3853)); await h.flush(); await pending;
  h.setFail(false);
  pending = h.watcher.position(at(33.7531, -84.3853)); await h.flush(); await pending;
  assert.equal(h.loads.length, 2);
  assert.deepEqual(h.prompts, []);
});
