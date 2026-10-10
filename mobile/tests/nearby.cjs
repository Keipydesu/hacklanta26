const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createNearbyPrompter, distanceM, NEARBY_RADIUS_M } = require('../.test-dist/feedback/nearby.js');

const square = (lon, lat, d = 0.00005) => [[lon - d, lat - d], [lon + d, lat - d], [lon + d, lat + d], [lon - d, lat + d], [lon - d, lat - d]];
const at = (lat, lon) => ({ lat, lon });

test('distance is in metres', () => {
  const d = distanceM(at(33.7531, -84.3853), -84.3853, 33.7531 + 0.001);
  assert.ok(Math.abs(d - 111.2) < 1, String(d));
});

test('prompts the closest hazard within 40 m, once per hazard per session', () => {
  const prompter = createNearbyPrompter();
  const hazards = [{ id: 'far', ring: square(-84.3853, 33.7545) }, { id: 'near', ring: square(-84.3853, 33.75325) }, { id: 'nearer', ring: square(-84.3853, 33.75315) }];
  const here = at(33.7531, -84.3853);
  assert.equal(prompter.next(here, hazards), 'nearer');
  assert.equal(prompter.next(here, hazards), 'near', 'the next closest once the first was prompted');
  assert.equal(prompter.next(here, hazards), null, 'the far hazard is outside the radius and nothing repeats');
  assert.equal(NEARBY_RADIUS_M, 40);
});

test('large hazard areas count from their edge, not only their centre', () => {
  const prompter = createNearbyPrompter();
  const wide = { id: 'wide', ring: square(-84.3853, 33.7560, 0.0027) };
  assert.equal(prompter.next(at(33.7531, -84.3853), [wide]), 'wide');
});

test('no hazards or an empty ring prompts nothing', () => {
  const prompter = createNearbyPrompter();
  assert.equal(prompter.next(at(33.7531, -84.3853), []), null);
  assert.equal(prompter.next(at(33.7531, -84.3853), [{ id: 'x', ring: [] }]), null);
});

test('a rider inside a hazard area is at distance zero', () => {
  const prompter = createNearbyPrompter();
  assert.equal(prompter.next(at(33.7560, -84.3853), [{ id: 'inside', ring: square(-84.3853, 33.7560, 0.003) }]), 'inside');
});
