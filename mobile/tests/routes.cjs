const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createRouteComparison, presentRoutes, canRequest, validPoint, formatDistance, formatDuration, formatRisk } = require('../.test-dist/routes/model.js');

const A = { lat: 33.7531, lon: -84.3853 }, B = { lat: 33.756, lon: -84.388 }, C = { lat: 33.75, lon: -84.39 };
const route = (kind, coordinates, distance_m, hazard_ids = [], risk_score = 0) =>
  ({ kind, geometry: { type: 'LineString', coordinates }, distance_m, duration_s: distance_m / 4.4, risk_score, hazard_ids });
const DIRECT = [[-84.3853, 33.7531], [-84.386, 33.7545], [-84.388, 33.756]];
const DETOUR = [[-84.3853, 33.7531], [-84.3848, 33.7544], [-84.388, 33.756]];
const two = { routes: [route('shortest', DIRECT, 410, ['h1', 'h2'], 0.75), route('safest', DETOUR, 540)], safest_available: true };
const fallback = { routes: [route('shortest', DIRECT, 410, ['h1'], 0.5), route('safest', DIRECT, 410, ['h1'], 0.5)], safest_available: false };
const apiError = status => Object.assign(new Error(`API ${status}`), { status });

/** load() calls stay pending until the test resolves or rejects them. */
function harness() {
  const h = { calls: [], states: [] };
  h.comparison = createRouteComparison({
    load: (origin, destination) => new Promise((resolve, reject) => h.calls.push({ origin, destination, resolve, reject })),
    onChange: s => h.states.push(s),
  });
  return h;
}

test('the route action needs two distinct valid points', async () => {
  const h = harness();
  assert.equal(canRequest(h.comparison.state()), false);
  await h.comparison.request();
  h.comparison.setOrigin(A);
  await h.comparison.request();
  h.comparison.setDestination(A);
  assert.equal(canRequest(h.comparison.state()), false);
  await h.comparison.request();
  assert.equal(h.calls.length, 0);
  h.comparison.setDestination({ lat: 95, lon: 0 }); // invalid points are ignored
  assert.deepEqual(h.comparison.state().destination, A);
  assert.equal(validPoint({ lat: NaN, lon: 0 }), false);
});

test('a successful comparison is shown for the selected pair', async () => {
  const h = harness();
  h.comparison.setOrigin(A); h.comparison.setDestination(B);
  const pending = h.comparison.request();
  assert.equal(h.comparison.state().status, 'loading');
  assert.deepEqual([h.calls[0].origin, h.calls[0].destination], [A, B]);
  h.calls[0].resolve({ response: two, illustrative: false });
  await pending;
  const s = h.comparison.state();
  assert.equal(s.status, 'ready');
  assert.equal(s.result.response, two);
});

test('repeated taps share one in-flight request', async () => {
  const h = harness();
  h.comparison.setOrigin(A); h.comparison.setDestination(B);
  const first = h.comparison.request(), second = h.comparison.request();
  assert.equal(h.calls.length, 1);
  h.calls[0].resolve({ response: two, illustrative: false });
  await Promise.all([first, second]);
  assert.equal(h.comparison.state().status, 'ready');
});

test('changing an endpoint clears the comparison and suppresses the old response', async () => {
  const h = harness();
  h.comparison.setOrigin(A); h.comparison.setDestination(B);
  const first = h.comparison.request();
  h.comparison.setDestination(C); // moved the pin while the request was in flight
  assert.equal(h.comparison.state().status, 'idle');
  const second = h.comparison.request();
  assert.equal(h.calls.length, 2, 'a new pair gets its own request');
  h.calls[1].resolve({ response: fallback, illustrative: false });
  await second;
  h.calls[0].resolve({ response: two, illustrative: false }); // late answer for A→B
  await first;
  assert.equal(h.comparison.state().result.response, fallback);
  // A stale failure is ignored just the same.
  h.comparison.setOrigin(C); h.comparison.setOrigin(A);
  const third = h.comparison.request();
  h.comparison.setOrigin(B);
  h.calls[2].reject(apiError(503));
  await third;
  assert.equal(h.comparison.state().status, 'idle');
  assert.equal(h.comparison.state().error, null);
});

test('setting the same point again keeps the comparison', async () => {
  const h = harness();
  h.comparison.setOrigin(A); h.comparison.setDestination(B);
  const pending = h.comparison.request();
  h.calls[0].resolve({ response: two, illustrative: false });
  await pending;
  h.comparison.setOrigin({ ...A });
  assert.equal(h.comparison.state().status, 'ready');
});

test('503 is reported as routing unavailable and can be retried', async () => {
  const h = harness();
  h.comparison.setOrigin(A); h.comparison.setDestination(B);
  let pending = h.comparison.request();
  h.calls[0].reject(apiError(503));
  await pending;
  let s = h.comparison.state();
  assert.equal(s.status, 'unavailable');
  assert.match(s.error, /map and reporting still work/);
  assert.equal(s.result, null);
  pending = h.comparison.request();
  assert.equal(h.calls.length, 2);
  h.calls[1].resolve({ response: two, illustrative: false });
  await pending;
  s = h.comparison.state();
  assert.equal(s.status, 'ready');
  assert.equal(s.error, null);
});

test('a failed refresh keeps the earlier comparison without inventing a hazard hint', async () => {
  const h = harness();
  h.comparison.setOrigin(A); h.comparison.setDestination(B);
  let pending = h.comparison.request();
  h.calls[0].resolve({ response: two, illustrative: false });
  await pending;
  pending = h.comparison.request();
  h.calls[1].reject(apiError(503));
  await pending;
  const s = h.comparison.state();
  assert.equal(s.status, 'unavailable');
  assert.equal(s.result.response, two);
  assert.equal(s.outdated, false);
});

test('other failures and unroutable points are explained', async () => {
  const h = harness();
  h.comparison.setOrigin(A); h.comparison.setDestination(B);
  let pending = h.comparison.request();
  h.calls[0].reject(apiError(422));
  await pending;
  assert.match(h.comparison.state().error, /cannot be routed/);
  pending = h.comparison.request();
  h.calls[1].reject(new Error('Aborted'));
  await pending;
  assert.equal(h.comparison.state().status, 'failed');
  assert.match(h.comparison.state().error, /Could not compare routes right now/);
  assert.doesNotMatch(h.comparison.state().error, /Aborted/, 'no internal error text in rider copy');
  pending = h.comparison.request();
  h.calls[2].resolve({ response: { routes: [], safest_available: false }, illustrative: false });
  await pending;
  assert.equal(h.comparison.state().status, 'failed');
});

test('a hazard change marks an existing comparison outdated until refreshed', async () => {
  const h = harness();
  h.comparison.hazardsChanged(); // nothing to mark yet
  assert.equal(h.states.length, 0);
  h.comparison.setOrigin(A); h.comparison.setDestination(B);
  let pending = h.comparison.request();
  h.calls[0].resolve({ response: two, illustrative: false });
  await pending;
  h.comparison.hazardsChanged();
  assert.equal(h.comparison.state().outdated, true);
  pending = h.comparison.request();
  h.calls[1].resolve({ response: fallback, illustrative: false });
  await pending;
  assert.equal(h.comparison.state().outdated, false);
});

test('swap and clear reset the comparison', async () => {
  const h = harness();
  h.comparison.setOrigin(A); h.comparison.setDestination(B);
  const pending = h.comparison.request();
  h.calls[0].resolve({ response: two, illustrative: false });
  await pending;
  h.comparison.swap();
  let s = h.comparison.state();
  assert.deepEqual([s.origin, s.destination, s.result], [B, A, null]);
  h.comparison.clear();
  s = h.comparison.state();
  assert.deepEqual([s.origin, s.destination, s.status], [null, null, 'idle']);
});

test('two distinct routes are presented with lower-risk wording', () => {
  const p = presentRoutes({ response: two, illustrative: false });
  assert.equal(p.shortest.label, 'Shortest');
  assert.equal(p.lowerRisk.label, 'Lower-risk');
  assert.equal(p.lowerRisk.kind, 'safest');
  assert.equal(p.summary, 'The lower-risk route is 130 m longer and crosses 2 fewer reported hazards.');
  assert.equal(p.shortest.hazardCount, 2);
  assert.doesNotMatch(JSON.stringify(p), /safe route|safest route|Safest/);
});

test('no alternative is never drawn as two different paths', () => {
  const p = presentRoutes({ response: fallback, illustrative: false });
  assert.equal(p.lowerRisk, null);
  assert.match(p.summary, /No lower-risk alternative is available/);
  assert.match(p.summary, /crosses 1 reported hazard\./);
});

test('identical successful routes are shown honestly as one', () => {
  const same = { routes: [route('shortest', DIRECT, 410), route('safest', DIRECT, 410)], safest_available: true };
  const p = presentRoutes({ response: same, illustrative: true });
  assert.equal(p.lowerRisk, null);
  assert.match(p.summary, /also the lower-risk route/);
  assert.equal(p.illustrative, true);
  assert.equal(presentRoutes({ response: { routes: [], safest_available: false }, illustrative: false }), null);
});

test('formatting', () => {
  assert.equal(formatDistance(409.6), '410 m');
  assert.equal(formatDistance(1240), '1.2 km');
  assert.equal(formatDistance(12400), '12 km');
  assert.equal(formatDuration(40), 'under 1 min');
  assert.equal(formatDuration(122), '2 min');
  assert.equal(formatRisk(0.5), 'risk 0.50');
});

test('hazard hints during initial comparison and refresh survive successful responses', async () => {
  const h = harness();
  h.comparison.setOrigin(A); h.comparison.setDestination(B);
  for (let i = 0; i < 2; i++) {
    const pending = h.comparison.request();
    h.comparison.hazardsChanged();
    h.calls[i].resolve({ response: two, illustrative: false });
    await pending;
    assert.equal(h.comparison.state().outdated, true);
  }
  const fresh = h.comparison.request();
  h.calls[2].resolve({ response: two, illustrative: false });
  await fresh;
  assert.equal(h.comparison.state().outdated, false);
});

test('failed refresh preserves actual hazard staleness and network errors alone do not create it', async () => {
  for (const changed of [false, true]) {
    for (const error of [apiError(503), new Error('timeout')]) {
      const h = harness();
      h.comparison.setOrigin(A); h.comparison.setDestination(B);
      const first = h.comparison.request();
      h.calls[0].resolve({ response: two, illustrative: false });
      await first;
      const refresh = h.comparison.request();
      if (changed) h.comparison.hazardsChanged();
      h.calls[1].reject(error);
      await refresh;
      assert.equal(h.comparison.state().outdated, changed);
      assert.equal(h.comparison.state().result.response, two);
      assert.ok(h.comparison.state().error);
    }
  }
});

test('a hint during an obsolete endpoint request does not taint the next pair', async () => {
  const h = harness();
  h.comparison.setOrigin(A); h.comparison.setDestination(B);
  const old = h.comparison.request();
  h.comparison.hazardsChanged();
  h.comparison.setDestination(C);
  const current = h.comparison.request();
  h.calls[1].resolve({ response: two, illustrative: false });
  await current;
  h.calls[0].resolve({ response: fallback, illustrative: false });
  await old;
  assert.equal(h.comparison.state().outdated, false);
  assert.equal(h.comparison.state().result.response, two);
});
