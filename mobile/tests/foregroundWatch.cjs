const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createForegroundWatch } = require('../.test-dist/location/foregroundWatch.js');
const { locateOnce } = require('../.test-dist/location/foreground.js');
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const settle = () => new Promise(r => setImmediate(r));

test('browsing checks permission without prompting; an explicit grant starts watching before a slow fix', async () => {
  let granted = false, requests = 0, watches = 0;
  const fix = deferred();
  const watcher = createForegroundWatch({
    permission: async () => ({ granted }),
    watch: async () => { watches++; return { remove() {} }; },
    onActive() {}, onPosition() {},
  });
  const api = {
    requestForegroundPermissionsAsync: async () => { requests++; granted = true; return { granted }; },
    getCurrentPositionAsync: () => fix.promise,
  };
  await watcher.setActive(true);
  assert.equal(requests, 0);
  assert.equal(watches, 0);
  const locating = locateOnce(api, 1, () => void watcher.setActive(true));
  await settle();
  assert.equal(requests, 1);
  assert.equal(watches, 1, 'permission grant must not wait for the one-shot GPS fix');
  fix.resolve({ coords: { latitude: 33.75, longitude: -84.38 } });
  assert.equal((await locating).ok, true);
  await watcher.setActive(false);
});

test('a denied explicit request does not announce a grant', async () => {
  let grants = 0;
  const result = await locateOnce({
    requestForegroundPermissionsAsync: async () => ({ granted: false }),
    getCurrentPositionAsync: () => { throw new Error('must not locate'); },
  }, 1, () => grants++);
  assert.equal(result.reason, 'denied');
  assert.equal(grants, 0);
});

test('backgrounding invalidates pending permission checks and late watch subscriptions/callbacks', async () => {
  const permission = deferred(), subscription = deferred();
  let watches = 0, removed = 0, callback;
  const positions = [], active = [];
  const watcher = createForegroundWatch({
    permission: () => permission.promise,
    watch: onPosition => { watches++; callback = onPosition; return subscription.promise; },
    onPosition: p => positions.push(p), onActive: value => active.push(value),
  });
  const first = watcher.setActive(true);
  await watcher.setActive(false);
  permission.resolve({ granted: true });
  await first;
  assert.equal(watches, 0);
  const second = watcher.setActive(true);
  await settle();
  assert.equal(watches, 1);
  await watcher.setActive(false);
  callback('stale');
  subscription.resolve({ remove: () => removed++ });
  await second;
  assert.equal(removed, 1);
  assert.deepEqual(positions, []);
  assert.deepEqual(active, [false, false, false, true, false]);
});

test('foreground return rechecks permission and removes the previous watcher', async () => {
  let granted = true, checks = 0, watches = 0, removed = 0;
  const watcher = createForegroundWatch({
    permission: async () => { checks++; return { granted }; },
    watch: async () => { watches++; return { remove: () => removed++ }; },
    onActive() {}, onPosition() {},
  });
  await watcher.setActive(false);
  assert.equal(checks, 0, 'initial background state must not start a lookup');
  await watcher.setActive(true);
  await watcher.setActive(false);
  granted = false;
  await watcher.setActive(true);
  assert.equal(checks, 2);
  assert.equal(watches, 1);
  assert.equal(removed, 1);
});


test('watch errors surface unavailable and invalidate callbacks, including a late subscription', async () => {
  const pending = deferred();
  let onPosition, onError, removed = 0;
  const statuses = [], positions = [];
  const watcher = createForegroundWatch({
    permission: async () => ({ granted: true }),
    watch: (position, error) => { onPosition = position; onError = error; return pending.promise; },
    onPosition: p => positions.push(p), onActive() {}, onStatus: s => statuses.push(s),
  });
  const starting = watcher.setActive(true);
  await settle();
  onError(); onPosition('late');
  pending.resolve({ remove() { removed++; } });
  await starting;
  assert.deepEqual(statuses, ['checking', 'unavailable']);
  assert.deepEqual(positions, []);
  assert.equal(removed, 1);
});

test('denial and startup rejection are distinguishable and a new activation can recover', async () => {
  let granted = false, fail = true;
  const statuses = [];
  const watcher = createForegroundWatch({
    permission: async () => ({ granted }),
    watch: async () => { if (fail) throw new Error('GPS off'); return { remove() {} }; },
    onPosition() {}, onActive() {}, onStatus: s => statuses.push(s),
  });
  await watcher.setActive(true);
  granted = true;
  await watcher.setActive(true);
  fail = false;
  await watcher.setActive(true);
  await watcher.setActive(false);
  assert.deepEqual(statuses, ['checking', 'denied', 'checking', 'unavailable', 'checking', 'watching', 'paused']);
});
