const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createUploadQueue, chunk, STORAGE_KEY, MAX_ATTEMPTS, MAX_PENDING_OBSERVATIONS, QueueFullError } = require('../.test-dist/collector/src/queue/store.js');
const { createTransport, TransportError, batchPath } = require('../.test-dist/collector/src/queue/sender.js');
const { memoryStorage, uuids } = require('./helpers.cjs');

const RIDE = 'e50b27da-d972-430e-b5f8-9c6b20fd4151';
const event = n => ({ id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, ride_id: RIDE, type: 'hard_brake', ts: '2026-10-10T01:23:45.000Z', lat: 33.75, lon: -84.38, accuracy_m: 4, speed_before_mps: 6, speed_after_mps: 2, peak_g: 0.5, duration_ms: 450, source: 'device' });
const point = n => ({ id: `11111111-0000-4000-8000-${String(n).padStart(12, '0')}`, ts: '2026-10-10T01:23:45.000Z', lat: 33.75, lon: -84.38, speed_mps: 5, accuracy_m: 4, source: 'device' });

function harness({ storage = memoryStorage(), send } = {}) {
  const h = { storage, now: 1000, sent: [], stats: [] };
  h.send = send ?? (async batch => { h.sent.push(batch.payload); const n = batch.count; return { accepted: n, duplicates: 0 }; });
  h.queue = createUploadQueue({
    storage, send: batch => h.send(batch), now: () => h.now, random: () => 0.5, uuid: uuids(9), onChange: s => h.stats.push(s),
  });
  return h;
}

test('chunk splits at the limit without losing order', () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(chunk([], 2), []);
});

test('oversized batches are split at 500 events and 2000 points per ride', async () => {
  const h = harness();
  await h.queue.load();
  await h.queue.enqueueEvents(Array.from({ length: 1201 }, (_, i) => event(i)));
  await h.queue.enqueuePoints(RIDE, Array.from({ length: 4500 }, (_, i) => point(i)));
  const batches = h.queue.snapshot();
  assert.deepEqual(batches.filter(b => b.kind === 'events').map(b => b.count), [500, 500, 201]);
  assert.deepEqual(batches.filter(b => b.kind === 'points').map(b => b.count), [2000, 2000, 500]);
  assert.ok(batches.filter(b => b.kind === 'points').every(b => b.rideId === RIDE));
  assert.equal(JSON.parse(batches[0].payload).events.length, 500);
  assert.equal(batchPath(batches[0]), '/v1/events');
  assert.equal(batchPath(batches[3]), `/v1/rides/${RIDE}/points`);
});

test('a batch is persisted before any send and removed after acknowledgement', async () => {
  const h = harness();
  await h.queue.load();
  let persistedAtSend = null;
  h.send = async batch => { persistedAtSend = JSON.parse(h.storage.data.get(STORAGE_KEY)).items.length; return { accepted: batch.count, duplicates: 0 }; };
  await h.queue.enqueueEvents([event(1), event(2)]);
  await h.queue.drain();
  assert.equal(persistedAtSend, 1);
  assert.equal(h.queue.snapshot().length, 0);
  assert.deepEqual(JSON.parse(h.storage.data.get(STORAGE_KEY)).items, []);
  assert.equal(h.queue.stats().accepted, 2);
});

test('storage failure means nothing is queued', async () => {
  const h = harness();
  await h.queue.load();
  h.storage.failWrites = true;
  await assert.rejects(h.queue.enqueueEvents([event(1)]), /disk full/);
  assert.equal(h.queue.snapshot().length, 0);
});

test('restart after an unknown outcome resends the identical bytes', async () => {
  const storage = memoryStorage();
  const first = harness({ storage });
  await first.queue.load();
  const bodies = [];
  // The server accepted the batch but the response never arrived, and then the app died.
  first.send = batch => { bodies.push(batch.payload); return new Promise(() => {}); };
  await first.queue.enqueueEvents([event(1), event(2)]);
  void first.queue.drain();
  await new Promise(r => setImmediate(r));
  assert.equal(first.queue.snapshot()[0].state, 'sending');

  const second = harness({ storage });
  second.send = async batch => { bodies.push(batch.payload); return { accepted: 0, duplicates: batch.count }; };
  await second.queue.load();
  assert.equal(second.queue.snapshot()[0].state, 'queued');
  await second.queue.drain();
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0], bodies[1]);
  assert.equal(second.queue.snapshot().length, 0);
  assert.deepEqual([second.queue.stats().accepted, second.queue.stats().duplicates], [0, 2]);
});

test('temporary failures back off and retry the same body', async () => {
  const h = harness();
  await h.queue.load();
  const bodies = [];
  let failures = 2;
  h.send = async batch => {
    bodies.push(batch.payload);
    if (failures-- > 0) throw new TransportError('Observation API 503', 503);
    return { accepted: batch.count, duplicates: 0 };
  };
  await h.queue.enqueueEvents([event(1)]);
  await h.queue.drain();
  assert.equal(h.queue.snapshot()[0].state, 'queued');
  assert.equal(h.queue.nextDueAt(), 1000 + 750); // 1 s base, jitter 0.75 at random 0.5
  await h.queue.drain(); // not due yet
  assert.equal(bodies.length, 1);
  h.now = 1750; await h.queue.drain();
  h.now = 10_000; await h.queue.drain();
  assert.equal(bodies.length, 3);
  assert.ok(bodies.every(b => b === bodies[0]));
  assert.equal(h.queue.snapshot().length, 0);
});

test('Retry-After is honored', async () => {
  const h = harness();
  await h.queue.load();
  h.send = async () => { throw new TransportError('Observation API 429', 429, 30); };
  await h.queue.enqueueEvents([event(1)]);
  await h.queue.drain();
  assert.equal(h.queue.nextDueAt(), 1000 + 30_000);
});

test('409 and 422 stop the batch without looping or mutating it', async () => {
  for (const status of [409, 422]) {
    const h = harness();
    await h.queue.load();
    let calls = 0;
    h.send = async () => { calls++; throw new TransportError(`Observation API ${status}`, status); };
    await h.queue.enqueueEvents([event(1), event(2)]);
    const before = h.queue.snapshot()[0].payload;
    await h.queue.drain(); h.now += 1e9; await h.queue.drain();
    const [batch] = h.queue.snapshot();
    assert.equal(calls, 1);
    assert.equal(batch.state, 'failed');
    assert.equal(batch.retryable, false);
    assert.equal(batch.payload, before);
    assert.equal(h.queue.stats().failedBatches, 1);
    await h.queue.retry(batch.id); // a definitive rejection cannot be retried...
    assert.equal(calls, 1);
    await h.queue.discardRejected(batch.id); // ...only discarded deliberately
    assert.equal(h.queue.snapshot().length, 0);
  }
});

test('exhausted retries stay retryable with the original body and cannot be discarded', async () => {
  const h = harness();
  await h.queue.load();
  let calls = 0;
  h.send = async () => { calls++; throw new TransportError('Network error'); };
  await h.queue.enqueueEvents([event(1)]);
  for (let i = 0; i < MAX_ATTEMPTS + 3; i++) { await h.queue.drain(); h.now += 1e7; }
  const [batch] = h.queue.snapshot();
  assert.equal(calls, MAX_ATTEMPTS);
  assert.equal(batch.state, 'failed');
  assert.equal(batch.retryable, true);
  await h.queue.discardRejected(batch.id);
  assert.equal(h.queue.snapshot().length, 1);
  h.send = async b => ({ accepted: 0, duplicates: b.count });
  await h.queue.retry(batch.id);
  assert.equal(h.queue.snapshot().length, 0);
});

test('drain is single flight', async () => {
  const h = harness();
  await h.queue.load();
  let inFlight = 0, maxInFlight = 0;
  h.send = async batch => { inFlight++; maxInFlight = Math.max(maxInFlight, inFlight); await new Promise(r => setImmediate(r)); inFlight--; return { accepted: batch.count, duplicates: 0 }; };
  await h.queue.enqueueEvents([event(1)]);
  await h.queue.enqueuePoints(RIDE, [point(1)]);
  await Promise.all([h.queue.drain(), h.queue.drain(), h.queue.drain()]);
  assert.equal(maxInFlight, 1);
  assert.equal(h.queue.snapshot().length, 0);
});

test('a full queue refuses new work instead of pretending it is saved', async () => {
  const h = harness();
  await h.queue.load();
  h.send = async () => { throw new TransportError('Network error'); };
  await h.queue.enqueuePoints(RIDE, Array.from({ length: MAX_PENDING_OBSERVATIONS }, (_, i) => point(i)));
  assert.equal(h.queue.stats().full, true);
  await assert.rejects(h.queue.enqueueEvents([event(1)]), QueueFullError);
  assert.equal(h.queue.stats().pendingObservations, MAX_PENDING_OBSERVATIONS);
});

test('unreadable saved data is preserved, not overwritten', async () => {
  const storage = memoryStorage({ [STORAGE_KEY]: '{not json' });
  const h = harness({ storage });
  await h.queue.load();
  assert.match(h.queue.loadError(), /could not be read/);
  assert.equal(storage.data.get(`${STORAGE_KEY}.unreadable`), '{not json');
});

test('transport posts the frozen body and classifies failures', async () => {
  const calls = [];
  const respond = (status, body, headers = {}) => async (url, init) => {
    calls.push({ url, init });
    return { ok: status >= 200 && status < 300, status, headers: { get: n => headers[n] ?? null }, text: async () => JSON.stringify(body), json: async () => body };
  };
  const batch = { id: 'b', kind: 'points', rideId: RIDE, payload: '{"points":[]}', count: 0, state: 'queued', attempts: 0, nextAttemptAt: 0, retryable: true };
  assert.deepEqual(await createTransport('http://host:8001/', respond(200, { accepted: 3, duplicates: 1 }))(batch), { accepted: 3, duplicates: 1 });
  assert.equal(calls[0].url, `http://host:8001/v1/rides/${RIDE}/points`);
  assert.equal(calls[0].init.body, '{"points":[]}');
  assert.equal(calls[0].init.headers.Authorization, undefined);
  for (const [status, permanent] of [[409, true], [422, true], [404, true], [408, false], [429, false], [500, false], [503, false]]) {
    const error = await createTransport('http://host', respond(status, { detail: 'x' }, { 'Retry-After': '7' }))(batch).catch(e => e);
    assert.ok(error instanceof TransportError);
    assert.equal(error.permanent, permanent, `status ${status}`);
    assert.equal(error.retryAfterSeconds, 7);
  }
  const network = await createTransport('http://host', async () => { throw new Error('offline'); })(batch).catch(e => e);
  assert.equal(network.permanent, false);
  const odd = await createTransport('http://host', respond(200, { ok: true }))(batch).catch(e => e);
  assert.ok(odd instanceof TransportError);
});

test('a failed read does not let the next enqueue overwrite the saved queue', async () => {
  const storage = memoryStorage();
  const first = createUploadQueue({ storage, now: () => 1, random: () => 0.5, uuid: uuids(1), send: async () => { throw new Error('offline'); } });
  await first.load();
  await first.enqueueEvents([{ id: 'x' }]);
  const saved = storage.data.get([...storage.data.keys()][0]);
  let failReads = true;
  const flaky = { ...storage, getItem: async key => { if (failReads) throw new Error('row too big'); return storage.getItem(key); }, setItem: (k, v) => storage.setItem(k, v) };
  const second = createUploadQueue({ storage: flaky, now: () => 1, random: () => 0.5, uuid: uuids(2), send: async () => { throw new Error('offline'); } });
  await assert.rejects(second.load());
  await assert.rejects(second.enqueueEvents([{ id: 'y' }]));        // refuses rather than clobbering unread data
  assert.equal(storage.data.get([...storage.data.keys()][0]), saved);
  failReads = false;
  await second.enqueueEvents([{ id: 'y' }]);                         // once readable, both are kept
  assert.equal(second.stats().pendingObservations, 2);
});
