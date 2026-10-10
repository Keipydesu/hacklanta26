#!/usr/bin/env node
/**
 * Replay a recorded ride through Lane B's detector.
 *
 *   node simulator/replay-detector/replay.mjs RECORDING_DIR [--detector PATH_TO_index.js]
 *
 * Reads motion*.csv (t_ms,ax,ay,az,gx,gy,gz) and gps*.csv (t_ms,lat,lon,speed_mps,accuracy_m),
 * merges the two streams by timestamp (on a tie the GPS fix goes first, the rule agreed with the
 * detector), and prints the detected events as JSON on stdout.
 *
 * It uses the detector exactly as exported: createDetector(), pushMotion, pushLocation, onEvent.
 * No final sample is invented to force a detection at the end of a recording, and a blank speed
 * or accuracy cell stays unknown (null), never zero.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_DETECTOR = resolve(HERE, '../../automatic/detector/dist/index.js');
const MOTION_HEADER = 't_ms,ax,ay,az,gx,gy,gz';
const GPS_HEADER = 't_ms,lat,lon,speed_mps,accuracy_m';

function readParts(directory, prefix, header) {
  const rows = [];
  for (const name of readdirSync(directory).filter((n) => n.startsWith(prefix) && n.endsWith('.csv')).sort()) {
    const lines = readFileSync(join(directory, name), 'utf8').split(/\r?\n/).filter((line) => line.length);
    if (lines[0] !== header) throw new Error(`${name}: header must be "${header}"`);
    for (const line of lines.slice(1)) rows.push(line.split(','));
  }
  return rows;
}

const required = (cell, name, file) => {
  const value = Number(cell);
  if (cell === '' || cell === undefined || !Number.isFinite(value)) throw new Error(`${file}: ${name} must be a number, got "${cell}"`);
  return value;
};
const optional = (cell) => (cell === '' || cell === undefined ? null : Number(cell));

export function readRecording(directory) {
  const motion = readParts(directory, 'motion', MOTION_HEADER).map((c) => ({
    t_ms: required(c[0], 't_ms', 'motion'),
    accel: { x: required(c[1], 'ax', 'motion'), y: required(c[2], 'ay', 'motion'), z: required(c[3], 'az', 'motion') },
    gravity: { x: required(c[4], 'gx', 'motion'), y: required(c[5], 'gy', 'motion'), z: required(c[6], 'gz', 'motion') },
  }));
  const gps = readParts(directory, 'gps', GPS_HEADER).map((c) => ({
    t_ms: required(c[0], 't_ms', 'gps'), lat: required(c[1], 'lat', 'gps'), lon: required(c[2], 'lon', 'gps'),
    speed_mps: optional(c[3]), accuracy_m: optional(c[4]),
  }));
  return { motion, gps };
}

/** Stable merge by timestamp; on equal timestamps the location fix comes first. */
export function mergeStreams(motion, gps) {
  const tagged = [
    ...gps.map((fix, index) => ({ t: fix.t_ms, order: 0, index, fix })),
    ...motion.map((sample, index) => ({ t: sample.t_ms, order: 1, index, sample })),
  ];
  return tagged.sort((a, b) => a.t - b.t || a.order - b.order || a.index - b.index);
}

export async function replayRecording(directory, detectorPath = DEFAULT_DETECTOR) {
  let detectorModule;
  try {
    detectorModule = await import(pathToFileURL(detectorPath).href);
  } catch (error) {
    throw new Error(`Cannot load the detector at ${detectorPath}. Build it first: npm ci --prefix automatic/detector && npm run build --prefix automatic/detector (${error.message})`);
  }
  const { motion, gps } = readRecording(directory);
  const detector = detectorModule.createDetector();
  const events = [];
  const unsubscribe = detector.onEvent((event) => events.push(event));
  for (const item of mergeStreams(motion, gps)) {
    if (item.fix) detector.pushLocation(item.fix);
    else detector.pushMotion(item.sample);
  }
  unsubscribe();
  detector.reset();
  return {
    // The stage 0 skeleton exports no configuration and never emits; say so rather than imply
    // that an empty result came from real detection.
    detector: { implemented: typeof detectorModule.validateConfig === 'function', config: detectorModule.DEFAULT_CONFIG ?? null },
    samples: { motion: motion.length, gps: gps.length },
    events,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const flag = args.indexOf('--detector');
  const detectorPath = flag >= 0 ? resolve(args.splice(flag, 2)[1]) : DEFAULT_DETECTOR;
  if (args.length !== 1) {
    console.error('usage: node replay.mjs RECORDING_DIR [--detector PATH_TO_index.js]');
    process.exit(2);
  }
  replayRecording(resolve(args[0]), detectorPath).then(
    (result) => { process.stdout.write(JSON.stringify(result, null, 2) + '\n'); },
    (error) => { console.error(`error: ${error.message}`); process.exit(1); },
  );
}
