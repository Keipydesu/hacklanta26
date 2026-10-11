const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createFeedback, feedbackQuestion } = require('../.test-dist/feedback/feedback.js');
const receiptFor = (hazardId, body, duplicate = false) => ({ feedback_id: body.id, hazard_id: hazardId, duplicate });

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function harness() {
  const sent = [], pending = [], accepted = [];
  let n = 0;
  const feedback = createFeedback({
    send: (hazardId, body) => { sent.push([hazardId, body]); const d = deferred(); pending.push(d); return d.promise; },
    uuid: () => `uuid-${++n}`,
    onChange: () => {},
    onAccepted: id => accepted.push(id),
  });
  return { feedback, sent, pending, accepted };
}

test('an answer shows as sending until the server receipt arrives, then accepted', async () => {
  const h = harness();
  const done = h.feedback.respond('hz', 'still_there');
  assert.equal(h.feedback.states().hz.status, 'sending');
  assert.deepEqual(h.accepted, []);
  h.pending[0].resolve(receiptFor('hz', h.sent[0][1]));
  await done;
  assert.equal(h.feedback.states().hz.status, 'accepted');
  assert.deepEqual(h.sent, [['hz', { id: 'uuid-1', response: 'still_there' }]]);
  assert.deepEqual(h.accepted, ['hz']);
});

test('one answer per hazard: taps while sending or after acceptance are ignored', async () => {
  const h = harness();
  const first = h.feedback.respond('hz', 'gone');
  await h.feedback.respond('hz', 'still_there');
  assert.equal(h.sent.length, 1);
  h.pending[0].resolve(receiptFor('hz', h.sent[0][1]));
  await first;
  await h.feedback.respond('hz', 'still_there');
  assert.equal(h.sent.length, 1);
  assert.equal(h.feedback.states().hz.body.response, 'gone');
  const other = h.feedback.respond('other', 'still_there');
  assert.equal(h.sent.length, 2, 'other hazards are independent');
  h.pending[1].resolve(receiptFor('other', h.sent[1][1]));
  await other;
});

test('a transient failure keeps the same body for retry; a new tap does not replace it', async () => {
  const h = harness();
  const first = h.feedback.respond('hz', 'gone');
  h.pending[0].reject(Object.assign(new Error('Network request failed'), { permanent: false }));
  await first;
  assert.deepEqual(h.feedback.states().hz, { body: { id: 'uuid-1', response: 'gone' }, status: 'failed', error: 'Network request failed', retryable: true });
  await h.feedback.respond('hz', 'still_there');
  assert.equal(h.sent.length, 1, 'retryable failures are retried, not replaced');
  const retry = h.feedback.retry('hz');
  assert.deepEqual(h.sent[1], ['hz', { id: 'uuid-1', response: 'gone' }], 'identical body and UUID');
  h.pending[1].resolve(receiptFor('hz', h.sent[1][1], true));
  await retry;
  assert.equal(h.feedback.states().hz.status, 'accepted');
});

test('a permanent rejection (e.g. hazard already resolved) cannot be retried but allows a new answer', async () => {
  const h = harness();
  const first = h.feedback.respond('hz', 'gone');
  h.pending[0].reject(Object.assign(new Error('API 404: Hazard is unknown, resolved or expired'), { permanent: true }));
  await first;
  assert.equal(h.feedback.states().hz.retryable, false);
  await h.feedback.retry('hz');
  assert.equal(h.sent.length, 1);
  const again = h.feedback.respond('hz', 'still_there');
  assert.deepEqual(h.sent[1], ['hz', { id: 'uuid-2', response: 'still_there' }], 'a fresh UUID for a new answer');
  h.pending[1].resolve(receiptFor('hz', h.sent[1][1]));
  await again;
});

test('the question names the hazard category, including automatic kinds', () => {
  assert.equal(feedbackQuestion('pothole'), 'Is this pothole or rough surface still there?');
  assert.equal(feedbackQuestion('obstruction'), 'Is this obstruction still there?');
  assert.equal(feedbackQuestion('closure'), 'Is this closed path or road still there?');
  assert.equal(feedbackQuestion('other'), 'Is this hazard still there?');
  assert.equal(feedbackQuestion('braking'), 'Is this hard-braking spot still there?');
  assert.equal(feedbackQuestion('surface'), 'Is this rough surface still there?');
  assert.equal(feedbackQuestion('abandoned'), 'Is this abandoned path still there?');
});

test('a missing, malformed or mismatched receipt is not acceptance; the answer stays retryable', async () => {
  for (const bad of [undefined, {}, { feedback_id: 'uuid-x', hazard_id: 'hz', duplicate: false },
    { feedback_id: 'uuid-1', hazard_id: 'other', duplicate: false }, { feedback_id: 'uuid-1', hazard_id: 'hz', duplicate: 'no' }]) {
    const h = harness();
    const done = h.feedback.respond('hz', 'gone');
    h.pending[0].resolve(bad);
    await done;
    const state = h.feedback.states().hz;
    assert.equal(state.status, 'failed', JSON.stringify(bad));
    assert.equal(state.retryable, true);
    assert.deepEqual(h.accepted, []);
  }
});
