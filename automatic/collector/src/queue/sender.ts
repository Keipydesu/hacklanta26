/** HTTP transport for the separate observation API. Never holds a product publication credential. */
import type { components } from '../api/schema';
import type { Batch } from './store';

export type IngestReceipt = components['schemas']['IngestReceipt'];
export const REQUEST_TIMEOUT_MS = 15_000;

export class TransportError extends Error {
  constructor(message: string, readonly status?: number, readonly retryAfterSeconds?: number) { super(message); }
  /**
   * 409/422 and other 4xx reject the whole batch and will not succeed on resend. Timeouts (408),
   * rate limits (429), 5xx and network failures have an unknown or temporary outcome and are
   * retried with the identical body.
   */
  get permanent(): boolean {
    return this.status !== undefined && this.status >= 400 && this.status < 500 && this.status !== 408 && this.status !== 429;
  }
}

export const batchPath = (batch: Pick<Batch, 'kind' | 'rideId'>): string =>
  batch.kind === 'events' ? '/v1/events' : `/v1/rides/${batch.rideId}/points`;

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{
  ok: boolean; status: number; headers: { get(name: string): string | null }; text(): Promise<string>; json(): Promise<unknown>;
}>;

export function createTransport(baseUrl: string, fetchImpl: FetchLike, timeoutMs = REQUEST_TIMEOUT_MS) {
  const root = baseUrl.replace(/\/$/, '');
  return async function send(batch: Batch): Promise<IngestReceipt> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let response;
      try {
        response = await fetchImpl(`${root}${batchPath(batch)}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: batch.payload, signal: controller.signal,
        });
      } catch (e) {
        throw new TransportError(`Network error: ${String(e)}`);
      }
      if (!response.ok) {
        const header = response.headers.get('Retry-After');
        const retryAfter = header ? Number(header) : NaN;
        const detail = (await response.text().catch(() => '')).slice(0, 300);
        throw new TransportError(`Observation API ${response.status}: ${detail}`, response.status, Number.isFinite(retryAfter) && retryAfter >= 0 ? retryAfter : undefined);
      }
      const receipt = (await response.json()) as IngestReceipt;
      if (typeof receipt?.accepted !== 'number' || typeof receipt?.duplicates !== 'number') throw new TransportError('Observation API returned an unexpected receipt');
      return receipt;
    } finally { clearTimeout(timer); }
  };
}
