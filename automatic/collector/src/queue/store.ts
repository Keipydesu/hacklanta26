/**
 * Durable upload queue for already-trimmed observations.
 *
 * Only privacy-eligible observations may be enqueued. Each batch is serialized once, persisted
 * before any network I/O and resent byte-for-byte, so a lost response or an app restart is safe:
 * the observation API counts identical UUIDs as duplicates.
 */
import type { components } from '../api/schema';

export type ObservationEvent = components['schemas']['ObservationEvent'];
export type ObservationPoint = components['schemas']['ObservationPoint'];
export type IngestReceipt = components['schemas']['IngestReceipt'];
export type BatchState = 'queued' | 'sending' | 'failed';
export interface Batch {
  id: string;
  kind: 'events' | 'points';
  /** Points only: the ride UUID is part of the request path and of retry identity. */
  rideId?: string;
  /** Exact JSON request body, frozen at enqueue time. */
  payload: string;
  count: number;
  state: BatchState;
  attempts: number;
  nextAttemptAt: number;
  error?: string;
  /** false after a definitive rejection (409/422...). Exhausted retries stay true: outcome unknown. */
  retryable: boolean;
}
export interface Storage { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<void> }
export interface QueueDeps {
  storage: Storage;
  send(batch: Batch): Promise<IngestReceipt>;
  now(): number;
  random(): number;
  uuid(): string;
  onChange?(stats: QueueStats): void;
}
export interface QueueStats {
  batches: number; pendingObservations: number; failedBatches: number;
  /** Totals since install, as acknowledged by the observation API. */
  accepted: number; duplicates: number; full: boolean;
}

export const STORAGE_KEY = 'observation-upload-queue';
const VERSION = 1;
export const MAX_EVENTS_PER_BATCH = 500;
export const MAX_POINTS_PER_BATCH = 2000;
export const MAX_ATTEMPTS = 8;
/** Roughly 5.5 hours of 1 Hz points. When reached, collection must pause rather than pretend. */
export const MAX_PENDING_OBSERVATIONS = 20_000;

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
export const backoffMs = (attempts: number, random: number) => Math.min(120_000, 1000 * 2 ** (attempts - 1)) * (0.5 + random / 2);
const isPermanent = (error: unknown) => (error as { permanent?: boolean } | null)?.permanent === true;
const retryAfterMs = (error: unknown) => {
  const seconds = (error as { retryAfterSeconds?: number } | null)?.retryAfterSeconds;
  return typeof seconds === 'number' && seconds >= 0 ? Math.min(seconds, 600) * 1000 : undefined;
};

export class QueueFullError extends Error {
  constructor() { super('Upload queue is full. Collection is paused until pending observations are delivered.'); }
}

export function createUploadQueue(deps: QueueDeps) {
  let items: Batch[] = [];
  let totals = { accepted: 0, duplicates: 0 };
  let loadError: string | undefined;
  let writes: Promise<void> = Promise.resolve();
  let draining: Promise<void> | undefined;
  let again = false;

  const pending = () => items.reduce((n, b) => n + b.count, 0);
  const stats = (): QueueStats => ({
    batches: items.length, pendingObservations: pending(), failedBatches: items.filter(b => b.state === 'failed').length,
    accepted: totals.accepted, duplicates: totals.duplicates, full: pending() >= MAX_PENDING_OBSERVATIONS,
  });
  const emit = () => deps.onChange?.(stats());
  // A send in flight has an unknown outcome after a restart, so it is stored as queued.
  const serialize = () => JSON.stringify({ version: VERSION, totals, items: items.map(b => (b.state === 'sending' ? { ...b, state: 'queued' } : b)) });
  function persist(): Promise<void> {
    const write = writes.then(() => deps.storage.setItem(STORAGE_KEY, serialize()));
    writes = write.catch(() => undefined);
    return write;
  }

  async function load(): Promise<void> {
    const raw = await deps.storage.getItem(STORAGE_KEY);
    if (raw === null) { items = []; emit(); return; }
    try {
      const data = JSON.parse(raw);
      if (data?.version !== VERSION || !Array.isArray(data.items)) throw new Error(`unsupported queue version ${data?.version}`);
      items = (data.items as Batch[]).map(b => (b.state === 'sending' ? { ...b, state: 'queued' as const } : b));
      totals = { accepted: Number(data.totals?.accepted) || 0, duplicates: Number(data.totals?.duplicates) || 0 };
    } catch (e) {
      // Keep the unreadable data instead of overwriting it with an empty queue.
      loadError = `Saved uploads could not be read: ${String(e)}`;
      await deps.storage.setItem(`${STORAGE_KEY}.unreadable`, raw);
      items = [];
    }
    emit();
  }

  /** Persist new batches before any send. If storage fails nothing is queued and this throws. */
  async function add(batches: Batch[]): Promise<void> {
    if (!batches.length) return;
    if (pending() + batches.reduce((n, b) => n + b.count, 0) > MAX_PENDING_OBSERVATIONS) throw new QueueFullError();
    const before = items;
    items = [...items, ...batches];
    try { await persist(); } catch (e) { items = before; throw e; }
    emit();
  }
  const batch = (kind: Batch['kind'], payload: string, count: number, rideId?: string): Batch =>
    ({ id: deps.uuid(), kind, rideId, payload, count, state: 'queued', attempts: 0, nextAttemptAt: deps.now(), retryable: true });

  /** Events carry their own ride UUID; batches are capped at 500. */
  const enqueueEvents = (events: readonly ObservationEvent[]) =>
    add(chunk(events, MAX_EVENTS_PER_BATCH).map(part => batch('events', JSON.stringify({ events: part }), part.length)));
  /** Points are per ride; batches are capped at 2000. */
  const enqueuePoints = (rideId: string, points: readonly ObservationPoint[]) =>
    add(chunk(points, MAX_POINTS_PER_BATCH).map(part => batch('points', JSON.stringify({ points: part }), part.length, rideId)));

  async function sendOne(item: Batch): Promise<void> {
    item.state = 'sending'; item.attempts += 1; emit();
    try {
      const receipt = await deps.send(item);
      // Accepted plus duplicates acknowledges the complete batch, whichever way it splits.
      totals = { accepted: totals.accepted + receipt.accepted, duplicates: totals.duplicates + receipt.duplicates };
      items = items.filter(b => b.id !== item.id);
    } catch (e) {
      item.error = String(e);
      if (isPermanent(e)) { item.state = 'failed'; item.retryable = false; }
      else if (item.attempts >= MAX_ATTEMPTS) { item.state = 'failed'; item.retryable = true; }
      else { item.state = 'queued'; item.nextAttemptAt = deps.now() + (retryAfterMs(e) ?? backoffMs(item.attempts, deps.random())); }
    }
    // Losing this write is safe: the same body is idempotent on the server.
    await persist().catch(() => undefined);
    emit();
  }

  /** Single flight: concurrent triggers collapse into one more pass after the current one. */
  function drain(): Promise<void> {
    if (draining) { again = true; return draining; }
    draining = (async () => {
      do {
        again = false;
        for (const item of items.filter(b => b.state === 'queued' && b.nextAttemptAt <= deps.now())) await sendOne(item);
      } while (again);
    })().finally(() => { draining = undefined; });
    return draining;
  }

  /** Explicit retry of the same bytes after the automatic attempts ran out. */
  async function retry(id: string): Promise<void> {
    const item = items.find(b => b.id === id);
    if (!item || item.state !== 'failed' || !item.retryable) return;
    item.state = 'queued'; item.attempts = 0; item.nextAttemptAt = deps.now(); item.error = undefined;
    await persist().catch(() => undefined);
    emit();
    await drain();
  }

  /** Drop a batch the server definitively rejected. Unknown-outcome batches must be retried instead. */
  async function discardRejected(id: string): Promise<void> {
    const item = items.find(b => b.id === id);
    if (!item || item.state !== 'failed' || item.retryable) return;
    items = items.filter(b => b.id !== id);
    await persist().catch(() => undefined);
    emit();
  }

  const nextDueAt = () => items.filter(b => b.state === 'queued').reduce<number | undefined>((t, b) => (t === undefined ? b.nextAttemptAt : Math.min(t, b.nextAttemptAt)), undefined);
  return { load, enqueueEvents, enqueuePoints, drain, retry, discardRejected, nextDueAt, stats, snapshot: () => items.map(b => ({ ...b })), loadError: () => loadError };
}
export type UploadQueue = ReturnType<typeof createUploadQueue>;
