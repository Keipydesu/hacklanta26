const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createPlaceSearch, DEBOUNCE_MS } = require('../.test-dist/trip/placeSearch.js');

function harness() {
  const timers = [], calls = [], states = [];
  const search = createPlaceSearch({
    search: query => new Promise((resolve, reject) => calls.push({ query, resolve, reject })),
    onChange: s => states.push(s),
    schedule: (run, ms) => { const t = { run, ms, cancelled: false }; timers.push(t); return t; },
    cancel: t => { t.cancelled = true; },
  });
  const fire = () => { const t = timers.filter(t => !t.cancelled).at(-1); t.cancelled = true; t.run(); };
  return { search, timers, calls, states, fire };
}
const place = name => ({ id: name, name, address: 'Atlanta', lat: 33.75, lon: -84.38 });
const settle = () => new Promise(r => setImmediate(r));

test('typing is debounced and only the final text is searched', async () => {
  const h = harness();
  h.search.type('Geo'); h.search.type('Geor'); h.search.type('Georgia');
  assert.equal(h.timers.filter(t => !t.cancelled).length, 1);
  assert.equal(h.timers[0].ms, DEBOUNCE_MS);
  h.fire();
  assert.deepEqual(h.calls.map(c => c.query), ['Georgia']);
  h.calls[0].resolve([place('Georgia State University')]);
  await settle();
  assert.equal(h.search.state().status, 'results');
  assert.equal(h.search.state().places[0].name, 'Georgia State University');
});

test('short or empty text does not search', () => {
  const h = harness();
  h.search.type('ab');
  assert.equal(h.search.state().status, 'short');
  h.search.type('   ');
  assert.equal(h.search.state().status, 'idle');
  assert.equal(h.timers.length, 0);
});

test('a late answer for older text never replaces newer results', async () => {
  const h = harness();
  h.search.type('Park'); h.fire();
  h.search.type('Klaus'); h.fire();
  h.calls[1].resolve([place('Klaus Building')]);
  await settle();
  h.calls[0].resolve([place('55 Park Place')]);
  await settle();
  assert.deepEqual(h.search.state().places.map(p => p.name), ['Klaus Building']);
  assert.equal(h.search.state().query, 'Klaus');
});

test('no matches, failure and retry are distinct states', async () => {
  const h = harness();
  h.search.type('zzzz'); h.fire();
  h.calls[0].resolve([]);
  await settle();
  assert.equal(h.search.state().status, 'empty');
  h.search.type('Georgia'); h.fire();
  h.calls[1].reject(new Error('API 503: Place search is unavailable right now'));
  await settle();
  assert.equal(h.search.state().status, 'failed');
  assert.match(h.search.state().error, /unavailable/);
  const retried = h.search.retry();
  assert.equal(h.search.state().status, 'loading');
  h.calls[2].resolve([place('Georgia State University')]);
  await retried;
  assert.equal(h.search.state().status, 'results');
});

test('reset cancels pending work and ignores a late answer', async () => {
  const h = harness();
  h.search.type('Georgia'); h.fire();
  h.search.reset();
  h.calls[0].resolve([place('Georgia State University')]);
  await settle();
  assert.deepEqual(h.search.state(), { query: '', status: 'idle', places: [] });
});

test('typing new text immediately removes the previous suggestions so none can be chosen', async () => {
  const h = harness();
  h.search.type('Old place'); h.fire();
  h.calls[0].resolve([place('Old result')]);
  await settle();
  assert.equal(h.search.state().places.length, 1);
  h.search.type('New place');
  assert.deepEqual(h.search.state(), { query: 'New place', status: 'loading', places: [] });
  h.fire();
  h.calls[1].reject(new Error('offline'));
  await settle();
  const retried = h.search.retry();
  assert.deepEqual(h.search.state().places, [], 'retry does not resurrect old suggestions either');
  h.calls[2].resolve([place('New result')]);
  await retried;
  assert.deepEqual(h.search.state().places.map(p => p.name), ['New result']);
});
