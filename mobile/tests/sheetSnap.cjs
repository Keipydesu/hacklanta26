const { test } = require('node:test');
const assert = require('node:assert/strict');
const { sheetSnap, collapsedScreen } = require('../.test-dist/ui/sheetSnap.js');

test('a slow release snaps to the nearest detent', () => {
  assert.equal(sheetSnap(170, 0, 132, 500), 'closed');
  assert.equal(sheetSnap(410, 0, 132, 500), 'open');
});
test('an upward or downward flick can cross the magnetic midpoint', () => {
  assert.equal(sheetSnap(200, -0.9, 132, 500), 'open');
  assert.equal(sheetSnap(410, 0.9, 132, 500), 'closed');
});
test('small gestures settle back without an intermediate detent', () => {
  assert.equal(sheetSnap(145, -0.1, 132, 500), 'closed');
  assert.equal(sheetSnap(480, 0.1, 132, 500), 'open');
});

test('closing an unfinished search skips the empty trip panel', () => {
  assert.equal(collapsedScreen('route', false), 'map');
  assert.equal(collapsedScreen('route', true), 'route');
  assert.equal(collapsedScreen('report', true), 'map');
});
