const { test } = require('node:test');
const assert = require('node:assert/strict');
const { shouldLocateOnEnter, showSubmit, canSubmit, locationAction } = require('../.test-dist/reports/reportFlow.js');

test('opening Report requests a fix unless one is ready or already in progress', () => {
  assert.equal(shouldLocateOnEnter('idle'), true);
  assert.equal(shouldLocateOnEnter('expired'), true);
  for (const status of ['locating', 'ready', 'denied', 'unavailable']) assert.equal(shouldLocateOnEnter(status), false, status);
});

test('Submit is hidden until a category is chosen', () => {
  assert.equal(showSubmit(null), false);
  assert.equal(showSubmit('pothole'), true);
});

test('Submit needs a category, a fresh location, a live API and no save in progress', () => {
  const ok = { kind: 'closure', locationReady: true, fixtureMode: false, submitting: false };
  assert.equal(canSubmit(ok), true);
  assert.equal(canSubmit({ ...ok, kind: null }), false);
  assert.equal(canSubmit({ ...ok, locationReady: false }), false);
  assert.equal(canSubmit({ ...ok, fixtureMode: true }), false);
  assert.equal(canSubmit({ ...ok, submitting: true }), false);
});

test('a location control only appears when there is something to retry', () => {
  for (const status of ['denied', 'unavailable', 'expired']) assert.equal(locationAction(status), 'Retry location', status);
  for (const status of ['idle', 'locating', 'ready']) assert.equal(locationAction(status), null, status);
});
