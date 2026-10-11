const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createLatest } = require('../.test-dist/ai/latest.js');

test('a removed photo or changed route cannot receive an old AI response', async () => {
  const values = [], errors = [], busy = [];
  const latest = createLatest(v => values.push(v), () => errors.push(true), v => busy.push(v));
  let resolveOld, resolveNew;
  const old = latest.run(() => new Promise(resolve => { resolveOld = resolve; }));
  latest.clear();
  const current = latest.run(() => new Promise(resolve => { resolveNew = resolve; }));
  resolveOld('old draft'); await old;
  assert.deepEqual(values, []);
  assert.equal(busy.at(-1), true, 'old completion cannot clear a newer loading state');
  resolveNew('current draft'); await current;
  assert.deepEqual(values, ['current draft']);
  assert.deepEqual(errors, []);
  assert.equal(busy.at(-1), false);
});

test('duplicate taps do not send another paid inference and stale failures are ignored', async () => {
  let calls = 0, rejectOld;
  const errors = [];
  const latest = createLatest(() => {}, () => errors.push(true), () => {});
  const first = latest.run(() => { calls++; return new Promise((_, reject) => { rejectOld = reject; }); });
  await latest.run(async () => { calls++; });
  assert.equal(calls, 1);
  latest.clear(); rejectOld(new Error('provider failed')); await first;
  assert.deepEqual(errors, []);
  await latest.run(async () => { throw new Error('current failure'); });
  assert.deepEqual(errors, [true]);
});
