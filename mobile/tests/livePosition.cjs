const { test } = require('node:test');
const assert = require('node:assert/strict');
const { livePosition, freshPosition } = require('../.test-dist/location/livePosition.js');
const fix = (timestamp, latitude = 33.75, accuracy = 8) => ({ timestamp, coords: { latitude, longitude: -84.38, accuracy } });

test('live position moves on fresh accurate GPS updates, rejecting stale/out-of-order/noisy fixes', () => {
  const first = livePosition(fix(100000), 100000, null);
  const next = livePosition(fix(101000, 33.751), 101000, first);
  assert.equal(next.lat, 33.751);
  for (const bad of [fix(100000), fix(50000), fix(110000), fix(102000, 91), fix(102000, NaN), fix(102000, 33.75, 500), fix(102000, 33.75, null)]) {
    assert.equal(livePosition(bad, 102000, next), next);
  }
  assert.equal(freshPosition(next, 121000), next);
  assert.equal(freshPosition(next, 121001), null, 'a stopped stream cannot leave a live-looking marker');
  assert.equal(freshPosition(null, 100000), null);
});
