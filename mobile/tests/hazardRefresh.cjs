const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHazardRefresh } = require('../.test-dist/hazardRefresh.js');
const regionA = { latitude: 33.75, longitude: -84.38, latitudeDelta: 0.01, longitudeDelta: 0.01 };
const regionB = { ...regionA, latitude: 34 };
const hazards = label => ({ type: 'FeatureCollection', features: [], label });
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('a submit completing after a pan refreshes the current viewport', async () => {
  let region = regionA;
  const requested = [], applied = [];
  const refresh = createHazardRefresh(() => region, async current => {
    requested.push(current);
    return hazards(current.latitude);
  }, result => applied.push(result.label), assert.fail);
  const post = deferred();
  // This callback was captured before the pan, as with the report button's send handler.
  const submitted = (async () => { await post.promise; await refresh(); })();
  region = regionB;
  await refresh();
  post.resolve();
  await submitted;
  assert.deepEqual(requested, [regionB, regionB]);
  assert.deepEqual(applied, [regionB.latitude, regionB.latitude]);
});

test('old viewport responses and errors cannot replace current results', async () => {
  let region = regionA;
  const requests = [], applied = [], errors = [];
  const refresh = createHazardRefresh(() => region, () => {
    const request = deferred(); requests.push(request); return request.promise;
  }, result => applied.push(result.label), error => errors.push(error));
  const oldSuccess = refresh();
  const oldFailure = refresh();
  region = regionB;
  // Also reject an old result during the gap before the new viewport effect runs.
  requests[1].reject(new Error('old viewport outage'));
  await oldFailure;
  const latest = refresh();
  requests[2].resolve(hazards('current'));
  await latest;
  requests[0].resolve(hazards('old'));
  await oldSuccess;
  assert.deepEqual(applied, ['current']);
  assert.deepEqual(errors, []);
});
