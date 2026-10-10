/**
 * Expo bindings for the ride controller, upload queue and recorder. This is the only module
 * (besides App.tsx) that touches native APIs; everything it wires together is tested in Node.
 *
 * No product publication credential exists anywhere in this app. The only remote endpoint is the
 * separate observation API.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import * as FileSystem from 'expo-file-system/legacy';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import * as Location from 'expo-location';
import { DeviceMotion } from 'expo-sensors';
import { createUploadQueue, type QueueStats } from './queue/store';
import { createTransport } from './queue/sender';
import { createRecorder, type FileSink } from './recording/csv';
import { createRideController, type Platform, type RideSnapshot } from './ride/controller';

export const automationUrl = process.env.EXPO_PUBLIC_AUTOMATION_API_URL?.replace(/\/$/, '');
const KEEP_AWAKE_TAG = 'campus-collector-ride';

const platform: Platform = {
  now: () => Date.now(),
  uuid: () => Crypto.randomUUID(),
  motionAvailable: () => DeviceMotion.isAvailableAsync(),
  requestMotionPermission: async () => (await DeviceMotion.requestPermissionsAsync()).granted,
  // Foreground only, requested when a device ride starts. No background location is ever asked for.
  requestLocationPermission: async () => (await Location.requestForegroundPermissionsAsync()).granted,
  watchMotion(intervalMs, onSample) {
    DeviceMotion.setUpdateInterval(intervalMs);
    return DeviceMotion.addListener(onSample);
  },
  watchLocation: onFix =>
    Location.watchPositionAsync({ accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1000, distanceInterval: 0 }, onFix),
  keepAwake(on) {
    if (on) void activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => undefined);
    else void deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => undefined);
  },
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: handle => clearInterval(handle as ReturnType<typeof setInterval>),
};

/** Recordings stay in the app's private document directory on this phone. */
export const recordingsDirectory = () => (FileSystem.documentDirectory ? `${FileSystem.documentDirectory}recordings/` : null);
const fileSink: FileSink = {
  async write(directory, name, contents) {
    const root = recordingsDirectory();
    if (!root) throw new Error('This device has no document directory for recordings.');
    const target = `${root}${directory}/`;
    await FileSystem.makeDirectoryAsync(target, { intermediates: true }).catch(() => undefined);
    await FileSystem.writeAsStringAsync(`${target}${name}`, contents);
  },
};

export function createCollector(listeners: { onRide(snapshot: RideSnapshot): void; onQueue(stats: QueueStats): void }) {
  const send = automationUrl
    ? createTransport(automationUrl, (url, init) => fetch(url, init))
    : async () => { throw new Error('Set EXPO_PUBLIC_AUTOMATION_API_URL to upload.'); };
  const queue = createUploadQueue({
    storage: AsyncStorage, send, now: () => Date.now(), random: () => Math.random(), uuid: () => Crypto.randomUUID(), onChange: listeners.onQueue,
  });
  // Without a configured URL observations stay queued on the phone instead of burning retries.
  const drain = automationUrl ? queue.drain : async () => undefined;
  const recorder = createRecorder(fileSink);
  const controller = createRideController({ platform, queue: { ...queue, drain }, recorder, onChange: listeners.onRide });
  return { controller, queue: { ...queue, drain } };
}
