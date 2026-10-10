const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createRecorder, motionRow, gpsRow, labelRow, MOTION_HEADER, GPS_HEADER, FLUSH_ROWS } = require('../.test-dist/collector/src/recording/csv.js');

const sample = t => ({ t_ms: t, accel: { x: 0.125, y: -1, z: 0.3333333333 }, gravity: { x: 0, y: 0, z: 9.80665 } });

test('rows follow the agreed column order and leave unknowns blank', () => {
  assert.equal(motionRow(sample(1700000000000)), '1700000000000,0.125,-1,0.333333,0,0,9.80665');
  assert.equal(gpsRow({ t_ms: 5, lat: 33.7531, lon: -84.3853, speed_mps: 4.5, accuracy_m: 6 }), '5,33.7531000,-84.3853000,4.5,6');
  assert.equal(gpsRow({ t_ms: 5, lat: 33.7531, lon: -84.3853, speed_mps: null, accuracy_m: null }), '5,33.7531000,-84.3853000,,');
  assert.equal(labelRow(9, 'hard,brake\n'), '9,hard brake ');
});

test('nothing is written unless recording was started', async () => {
  const files = [];
  const recorder = createRecorder({ write: async (dir, name, contents) => { files.push({ dir, name, contents }); } });
  recorder.motion(sample(1)); recorder.location({ t_ms: 1, lat: 1, lon: 1, speed_mps: 1, accuracy_m: 1 });
  assert.equal(await recorder.stop(), null);
  assert.deepEqual(files, []);
});

test('a recording is written in parts with metadata marking it untrimmed', async () => {
  const files = [];
  const recorder = createRecorder({ write: async (dir, name, contents) => { files.push({ dir, name, contents }); } });
  recorder.start('ride-1', 0, 'device');
  for (let i = 0; i < FLUSH_ROWS + 10; i++) recorder.motion(sample(i * 20));
  recorder.location({ t_ms: 0, lat: 33.75, lon: -84.38, speed_mps: null, accuracy_m: 5 });
  recorder.label(40, 'bump');
  const dir = await recorder.stop();
  assert.equal(dir, 'ride-ride-1');
  assert.deepEqual(files.map(f => f.name), ['meta.json', 'motion-0000.csv', 'motion-0001.csv', 'gps-0000.csv', 'labels-0000.csv']);
  assert.ok(files.every(f => f.dir === 'ride-ride-1'));
  const meta = JSON.parse(files[0].contents);
  assert.equal(meta.trimmed, false);
  assert.equal(meta.ride_id, 'ride-1');
  const part0 = files[1].contents.trimEnd().split('\n');
  assert.equal(part0[0], MOTION_HEADER);
  assert.equal(part0.length, FLUSH_ROWS + 1);
  assert.equal(files[2].contents.trimEnd().split('\n').length, 11);
  assert.equal(files[3].contents.split('\n')[0], GPS_HEADER);
  assert.equal(recorder.active, false);
});

test('a failed write is reported, not thrown into the sensor path', async () => {
  const recorder = createRecorder({ write: async () => { throw new Error('no space'); } });
  recorder.start('r', 0, 'device');
  recorder.motion(sample(1));
  await recorder.stop();
  assert.match(recorder.error, /no space/);
});
