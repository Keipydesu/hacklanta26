/** Deterministic UI-test bindings. Only selected by an explicit test bundle build flag. */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { createUploadQueue, type Batch, type QueueStats } from '../queue/store';
import { createRideController, type Platform, type RideSnapshot } from '../ride/controller';
import { createRecorder } from '../recording/csv';
import type { RawLocation, RawMotion } from '../sensors/adapter';

const PREFIX = 'collector-ui-test:';
const REQUESTS = `${PREFIX}requests`;
const OUTCOME = `${PREFIX}outcome`;
type Outcome = 'accept' | 'unknown' | '409' | '422';
type Request = { path: string; body: string; ids: string[] };

let motionCallback: ((raw: RawMotion) => void) | null = null;
let locationCallback: ((raw: RawLocation) => void) | null = null;
let clock = 1_760_000_000_000;
let sensorAvailable = true;
let motionAllowed = true;
let locationAllowed = true;
let activeTimers = new Set<ReturnType<typeof setInterval>>();

const platform: Platform = {
  now: () => clock,
  uuid: () => Crypto.randomUUID(),
  motionAvailable: async () => sensorAvailable,
  requestMotionPermission: async () => motionAllowed,
  requestLocationPermission: async () => locationAllowed,
  watchMotion: (_, callback) => { motionCallback = callback; return { remove: () => { motionCallback = null; } }; },
  watchLocation: async callback => { locationCallback = callback; return { remove: () => { locationCallback = null; } }; },
  keepAwake: () => undefined,
  setInterval: (callback, ms) => { const timer = setInterval(callback, ms); activeTimers.add(timer); return timer; },
  clearInterval: handle => { const timer = handle as ReturnType<typeof setInterval>; clearInterval(timer); activeTimers.delete(timer); },
};

const storage = {
  getItem: (key: string) => AsyncStorage.getItem(`${PREFIX}${key}`),
  setItem: (key: string, value: string) => AsyncStorage.setItem(`${PREFIX}${key}`, value),
};

async function send(batch: Batch) {
  const previous = JSON.parse((await AsyncStorage.getItem(REQUESTS)) ?? '[]') as Request[];
  const body = JSON.parse(batch.payload) as { events?: { id: string }[]; points?: { id: string }[] };
  const ids = (body.events ?? body.points ?? []).map(item => item.id);
  previous.push({ path: batch.kind === 'events' ? '/v1/events' : `/v1/rides/${batch.rideId}/points`, body: batch.payload, ids });
  await AsyncStorage.setItem(REQUESTS, JSON.stringify(previous));
  const outcome = ((await AsyncStorage.getItem(OUTCOME)) ?? 'accept') as Outcome;
  if (outcome === 'unknown') return new Promise<never>(() => undefined);
  if (outcome === '409' || outcome === '422') throw Object.assign(new Error(`Observation API ${outcome}`), { permanent: true });
  const earlier = previous.slice(0, -1).flatMap(request => request.ids);
  const duplicates = ids.filter(id => earlier.includes(id)).length;
  return { accepted: ids.length - duplicates, duplicates };
}

export function createTestCollector(listeners: { onRide(snapshot: RideSnapshot): void; onQueue(stats: QueueStats): void }) {
  const queue = createUploadQueue({ storage, send, now: () => clock, random: () => 0.5, uuid: () => Crypto.randomUUID(), onChange: listeners.onQueue });
  const recorder = createRecorder({ write: async (directory, name, contents) => {
    await AsyncStorage.setItem(`${PREFIX}recordings:${directory}/${name}`, contents);
  } });
  const controller = createRideController({ platform, queue, recorder, onChange: listeners.onRide });
  return { controller, queue };
}

export const testControls = {
  setSensorAvailable(value: boolean) { sensorAvailable = value; },
  setMotionAllowed(value: boolean) { motionAllowed = value; },
  setLocationAllowed(value: boolean) { locationAllowed = value; },
  async setOutcome(value: Outcome) { await AsyncStorage.setItem(OUTCOME, value); },
  async requests(): Promise<Request[]> { return JSON.parse((await AsyncStorage.getItem(REQUESTS)) ?? '[]') as Request[]; },
  async reset() {
    for (const key of await AsyncStorage.getAllKeys()) if (key.startsWith(PREFIX)) await AsyncStorage.removeItem(key);
    for (const timer of activeTimers) clearInterval(timer);
    activeTimers = new Set();
    motionCallback = null; locationCallback = null;
    sensorAvailable = motionAllowed = locationAllowed = true;
    clock = 1_760_000_000_000;
  },
  demoJerk() {
    if (!motionCallback) return;
    for (let i = 0; i < 300; i++) {
      clock += 20;
      const x = i >= 100 && i < 130 ? 0.7 * 9.80665 : 0;
      motionCallback({ acceleration: { x, y: 0, z: 0 }, accelerationIncludingGravity: { x, y: 0, z: 9.80665 }, interval: 20 });
    }
  },
  locationAvailable() { return locationCallback !== null; },
};
