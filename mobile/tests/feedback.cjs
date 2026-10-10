const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createFeedback, feedbackQuestion } = require('../.test-dist/feedback/feedback.js');

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
  h.pending[0].resolve({ duplicate: false });
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
  h.pending[0].resolve({});
  await first;
  await h.feedback.respond('hz', 'still_there');
  assert.equal(h.sent.length, 1);
  assert.equal(h.feedback.states().hz.body.response, 'gone');
  const other = h.feedback.respond('other', 'still_there');
  assert.equal(h.sent.length, 2, 'other hazards are independent');
  h.pending[1].resolve({});
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
  h.pending[1].resolve({ duplicate: true });
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
  h.pending[1].resolve({});
  await again;
});

test('the question names the hazard category, including automatic kinds', () => {
  assert.equal(feedbackQuestion('pothole'), 'Is this pothole still there?');
  assert.equal(feedbackQuestion('braking'), 'Is this hard-braking spot still there?');
  assert.equal(feedbackQuestion('surface'), 'Is this rough surface still there?');
});
