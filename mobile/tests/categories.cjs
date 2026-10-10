const { test } = require('node:test');
const assert = require('node:assert/strict');
const { CATEGORIES, categoryLabel, hazardTitle } = require('../.test-dist/reports/categories.js');
const { freezeReport } = require('../.test-dist/reports/queue.js');

const API_KINDS = ['pothole', 'obstruction', 'closure', 'other'];

test('categories are exactly the kinds the API accepts, each labelled, with Other last', () => {
  assert.deepEqual(CATEGORIES.map(c => c.kind), API_KINDS);
  assert.equal(new Set(CATEGORIES.map(c => c.label)).size, CATEGORIES.length);
  for (const c of CATEGORIES) assert.ok(c.label.length > 3 && c.hint.length > 3);
  assert.equal(CATEGORIES[CATEGORIES.length - 1].kind, 'other');
});

test('every category submits without any description, including Other', () => {
  for (const { kind } of CATEGORIES) {
    const report = freezeReport({ kind, lat: 33.75, lon: -84.38 }, Date.parse('2026-10-10T12:00:00Z'), '11111111-1111-4111-8111-111111111111');
    assert.equal(report.kind, kind);
    assert.equal('description' in report, false);
  }
});

test('manual hazards with no description show the category name, not the raw kind', () => {
  assert.equal(hazardTitle({ kind: 'pothole', label: 'pothole', source: 'manual' }), 'Pothole or rough surface');
  assert.equal(hazardTitle({ kind: 'other', label: 'other', source: 'manual' }), 'Other hazard');
  // Older reports that carry a description keep it; automatic hazards keep their own label.
  assert.equal(hazardTitle({ kind: 'closure', label: 'Fence across path', source: 'manual' }), 'Fence across path');
  assert.equal(hazardTitle({ kind: 'braking', label: 'Hard braking, 5 events', source: 'automatic' }), 'Hard braking, 5 events');
  assert.equal(categoryLabel('unknown-kind'), 'Hazard');
});
