const { test } = require('node:test');
const assert = require('node:assert/strict');
const { connectLive, liveUrl, reconnectDelayMs } = require('../.test-dist/api/live.js');
const { locateOnce } = require('../.test-dist/location/foreground.js');

function harness() {
  const timers = new Map(); let id = 0;
  const sockets = [], changes = [], status = [];
  const h = {
    timers, sockets, changes, status,
    options: {
      url: 'ws://x/v1/live',
      createSocket: () => { const s = { closed: false, close() { this.closed = true; } }; sockets.push(s); return s; },
      onChange: () => changes.push(1), onStatus: c => status.push(c),
      setTimer: (fn, ms) => { timers.set(++id, { fn, ms }); return id; },
      clearTimer: handle => timers.delete(handle), random: () => 0.5,
    },
    fire() { const [k, t] = [...timers][0]; timers.delete(k); t.fn(); return t.ms; },
  };
  return h;
}
const message = (s, data) => s.onmessage({ data: typeof data === 'string' ? data : JSON.stringify(data) });

test('liveUrl matches the HTTP scheme', () => {
  assert.equal(liveUrl('http://10.0.0.5:8000'), 'ws://10.0.0.5:8000/v1/live');
  assert.equal(liveUrl('https://api.example.com'), 'wss://api.example.com/v1/live');
});

test('bursts of hints debounce into one refetch; malformed and other messages are ignored', () => {
  const h = harness(); connectLive(h.options);
  const s = h.sockets[0]; s.onopen();
  assert.equal(h.changes.length, 1); // refetch on connect
  message(s, { type: 'hazards.changed', data: { hazard_id: 'a' } });
  message(s, { type: 'hazards.changed', data: { hazard_id: 'b' } });
  message(s, 'not json'); message(s, { type: 'other' });
  assert.equal(h.timers.size, 1);
  h.fire();
  assert.equal(h.changes.length, 2);
});

test('a dropped socket reconnects with backoff and refetches changes missed meanwhile', () => {
  const h = harness(); connectLive(h.options);
  h.sockets[0].onopen(); h.sockets[0].onclose();
  assert.deepEqual(h.status, [true, false]);
  const first = h.fire();
  assert.equal(h.sockets.length, 2);
  h.sockets[1].onerror(); // failed attempt
  const second = h.fire();
  assert.ok(second > first);
  h.sockets[2].onopen();
  assert.equal(h.changes.length, 2); // initial open + reconnect
  assert.equal(h.status.at(-1), true);
  h.sockets[2].onclose();
  assert.equal(h.fire(), reconnectDelayMs(0, 0.5)); // failure count reset after success
});

test('dispose closes the socket, cancels timers and ignores late events', () => {
  const h = harness(); const dispose = connectLive(h.options);
  const s = h.sockets[0]; s.onopen(); message(s, { type: 'hazards.changed' });
  dispose();
  assert.ok(s.closed); assert.equal(h.timers.size, 0);
  const before = h.changes.length;
  s.onclose(); message(s, { type: 'hazards.changed' });
  assert.equal(h.timers.size, 0); assert.equal(h.sockets.length, 1); assert.equal(h.changes.length, before);
});

test('locateOnce: denied, unavailable and success', async () => {
  const api = (granted, pos) => ({
    requestForegroundPermissionsAsync: async () => ({ granted }),
    getCurrentPositionAsync: async () => { if (!pos) throw new Error('no fix'); return { coords: pos }; },
  });
  assert.deepEqual(await locateOnce(api(false, null), 3), { ok: false, reason: 'denied' });
  assert.deepEqual(await locateOnce(api(true, null), 3), { ok: false, reason: 'unavailable' });
  assert.deepEqual(await locateOnce(api(true, { latitude: 1, longitude: 2 }), 3), { ok: true, lat: 1, lon: 2 });
});
