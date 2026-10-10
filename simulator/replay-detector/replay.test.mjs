import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mergeStreams, readRecording, replayRecording } from './replay.mjs';
import { writeSyntheticRecording } from './synthetic.mjs';

function temporary(t) {
  const directory = mkdtempSync(join(tmpdir(), 'replay-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('streams merge by time with the GPS fix first on a tie', () => {
  const merged = mergeStreams(
    [{ t_ms: 20 }, { t_ms: 0 }, { t_ms: 1000 }],
    [{ t_ms: 1000 }, { t_ms: 0 }],
  );
  assert.deepEqual(merged.map((m) => `${m.t}:${m.fix ? 'gps' : 'motion'}`), ['0:gps', '0:motion', '20:motion', '1000:gps', '1000:motion']);
});

test('blank speed stays unknown and bad cells are rejected', (t) => {
  const directory = writeSyntheticRecording(temporary(t));
  const { gps, motion } = readRecording(directory);
  assert.equal(gps[2].speed_mps, null);
  assert.equal(gps[0].speed_mps, 7);
  assert.equal(motion.length, 1001);
  writeFileSync(join(directory, 'gps-0001.csv'), 't_ms,lat,lon,speed_mps,accuracy_m\n1,abc,2,3,4\n');
  assert.throws(() => readRecording(directory), /lat must be a number/);
  writeFileSync(join(directory, 'gps-0001.csv'), 'time,lat,lon\n');
  assert.throws(() => readRecording(directory), /header must be/);
});

test('the same recording replays to identical output', async (t) => {
  const directory = writeSyntheticRecording(temporary(t));
  const first = await replayRecording(directory);
  const second = await replayRecording(directory);
  assert.deepEqual(first, second);
  assert.deepEqual(first.samples, { motion: 1001, gps: 21 });
  if (!first.detector.implemented) {
    // Stage 0 skeleton: it must not fabricate anything. The assertions below activate once Lane B's
    // detector is present.
    t.diagnostic('detector skeleton in use: no events expected until Lane B lands');
    assert.deepEqual(first.events, []);
    return;
  }
  assert.deepEqual(first.events.map((e) => e.type), ['hard_brake', 'bump']);
  const [brake, bump] = first.events;
  assert.ok(Math.abs(brake.t_ms - (1_760_000_000_000 + 6000)) < 1500, 'brake is located near its label');
  assert.ok(brake.speed_before_mps - brake.speed_after_mps >= 2);
  assert.ok(Math.abs(bump.t_ms - (1_760_000_000_000 + 14_000)) < 200, 'bump is located near its label');
  for (const event of first.events) for (const value of Object.values(event)) if (typeof value === 'number') assert.ok(Number.isFinite(value));
});

test('a missing detector build explains how to create it', async (t) => {
  const directory = writeSyntheticRecording(temporary(t));
  await assert.rejects(replayRecording(directory, join(directory, 'nope.js')), /Build it first/);
});
