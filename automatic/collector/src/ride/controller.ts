/**
 * Ride lifecycle: explicit opt-in → permissions → sensors → detector → privacy buffer → durable
 * upload queue. Platform access is injected so the whole flow runs in Node tests.
 *
 * Nothing reaches the upload queue until it is privacy-eligible. Raw motion goes only to the
 * optional local recorder.
 */
import { createDetector, type DetectedEvent } from '../../../detector/index';
import { PrivacyBuffer } from '../privacy/trim';
import { createMotionNormalizer, normalizeLocation, NOMINAL_MOTION_INTERVAL_MS, type RawLocation, type RawMotion } from '../sensors/adapter';
import type { ObservationEvent, ObservationPoint, QueueStats } from '../queue/store';
import type { Recorder } from '../recording/csv';

export type Mode = 'device' | 'demo';
export type Phase = 'idle' | 'starting' | 'collecting' | 'stopping';
export interface Subscription { remove(): void }
export interface Platform {
  now(): number;
  uuid(): string;
  motionAvailable(): Promise<boolean>;
  requestMotionPermission(): Promise<boolean>;
  requestLocationPermission(): Promise<boolean>;
  watchMotion(intervalMs: number, onSample: (raw: RawMotion) => void): Subscription;
  watchLocation(onFix: (raw: RawLocation) => void): Promise<Subscription>;
  keepAwake(on: boolean): void;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}
export interface QueuePort {
  enqueueEvents(events: readonly ObservationEvent[]): Promise<void>;
  enqueuePoints(rideId: string, points: readonly ObservationPoint[]): Promise<void>;
  drain(): Promise<void>;
  load(): Promise<void>;
  stats(): QueueStats;
}
export interface RideSnapshot {
  phase: Phase;
  mode: Mode | null;
  rideId: string | null;
  recording: boolean;
  /** Why the last start failed or the last ride ended, in words a rider can act on. */
  message: string | null;
  motionSamples: number;
  motionHz: number | null;
  fixes: number;
  travelledM: number;
  detected: number;
  /** Events/points that passed the privacy buffer and were persisted to the upload queue. */
  queuedEvents: number;
  queuedPoints: number;
  /** Still inside the buffer; discarded if the ride ends before they become eligible. */
  heldEvents: number;
  heldPoints: number;
  /** Removed by the first/last 100 m rule. */
  trimmedEvents: number;
  trimmedPoints: number;
}
export interface StartOptions { mode: Mode; consent: boolean; record?: boolean }
export interface ControllerDeps {
  platform: Platform;
  queue: QueuePort;
  recorder?: Recorder;
  /** Fixed campus coordinates used only by the indoor demo. */
  demoLocation?: { lat: number; lon: number };
  onChange?(snapshot: RideSnapshot): void;
}

export const FLUSH_INTERVAL_MS = 10_000;
export const DEMO_LOCATION = { lat: 33.7531, lon: -84.3853 };
/** Synthetic fix values for the indoor demo. They are not measurements. */
export const DEMO_FIX = { speed_mps: 0, accuracy_m: 5 };

const blank = (): Omit<RideSnapshot, 'phase' | 'mode' | 'rideId' | 'recording' | 'message'> => ({
  motionSamples: 0, motionHz: null, fixes: 0, travelledM: 0, detected: 0, queuedEvents: 0, queuedPoints: 0,
  heldEvents: 0, heldPoints: 0, trimmedEvents: 0, trimmedPoints: 0,
});

export function createRideController(deps: ControllerDeps) {
  const { platform, queue } = deps;
  const demoLocation = deps.demoLocation ?? DEMO_LOCATION;
  const normalizer = createMotionNormalizer();
  let phase: Phase = 'idle';
  let mode: Mode | null = null;
  let rideId: string | null = null;
  let recording = false;
  let message: string | null = null;
  let counters = blank();
  let detector: ReturnType<typeof createDetector> | null = null;
  let privacy: PrivacyBuffer<ObservationPoint, ObservationEvent> | null = null;
  let subscriptions: Subscription[] = [];
  let flushTimer: unknown;
  let readyEvents: ObservationEvent[] = [];
  let readyPoints: ObservationPoint[] = [];
  let flushing: Promise<void> = Promise.resolve();
  let firstMotionMs: number | null = null;
  let lastMotionMs: number | null = null;
  let nextDemoFixMs: number | null = null;
  let generation = 0;
  let saveError: string | null = null;

  const snapshot = (): RideSnapshot => {
    const held = privacy?.held ?? { points: 0, events: 0 };
    const trimmed = privacy?.droppedCounts ?? { points: counters.trimmedPoints, events: counters.trimmedEvents };
    return {
      phase, mode, rideId, recording, message, ...counters,
      travelledM: privacy ? privacy.travelledM : counters.travelledM,
      heldEvents: held.events, heldPoints: held.points, trimmedEvents: trimmed.events, trimmedPoints: trimmed.points,
    };
  };
  const emit = () => deps.onChange?.(snapshot());
  const source = () => (mode === 'demo' ? 'simulated' : 'device') as ObservationEvent['source'];
  const iso = (tMs: number) => new Date(tMs).toISOString();

  function onDetected(event: DetectedEvent): void {
    if (phase !== 'collecting' || !rideId) return;
    counters.detected++;
    emit(); // show detections immediately, including in the indoor demo (no GPS to drive updates)
    // UUID, ride and source are assigned once here and never change across retries.
    const observation: ObservationEvent = {
      id: platform.uuid(), ride_id: rideId, type: event.type, ts: iso(event.t_ms), lat: event.lat, lon: event.lon,
      accuracy_m: event.accuracy_m, speed_before_mps: event.speed_before_mps, speed_after_mps: event.speed_after_mps,
      peak_g: event.peak_g, duration_ms: event.duration_ms, source: source(),
    };
    // The demo uses fixed synthetic coordinates, so there is no real endpoint to protect.
    if (mode === 'demo') readyEvents.push(observation);
    else privacy?.pushEvent(event.t_ms, observation);
  }

  function onMotion(raw: RawMotion): void {
    if (phase !== 'collecting' || !detector) return;
    const sample = normalizer.normalize(raw, platform.now());
    if (!sample) return;
    counters.motionSamples++;
    firstMotionMs ??= sample.t_ms;
    lastMotionMs = sample.t_ms;
    if (counters.motionSamples > 1 && lastMotionMs > firstMotionMs) {
      counters.motionHz = Math.round(((counters.motionSamples - 1) * 10_000) / (lastMotionMs - firstMotionMs)) / 10;
    }
    if (mode === 'demo') {
      // One synthetic fix per second on the motion clock, pushed before the sample it ties with.
      nextDemoFixMs ??= sample.t_ms;
      while (sample.t_ms >= nextDemoFixMs) {
        const fix = { t_ms: nextDemoFixMs, lat: demoLocation.lat, lon: demoLocation.lon, ...DEMO_FIX };
        counters.fixes++;
        deps.recorder?.location(fix);
        detector.pushLocation(fix);
        nextDemoFixMs += 1000;
      }
    }
    deps.recorder?.motion(sample);
    detector.pushMotion(sample);
    if (mode === 'demo' && counters.motionSamples % 50 === 0) emit(); // ~1 Hz stats refresh without GPS
  }

  function onLocation(raw: RawLocation): void {
    if (phase !== 'collecting' || !detector || !privacy || !rideId) return;
    const fix = normalizeLocation(raw);
    if (!fix) return;
    counters.fixes++;
    deps.recorder?.location(fix);
    // Only a fix with measured speed and accuracy can become a contract-valid point.
    const point: ObservationPoint | undefined = fix.speed_mps !== null && fix.accuracy_m !== null
      ? { id: platform.uuid(), ts: iso(fix.t_ms), lat: fix.lat, lon: fix.lon, speed_mps: fix.speed_mps, accuracy_m: fix.accuracy_m, source: source() }
      : undefined;
    const released = privacy.pushFix(fix, point);
    readyPoints.push(...released.points);
    readyEvents.push(...released.events);
    detector.pushLocation(fix);
    emit();
  }

  /** Persist eligible observations, then try to send. Serialized so batches never interleave. */
  function flush(): Promise<void> {
    const ride = rideId;
    flushing = flushing.then(async () => {
      const events = readyEvents.splice(0), points = readyPoints.splice(0);
      if (!ride || (!events.length && !points.length)) return;
      try {
        if (events.length) { await queue.enqueueEvents(events); counters.queuedEvents += events.length; }
        if (points.length) { await queue.enqueuePoints(ride, points); counters.queuedPoints += points.length; }
      } catch (e) {
        // Not saved means not queued: say so and stop collecting rather than keep losing data.
        saveError = `Observations could not be saved for upload: ${e instanceof Error ? e.message : String(e)}`;
        void stopRide(`Stopped. ${saveError}`);
        return;
      }
      emit();
      void queue.drain();
    });
    return flushing;
  }

  function teardown(): void {
    for (const subscription of subscriptions.splice(0)) { try { subscription.remove(); } catch { /* already gone */ } }
    if (flushTimer !== undefined) { platform.clearInterval(flushTimer); flushTimer = undefined; }
    platform.keepAwake(false);
  }

  async function startRide(options: StartOptions): Promise<boolean> {
    if (phase !== 'idle') return false;
    const mine = ++generation;
    const fail = (why: string) => {
      if (generation !== mine) return false; // this start was cancelled (or superseded); don't clobber the newer state
      teardown(); phase = 'idle'; mode = null; rideId = null; recording = false; message = why; emit(); return false;
    };
    if (!options.consent) return fail('Collection is opt-in. Confirm before starting.');
    if (queue.stats().full) return fail('Upload queue is full. Deliver pending observations before collecting more.');
    phase = 'starting'; mode = options.mode; message = null; saveError = null; counters = blank();
    readyEvents = []; readyPoints = []; firstMotionMs = lastMotionMs = nextDemoFixMs = null;
    emit();
    try {
      const motionOk = await platform.motionAvailable();
      if (mine !== generation) return false;
      if (!motionOk) return fail('Motion sensors are not available on this device.');
      const motionAllowed = await platform.requestMotionPermission();
      if (mine !== generation) return false;
      if (!motionAllowed) return fail('Motion permission was denied. Nothing is being collected.');
      if (options.mode === 'device') {
        const locationAllowed = await platform.requestLocationPermission();
        if (mine !== generation) return false;
        if (!locationAllowed) return fail('Location permission was denied. Nothing is being collected.');
      }
      if (mine !== generation || phase !== 'starting') return false;
      rideId = platform.uuid(); // fresh random UUID per ride; no account or device ID
      normalizer.reset();
      detector = createDetector({ demoMode: options.mode === 'demo' });
      privacy = new PrivacyBuffer();
      subscriptions.push({ remove: detector.onEvent(onDetected) });
      recording = !!(options.record && deps.recorder);
      if (recording) deps.recorder!.start(rideId, platform.now(), options.mode === 'demo' ? 'simulated' : 'device');
      phase = 'collecting';
      subscriptions.push(platform.watchMotion(NOMINAL_MOTION_INTERVAL_MS, onMotion));
      if (options.mode === 'device') {
        const watching = await platform.watchLocation(onLocation);
        if (mine !== generation || phase !== 'collecting') { watching.remove(); return false; }
        subscriptions.push(watching);
      }
      platform.keepAwake(true);
      flushTimer = platform.setInterval(() => { void flush(); }, FLUSH_INTERVAL_MS);
      emit();
      return true;
    } catch (e) {
      if (deps.recorder?.active) await deps.recorder.stop();
      detector = null; privacy = null;
      return fail(`Could not start collection: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /** Safe to call twice. The trailing privacy zone and any unfinished detection are discarded. */
  async function stopRide(reason?: string): Promise<void> {
    if (phase === 'starting') {
      // Leaving the foreground (or unmounting) while a permission prompt is open must cancel the start,
      // not let it begin collecting afterwards. Bumping generation makes startRide bail at its next check.
      generation++;
      teardown();
      phase = 'idle'; mode = null; rideId = null; recording = false;
      message = reason ?? 'Start cancelled. Nothing is being collected.';
      emit();
      return;
    }
    if (phase !== 'collecting') return;
    phase = 'stopping'; generation++;
    emit();
    teardown();
    detector?.reset();
    detector = null;
    const buffer = privacy;
    if (buffer) {
      counters.travelledM = buffer.travelledM;
      buffer.finish();
      const dropped = buffer.droppedCounts;
      counters.trimmedEvents = dropped.events; counters.trimmedPoints = dropped.points;
    }
    privacy = null;
    await flush();
    if (deps.recorder?.active) await deps.recorder.stop();
    const recorderError = deps.recorder?.error;
    phase = 'idle'; recording = false;
    message = reason ?? (saveError ? `Ride stopped. ${saveError}` : recorderError ? `Ride stopped. ${recorderError}` : 'Ride stopped. The last 100 m was discarded.');
    emit();
  }

  return {
    startRide,
    stopRide: () => stopRide(),
    /** The app left the foreground: no background tracking, and the true end point is now unknown. */
    onBackground: () => stopRide('Stopped: the app left the foreground. Nothing after the last eligible point was kept.'),
    /** Send what earlier rides already queued. Never restarts sensing or creates a ride. */
    async resumeUploads(): Promise<void> { await queue.load(); await queue.drain(); },
    flush,
    snapshot,
  };
}
export type RideController = ReturnType<typeof createRideController>;
