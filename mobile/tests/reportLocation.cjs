const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createReportLocation, REPORT_LOCATION_MAX_AGE_MS } = require('../.test-dist/reports/location.js');
const { createReportQueue } = require('../.test-dist/reports/queue.js');
const draft = { kind: 'pothole', description: 'Uneven surface' };
function harness(locate = async () => ({ ok: true, lat: 33.7531, lon: -84.3853 })) {
  let now = 1_000_000, state;
  const controller = createReportLocation({ locate, now: () => now, onChange: next => { state = next; } });
  return { controller, state: () => state, advance: ms => { now += ms; } };
}
test('new reports require a device fix, which expires and cannot be reused after clearing', async () => {
  const h = harness();
  assert.equal(h.controller.ready(), false);
  assert.throws(() => h.controller.freeze(draft, 'a'), /location is required/);
  await h.controller.request();
  assert.equal(h.controller.ready(), true);
  const body = h.controller.freeze(draft, 'a');
  assert.equal(body.lat, 33.7531); assert.equal(body.lon, -84.3853);
  h.advance(REPORT_LOCATION_MAX_AGE_MS);
  assert.equal(h.controller.ready(), false);
  assert.throws(() => h.controller.freeze(draft, 'b'), /location is required/);
  await h.controller.request();
  assert.equal(h.controller.ready(), true);
  h.controller.clear();
  assert.throws(() => h.controller.freeze(draft, 'c'), /location is required/);
});
test('denied/unavailable/invalid positions block submission and a retry can recover', async () => {
  for (const failure of [{ ok: false, reason: 'denied' }, { ok: false, reason: 'unavailable' }, { ok: true, lat: NaN, lon: 1 }, { ok: true, lat: 91, lon: 1 }]) {
    let result = failure;
    const h = harness(async () => result);
    await h.controller.request();
    assert.equal(h.controller.ready(), false);
    assert.throws(() => h.controller.freeze(draft, 'a'), /location is required/);
    result = { ok: true, lat: 1, lon: 2 };
    await h.controller.request();
    assert.equal(h.controller.ready(), true);
  }
});
test('refresh revokes the old fix immediately; late results after leaving/backgrounding are ignored', async () => {
  let resolve, calls = 0;
  const h = harness(() => { calls++; return new Promise(r => { resolve = r; }); });
  const first = h.controller.request();
  await h.controller.request();
  assert.equal(calls, 1);
  assert.equal(h.controller.ready(), false);
  h.controller.clear();
  resolve({ ok: true, lat: 1, lon: 2 }); await first;
  assert.equal(h.controller.ready(), false);
  const second = h.controller.request();
  resolve({ ok: true, lat: 3, lon: 4 }); await second;
  const refresh = h.controller.request();
  assert.equal(h.controller.ready(), false);
  resolve({ ok: false, reason: 'denied' }); await refresh;
  assert.equal(h.state().status, 'denied');
});
test('saved reports retry after restart without location permission and preserve the entire body', async () => {
  const h = harness(); await h.controller.request();
  const body = h.controller.freeze(draft, 'original-id');
  let saved = null;
  const sent = [];
  const storage = { getItem: async () => saved, setItem: async (_, value) => { saved = value; } };
  const deps = { storage, now: () => 1_000_000, random: () => 0,
    send: async report => { sent.push(report); return { report_id: report.id, hazard_id: 'hazard', duplicate: true }; } };
  const queue = createReportQueue(deps);
  await queue.enqueue(body);
  h.controller.clear(); h.advance(REPORT_LOCATION_MAX_AGE_MS);
  await createReportQueue(deps).drain();
  assert.deepEqual(sent, [body]);
  assert.equal(h.controller.ready(), false);
});

test('a timed-out lookup cannot replace a successful retry with its late fix', async () => {
  const completions = [];
  const h = harness(() => new Promise(resolve => completions.push(resolve)));
  const first = h.controller.request();
  h.controller.clear('unavailable');
  assert.equal(h.state().status, 'unavailable');
  assert.equal(h.controller.ready(), false);
  const retry = h.controller.request();
  completions[1]({ ok: true, lat: 3, lon: 4 }); await retry;
  completions[0]({ ok: true, lat: 1, lon: 2 }); await first;
  assert.equal(h.controller.freeze(draft, 'retry').lat, 3);
});
