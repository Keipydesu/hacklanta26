import { jitteredBackoffMs } from '../retry/backoff';
import type { components } from '../api/schema';

export type Report = components['schemas']['ManualReport'];
export type Receipt = components['schemas']['ReportReceipt'];
export type SubmissionState = 'queued' | 'sending' | 'submitted' | 'failed';
export interface Submission {
  id: string;
  body: Report; // frozen at submit time; never edited, so every retry resends identical bytes
  state: SubmissionState;
  attempts: number;
  nextAttemptAt: number;
  error?: string;
  // false after a definitive rejection (409/422...). Exhausted retries stay true: the outcome is unknown.
  retryable: boolean;
  receipt?: Receipt;
}
export interface Storage { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<void> }
export interface QueueDeps {
  storage: Storage;
  send(body: Report): Promise<Receipt>;
  now(): number;
  random(): number;
  onChange?(submissions: Submission[]): void;
  onReceipt?(submission: Submission): void;
}
export const STORAGE_KEY = 'report-queue';
const VERSION = 1;
export const MAX_ATTEMPTS = 6;
const MAX_DESCRIPTION = 280;

export interface Draft { kind: Report['kind']; lat: number; lon: number; description?: string }

/** Validates once and captures the id and observation time; later retries never recompute them. */
export function freezeReport(draft: Draft, now: number, uuid: string): Report {
  if (!Number.isFinite(draft.lat) || Math.abs(draft.lat) > 90 || !Number.isFinite(draft.lon) || Math.abs(draft.lon) > 180) {
    throw new Error('Choose a valid location for the report.');
  }
  const description = draft.description?.trim();
  if (description && description.length > MAX_DESCRIPTION) throw new Error(`Description is limited to ${MAX_DESCRIPTION} characters.`);
  return {
    id: uuid, kind: draft.kind, lat: draft.lat, lon: draft.lon,
    observed_at: new Date(now).toISOString(),
    ...(description ? { description } : {}),
  };
}

/** Permanent API rejections (see ApiError.permanent) will not succeed on resend. */
const isPermanent = (error: unknown) => (error as { permanent?: boolean } | null)?.permanent === true;
const retryAfterMs = (error: unknown) => {
  const seconds = (error as { retryAfterSeconds?: number } | null)?.retryAfterSeconds;
  return typeof seconds === 'number' && seconds >= 0 ? seconds * 1000 : undefined;
};
export const backoffMs = (attempts: number, random: number) => jitteredBackoffMs(attempts - 1, random, 60_000);

export function createReportQueue(deps: QueueDeps) {
  let items: Submission[] = [];
  let loadError: string | undefined;
  let mutations: Promise<void> = Promise.resolve();
  let loading: Promise<void> | undefined;
  let draining: Promise<void> | undefined;
  let again = false;

  const emit = () => deps.onChange?.(items.map(item => ({ ...item })));
  // Serialize hydration and durable mutations, but never hold this lock across HTTP.
  function exclusive<T>(action: () => Promise<T> | T): Promise<T> {
    const result = mutations.then(action);
    mutations = result.then(() => undefined, () => undefined);
    return result;
  }
  // A send in flight has unknown outcome after a restart, so it is stored as queued.
  function persist(snapshot = items): Promise<void> {
    return deps.storage.setItem(STORAGE_KEY, JSON.stringify({ version: VERSION,
      items: snapshot.map(i => i.state === 'sending' ? { ...i, state: 'queued' } : i),
    }));
  }
  const find = (id: string) => items.find(i => i.id === id);

  function load(): Promise<void> {
    if (!loading) loading = exclusive(hydrate).catch(error => { loading = undefined; throw error; });
    return loading;
  }

  async function hydrate() {
    const raw = await deps.storage.getItem(STORAGE_KEY);
    if (raw === null) { items = []; emit(); return; }
    try {
      const data = JSON.parse(raw);
      if (data?.version !== VERSION || !Array.isArray(data.items)) throw new Error(`unsupported queue version ${data?.version}`);
      // Accepted work is done; everything else resumes with its original id and body.
      items = (data.items as Submission[]).filter(i => i.state !== 'submitted').map(i => i.state === 'sending' ? { ...i, state: 'queued' as const } : i);
    } catch (e) {
      // Keep the unreadable data instead of overwriting it with an empty queue.
      loadError = `Saved reports could not be read: ${String(e)}`;
      await deps.storage.setItem(`${STORAGE_KEY}.unreadable`, raw);
      items = [];
    }
    emit();
  }

  /** Persists before any network I/O. If storage fails this throws and nothing is queued. */
  async function enqueue(body: Report): Promise<string> {
    await load();
    return exclusive(async () => {
      if (find(body.id)) return body.id;
      const next: Submission[] = [...items, { id: body.id, body, state: 'queued', attempts: 0, nextAttemptAt: deps.now(), retryable: true }];
      await persist(next);
      // Publish to the sender and UI only after the new report is durable.
      items = next;
      emit();
      return body.id;
    });
  }

  async function sendOne(item: Submission) {
    const ready = await exclusive(() => {
      if (!items.includes(item) || item.state !== 'queued' || item.nextAttemptAt > deps.now()) return false;
      item.state = 'sending'; item.attempts += 1; emit();
      return true;
    });
    if (!ready) return;
    let receipt: Receipt;
    try {
      receipt = await deps.send(item.body);
      if (receipt.report_id !== item.id) throw Object.assign(new Error('Server receipt did not match this report.'), { permanent: true });
    } catch (e) {
      await exclusive(async () => {
        item.error = String(e);
        if (isPermanent(e)) { item.state = 'failed'; item.retryable = false; }
        else if (item.attempts >= MAX_ATTEMPTS) { item.state = 'failed'; item.retryable = true; }
        else { item.state = 'queued'; item.nextAttemptAt = deps.now() + (retryAfterMs(e) ?? backoffMs(item.attempts, deps.random())); }
        await persist().catch(() => undefined);
        emit();
      });
      return;
    }
    await exclusive(async () => {
      item.state = 'submitted'; item.receipt = receipt; item.error = undefined;
      // Local persistence failure is safe: the same body is idempotent on the server.
      await persist().catch(() => undefined);
      deps.onReceipt?.({ ...item });
      emit();
    });
  }

  /** Single flight: concurrent triggers collapse into one more pass after the current one. */
  function drain(): Promise<void> {
    if (draining) { again = true; return draining; }
    draining = (async () => {
      await load();
      do {
        again = false;
        const due = await exclusive(() => items.filter(i => i.state === 'queued' && i.nextAttemptAt <= deps.now()));
        for (const item of due) await sendOne(item);
      } while (again);
    })().finally(() => { draining = undefined; });
    return draining;
  }

  /** Explicit user retry of the same body, e.g. after retries were exhausted. */
  async function retry(id: string) {
    await load();
    await exclusive(async () => {
      const item = find(id);
      if (!item || item.state !== 'failed' || !item.retryable) return;
      item.state = 'queued'; item.attempts = 0; item.nextAttemptAt = deps.now(); item.error = undefined;
      await persist().catch(() => undefined);
      emit();
    });
    await drain();
  }

  /** Remove finished or definitively rejected work. Unknown-outcome items must be retried first. */
  async function dismiss(id: string) {
    await load();
    await exclusive(async () => {
      const item = find(id);
      if (!item || item.state === 'sending' || item.state === 'queued' || (item.state === 'failed' && item.retryable)) return;
      items = items.filter(i => i.id !== id);
      await persist().catch(() => undefined);
      emit();
    });
  }

  const nextDueAt = () => items.filter(i => i.state === 'queued').reduce<number | undefined>((t, i) => t === undefined ? i.nextAttemptAt : Math.min(t, i.nextAttemptAt), undefined);
  return { load, enqueue, drain, retry, dismiss, nextDueAt, snapshot: () => items.map(i => ({ ...i })), loadError: () => loadError };
}
