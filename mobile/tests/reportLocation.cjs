const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createReportLocation, REPORT_LOCATION_MAX_AGE_MS, REPORT_LOCATION_TIMEOUT_MS } = require('../.test-dist/reports/location.js');
const { createReportQueue } = require('../.test-dist/reports/queue.js');
const draft = { kind: 'pothole', description: 'Uneven surface' };
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function harness(locate = async () => ({ ok: true, lat: 33.7531, lon: -84.3853 }), options = {}) {
  let now = 1_000_000, state, id = 0;
  const timers = new Map(), changes = [];
  const controller = createReportLocation({
    requestPermission: async () => true, locate, now: () => now,
    setTimer: (fn, ms) => { timers.set(++id, { fn, at: now + ms }); return id; },
    clearTimer: id => timers.delete(id),
    onChange: next => { state = next; changes.push(next); }, ...options,
  });
  return { controller, timers, changes, state: () => state,
    advance(ms, runTimers = true) {
      now += ms;
      if (runTimers) for (const [id, timer] of timers) {
        if (timer.at <= now) { timers.delete(id); timer.fn(); }
      }
    },
  };
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
test('refresh revokes the old fix immediately; late results after explicit cancellation are ignored', async () => {
  let resolve, calls = 0;
  const h = harness(() => { calls++; return new Promise(r => { resolve = r; }); });
  const first = h.controller.request();
  await flush();
  await h.controller.request();
  assert.equal(calls, 1);
  assert.equal(h.controller.ready(), false);
  h.controller.clear();
  resolve({ ok: true, lat: 1, lon: 2 }); await first;
  assert.equal(h.controller.ready(), false);
  const second = h.controller.request();
  await flush();
  resolve({ ok: true, lat: 3, lon: 4 }); await second;
  const refresh = h.controller.request();
  await flush();
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
  await flush();
  h.advance(REPORT_LOCATION_TIMEOUT_MS);
  await first;
  assert.equal(h.state().status, 'unavailable');
  assert.equal(h.controller.ready(), false);
  const retry = h.controller.request();
  await flush();
  completions[1]({ ok: true, lat: 3, lon: 4 }); await retry;
  completions[0]({ ok: true, lat: 1, lon: 2 }); await first;
  assert.equal(h.controller.freeze(draft, 'retry').lat, 3);
});

test('expiry publishes expired without another UI event and removes its timer', async () => {
  const h = harness(); await h.controller.request();
  h.advance(REPORT_LOCATION_MAX_AGE_MS - 1);
  assert.equal(h.state().status, 'ready');
  h.advance(1);
  assert.equal(h.state().status, 'expired');
  assert.equal(h.controller.ready(), false);
  assert.equal(h.timers.size, 0);
});

test('freeze and foreground return expire a fix even when the timer was suspended', async () => {
  for (const trigger of ['freeze', 'foreground']) {
    const h = harness(); await h.controller.request();
    h.advance(REPORT_LOCATION_MAX_AGE_MS, false);
    if (trigger === 'freeze') assert.throws(() => h.controller.freeze(draft, 'late'), /location is required/);
    else h.controller.onAppState('active');
    assert.equal(h.state().status, 'expired');
    assert.equal(h.timers.size, 0);
  }
});

test('permission can take longer than 20 seconds; only position lookup has a deadline', async () => {
  let grant, locateCalls = 0;
  const h = harness(() => { locateCalls++; return new Promise(() => {}); }, {
    requestPermission: () => new Promise(resolve => { grant = resolve; }),
  });
  const request = h.controller.request();
  h.advance(90_000); await flush();
  assert.equal(h.state().status, 'locating');
  assert.equal(h.timers.size, 0); assert.equal(locateCalls, 0);
  grant(true); await flush();
  assert.equal(locateCalls, 1);
  h.advance(REPORT_LOCATION_TIMEOUT_MS - 1); await flush();
  assert.equal(h.state().status, 'locating');
  h.advance(1); await request;
  assert.equal(h.state().status, 'unavailable');
  assert.equal(h.timers.size, 0);
});

test('Android permission background and iOS inactive do not discard the first grant', async () => {
  let grant;
  const h = harness(undefined, { requestPermission: () => new Promise(resolve => { grant = resolve; }) });
  const request = h.controller.request();
  h.controller.onAppState('inactive'); h.controller.onAppState('background');
  h.advance(30_000); grant(true); await request;
  h.controller.onAppState('active');
  assert.equal(h.state().status, 'ready');
  h.controller.onAppState('inactive');
  assert.equal(h.controller.ready(), true);
  h.controller.onAppState('background');
  assert.equal(h.state().status, 'idle');
  assert.equal(h.timers.size, 0);
});

test('observation timestamp and expiry use the native fix time, not submit time', async () => {
  const h = harness(async () => ({ ok: true, lat: 1, lon: 2, timestamp: 990_000 }));
  await h.controller.request(); h.advance(25_000);
  assert.equal(h.controller.freeze(draft, 'fix-time').observed_at, new Date(990_000).toISOString());
  h.advance(25_000);
  assert.equal(h.state().status, 'expired');
});

test('fixture mode does not request permission; clear is idempotent', async () => {
  const h = harness(undefined, { enabled: false, requestPermission: () => { throw new Error('must not prompt'); } });
  await h.controller.request(); h.controller.clear(); h.controller.clear();
  assert.equal(h.changes.length, 0); assert.equal(h.timers.size, 0);
});

test('clear during permission prevents lookup and successful refresh cancels old expiry', async () => {
  let grant, calls = 0;
  const h = harness(async () => { calls++; return { ok: true, lat: 1, lon: 2 }; }, {
    requestPermission: () => new Promise(resolve => { grant = resolve; }),
  });
  const first = h.controller.request(); h.controller.clear(); grant(true); await first;
  assert.equal(calls, 0);
  const second = h.controller.request(); grant(true); await second;
  h.advance(30_000);
  const third = h.controller.request(); grant(true); await third;
  h.advance(30_000);
  assert.equal(h.state().status, 'ready'); assert.equal(h.timers.size, 1);
  h.controller.clear(); assert.equal(h.timers.size, 0);
});
