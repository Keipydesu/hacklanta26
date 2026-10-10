import type { LocateResult } from '../location/foreground';
import { freezeReport, type Draft } from './queue';

export const REPORT_LOCATION_MAX_AGE_MS = 60_000;
export type ReportLocationState =
  | { status: 'idle' | 'locating' | 'denied' | 'unavailable' }
  | { status: 'ready'; lat: number; lon: number; obtainedAt: number };

/** Draft-only location. Persisted reports never pass through this controller on retry. */
export function createReportLocation(deps: {
  locate(): Promise<LocateResult>;
  now(): number;
  onChange(state: ReportLocationState): void;
}) {
  let state: ReportLocationState = { status: 'idle' };
  let generation = 0;
  const update = (next: ReportLocationState) => { state = next; deps.onChange(next); };
  function clear(status: 'idle' | 'unavailable' = 'idle') { generation++; update({ status }); }
  function ready() {
    return state.status === 'ready' && deps.now() - state.obtainedAt >= 0
      && deps.now() - state.obtainedAt < REPORT_LOCATION_MAX_AGE_MS;
  }
  async function request() {
    if (state.status === 'locating') return;
    const current = ++generation;
    update({ status: 'locating' });
    let result: LocateResult;
    try { result = await deps.locate(); }
    catch { result = { ok: false, reason: 'unavailable' }; }
    if (current !== generation) return;
    if (result.ok && Number.isFinite(result.lat) && Math.abs(result.lat) <= 90
      && Number.isFinite(result.lon) && Math.abs(result.lon) <= 180) {
      update({ status: 'ready', lat: result.lat, lon: result.lon, obtainedAt: deps.now() });
    } else update({ status: result.ok ? 'unavailable' : result.reason });
  }
  function freeze(draft: Omit<Draft, 'lat' | 'lon'>, uuid: string) {
    if (!ready() || state.status !== 'ready') throw new Error('Current device location is required. Retry location before submitting.');
    return freezeReport({ ...draft, lat: state.lat, lon: state.lon }, deps.now(), uuid);
  }
  return { request, clear, ready, freeze };
}
