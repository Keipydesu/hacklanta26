const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHazardSelection, selectionAvailable } = require('../.test-dist/feedback/selection.js');
const { createFeedback } = require('../.test-dist/feedback/feedback.js');
const { cellBbox } = require('../.test-dist/feedback/nearby.js');

const now = Date.parse('2026-10-10T12:00:00Z');
const hazard = (id, lon = -84.3853) => ({
  geometry: { coordinates: [[[lon, 33.7531], [lon + .001, 33.7531], [lon, 33.7541], [lon, 33.7531]]] },
  properties: { id, status: 'active', expires_at: '2026-10-11T12:00:00Z', label: `Hazard ${id}` },
});
function harness() {
  const loads = [], pending = [];
  const selection = createHazardSelection({
    load: bbox => { loads.push(bbox); return new Promise((resolve, reject) => pending.push({ resolve, reject })); },
    onChange: () => {},
  });
  return { selection, loads, pending };
}

test('an offscreen nearby hazard can be answered using its own lookup', async () => {
  const h = harness(), nearby = hazard('near');
  const viewportFeed = []; // The map is panned somewhere else.
  const selected = h.selection.select(nearby);
  assert.equal(viewportFeed.find(f => f.properties.id === nearby.properties.id), undefined);
  assert.equal(selectionAvailable(h.selection.state(), now), true, 'seeded independently of the map feed');
  assert.equal(h.loads[0], cellBbox({ lon: -84.3853, lat: 33.7531 }));
  h.pending[0].resolve({ features: [nearby] }); await selected;
  assert.equal(selectionAvailable(h.selection.state(), now), true);
});

test('removal disables new answers but preserves details and the accepted receipt', async () => {
  const h = harness(), near = hazard('near');
  const initial = h.selection.select(near);
  h.pending[0].resolve({ features: [near] }); await initial;
  const feedback = createFeedback({
    send: async (id, body) => ({ hazard_id: id, feedback_id: body.id, duplicate: false }),
    uuid: () => 'answer', onChange: () => {},
  });
  await feedback.respond('near', 'gone');
  const changed = h.selection.refresh();
  h.pending[1].resolve({ features: [] }); await changed;
  assert.equal(selectionAvailable(h.selection.state(), now), false);
  assert.equal(h.selection.state().feature.properties.label, 'Hazard near');
  assert.equal(feedback.states().near.status, 'accepted');
});

test('switching or closing selection ignores obsolete responses and errors', async () => {
  const h = harness();
  const first = h.selection.select(hazard('old'));
  const second = h.selection.select(hazard('new', -84.38));
  h.pending[1].resolve({ features: [hazard('new', -84.38)] }); await second;
  h.pending[0].reject(new Error('old request failed')); await first;
  assert.equal(h.selection.state().feature.properties.id, 'new');
  assert.equal(h.selection.state().error, undefined);
  const late = h.selection.refresh(); h.selection.clear();
  h.pending[2].resolve({ features: [hazard('new', -84.38)] }); await late;
  assert.equal(h.selection.state(), null);
});

test('failed lookup keeps last-known availability, surfaces staleness, and still respects expiry', async () => {
  const h = harness();
  const selected = h.selection.select(hazard('near'));
  h.pending[0].reject(new Error('offline')); await selected;
  assert.equal(selectionAvailable(h.selection.state(), now), true);
  assert.match(h.selection.state().error, /last known status/);
  assert.equal(selectionAvailable(h.selection.state(), now + 48 * 3600000), false);
});

test('a newer refresh wins and inactive selection does not issue lookups', async () => {
  const h = harness();
  const old = h.selection.select(hazard('near'));
  const fresh = h.selection.refresh();
  h.pending[1].resolve({ features: [] }); await fresh;
  h.pending[0].resolve({ features: [hazard('near')] }); await old;
  assert.equal(selectionAvailable(h.selection.state(), now), false);
  await h.selection.setActive(false); await h.selection.refresh();
  assert.equal(h.loads.length, 2);
  const resumed = h.selection.setActive(true);
  h.pending[2].resolve({ features: [hazard('near')] }); await resumed;
  assert.equal(selectionAvailable(h.selection.state(), now), true);
});
