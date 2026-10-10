const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createReportQueue, freezeReport, MAX_ATTEMPTS, STORAGE_KEY } = require('../.test-dist/reports/queue.js');

const UUID = '11111111-1111-4111-8111-111111111111';
const draft = { kind: 'pothole', lat: 33.75, lon: -84.38, description: '  deep  ' };
function harness(overrides = {}) {
  const store = new Map();
  const clock = { t: Date.parse('2026-10-10T12:00:00Z') };
  const sent = [], received = [];
  let outcomes = [];
  const deps = {
    storage: { getItem: async k => store.get(k) ?? null, setItem: async (k, v) => { store.set(k, v); } },
    send: async body => {
      sent.push(body);
      const outcome = outcomes.shift() ?? 'ok';
      if (outcome === 'ok') return { report_id: body.id, hazard_id: 'h1', duplicate: false };
      throw outcome;
    },
    now: () => clock.t, random: () => 0.5, onReceipt: s => received.push(s), ...overrides,
  };
  return { store, clock, sent, received, deps, queue: createReportQueue(deps), script: o => { outcomes = o; } };
}
const transient = Object.assign(new Error('offline'), { permanent: false });
const rejected = Object.assign(new Error('409'), { permanent: true });

test('freezeReport fixes id and timestamp, trims text and validates', () => {
  const body = freezeReport(draft, Date.parse('2026-10-10T12:00:00Z'), UUID);
  assert.deepEqual(body, { id: UUID, kind: 'pothole', lat: 33.75, lon: -84.38, observed_at: '2026-10-10T12:00:00.000Z', description: 'deep' });
  assert.equal('description' in freezeReport({ ...draft, description: '  ' }, 0, UUID), false);
  assert.throws(() => freezeReport({ ...draft, description: 'x'.repeat(281) }, 0, UUID));
  assert.throws(() => freezeReport({ ...draft, lat: 91 }, 0, UUID));
});

test('kill and relaunch after an unknown outcome resends the identical body', async () => {
  const h = harness();
  h.script([transient]);
  const body = freezeReport(draft, h.clock.t, UUID);
  await h.queue.enqueue(body);
  await h.queue.drain();
  assert.equal(h.queue.snapshot()[0].state, 'queued');
  // "restart": new queue over the same storage, observation time long past
  h.clock.t += 3 * 24 * 3600 * 1000;
  const relaunched = createReportQueue(h.deps);
  await relaunched.load();
  assert.equal(relaunched.snapshot()[0].state, 'queued');
  await relaunched.drain();
  assert.equal(h.sent.length, 2);
  assert.deepEqual(h.sent[1], h.sent[0]);
  assert.equal(relaunched.snapshot()[0].state, 'submitted');
  assert.equal(h.received.length, 1);
});

test('a send interrupted mid-flight is stored as queued', async () => {
  const h = harness({ send: () => new Promise(() => {}) });
  await h.queue.enqueue(freezeReport(draft, h.clock.t, UUID));
  void h.queue.drain();
  await new Promise(r => setImmediate(r));
  assert.equal(h.queue.snapshot()[0].state, 'sending');
  await h.queue.enqueue(freezeReport(draft, h.clock.t, '22222222-2222-4222-8222-222222222222'));
  const saved = JSON.parse(h.store.get(STORAGE_KEY));
  assert.deepEqual(saved.items.map(i => i.state), ['queued', 'queued']);
});

test('backoff delays retries until due', async () => {
  const h = harness();
  h.script([transient]);
  await h.queue.enqueue(freezeReport(draft, h.clock.t, UUID));
  await h.queue.drain();
  const due = h.queue.nextDueAt();
  assert.ok(due > h.clock.t);
  await h.queue.drain();
  assert.equal(h.sent.length, 1);
  h.clock.t = due;
  await h.queue.drain();
  assert.equal(h.sent.length, 2);
});

test('duplicate submit taps and repeated drains send one request', async () => {
  const h = harness();
  const body = freezeReport(draft, h.clock.t, UUID);
  await Promise.all([h.queue.enqueue(body), h.queue.enqueue(body)]);
  await Promise.all([h.queue.drain(), h.queue.drain(), h.queue.drain()]);
  assert.equal(h.sent.length, 1);
  assert.equal(h.queue.snapshot().length, 1);
});

test('terminal rejection fails without retry and can be dismissed', async () => {
  const h = harness();
  h.script([rejected]);
  await h.queue.enqueue(freezeReport(draft, h.clock.t, UUID));
  await h.queue.drain();
  const [item] = h.queue.snapshot();
  assert.deepEqual([item.state, item.retryable], ['failed', false]);
  h.clock.t += 10 ** 7;
  await h.queue.drain();
  assert.equal(h.sent.length, 1);
  await h.queue.retry(UUID);
  assert.equal(h.sent.length, 1);
  await h.queue.dismiss(UUID);
  assert.equal(h.queue.snapshot().length, 0);
});

test('lost response after exhausted retries keeps the original id and cannot be dismissed', async () => {
  const h = harness();
  h.script(Array(MAX_ATTEMPTS + 1).fill(transient));
  await h.queue.enqueue(freezeReport(draft, h.clock.t, UUID));
  for (let i = 0; i < MAX_ATTEMPTS; i++) { h.clock.t += 10 ** 6; await h.queue.drain(); }
  let [item] = h.queue.snapshot();
  assert.deepEqual([item.state, item.retryable, item.attempts], ['failed', true, MAX_ATTEMPTS]);
  await h.queue.dismiss(UUID);
  assert.equal(h.queue.snapshot().length, 1);
  h.script([]); // server had actually accepted: idempotent duplicate receipt
  await h.queue.retry(UUID);
  [item] = h.queue.snapshot();
  assert.equal(item.state, 'submitted');
  assert.ok(h.sent.every(b => b.id === UUID && b.observed_at === h.sent[0].observed_at));
});

test('storage failure before sending queues nothing', async () => {
  const h = harness();
  h.deps.storage.setItem = async () => { throw new Error('disk full'); };
  await assert.rejects(h.queue.enqueue(freezeReport(draft, h.clock.t, UUID)), /disk full/);
  await h.queue.drain();
  assert.equal(h.sent.length, 0);
  assert.equal(h.queue.snapshot().length, 0);
});

test('unreadable saved data is preserved and surfaced', async () => {
  const h = harness();
  h.store.set(STORAGE_KEY, '{not json');
  await h.queue.load();
  assert.match(h.queue.loadError(), /could not be read/);
  assert.equal(h.store.get(`${STORAGE_KEY}.unreadable`), '{not json');
});

const turn = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

test('concurrent drain cannot send before enqueue persistence succeeds', async () => {
  const h = harness();
  const write = deferred();
  const save = h.deps.storage.setItem;
  h.deps.storage.setItem = async (...args) => { await write.promise; await save(...args); };
  const pending = h.queue.enqueue(freezeReport(draft, h.clock.t, UUID));
  await turn();
  const draining = h.queue.drain();
  await turn();
  assert.equal(h.sent.length, 0);
  assert.equal(h.queue.snapshot().length, 0);
  write.resolve();
  await Promise.all([pending, draining]);
  assert.equal(h.sent.length, 1);
});

test('rejected enqueue persistence never leaks a report to a concurrent drain', async () => {
  const h = harness();
  const write = deferred();
  h.deps.storage.setItem = () => write.promise;
  const pending = assert.rejects(h.queue.enqueue(freezeReport(draft, h.clock.t, UUID)), /disk full/);
  await turn();
  const draining = h.queue.drain();
  await turn();
  write.reject(new Error('disk full'));
  await Promise.all([pending, draining]);
  assert.equal(h.sent.length, 0);
  assert.equal(h.queue.snapshot().length, 0);
});

test('enqueue and drain during hydration preserve old and new reports on disk and in memory', async () => {
  const h = harness();
  await h.queue.enqueue(freezeReport(draft, h.clock.t, UUID));
  const saved = h.store.get(STORAGE_KEY);
  const read = deferred();
  h.deps.storage.getItem = () => read.promise;
  const q = createReportQueue(h.deps);
  const loading = q.load();
  const newId = '22222222-2222-4222-8222-222222222222';
  const pending = q.enqueue(freezeReport(draft, h.clock.t, newId));
  const draining = q.drain();
  await turn();
  assert.equal(h.sent.length, 0);
  assert.equal(h.store.get(STORAGE_KEY), saved);
  read.resolve(saved);
  await Promise.all([loading, pending, draining]);
  await q.drain();
  await q.load(); // repeated startup cannot replace live state
  assert.deepEqual(q.snapshot().map(i => i.id), [UUID, newId]);
  assert.deepEqual(JSON.parse(h.store.get(STORAGE_KEY)).items.map(i => i.id), [UUID, newId]);
  assert.deepEqual(h.sent.map(i => i.id), [UUID, newId]);
});

test('same-render submit taps mint one UUID and persist one logical submission', async () => {
  const { createSubmitGuard } = require('../.test-dist/reports/submit.js');
  const guard = createSubmitGuard();
  const h = harness();
  const write = deferred();
  const save = h.deps.storage.setItem;
  h.deps.storage.setItem = async (...args) => { await write.promise; await save(...args); };
  let ids = 0;
  const send = () => guard(async () => {
    const id = String(++ids);
    await h.queue.enqueue(freezeReport(draft, h.clock.t, id));
  });
  const first = send(), second = send();
  assert.equal(ids, 1);
  write.resolve();
  await Promise.all([first, second]);
  await h.queue.drain();
  assert.equal(h.sent.length, 1);
  await send();
  assert.equal(ids, 2, 'later deliberate submission can proceed');
  await assert.rejects(guard(async () => { throw new Error('storage failed'); }), /storage failed/);
  await send();
  assert.equal(ids, 3, 'guard releases after failure');
});
