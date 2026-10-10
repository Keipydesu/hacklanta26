import type { LocateResult } from '../location/foreground';
import { freezeReport, type Draft } from './queue';

export const REPORT_LOCATION_MAX_AGE_MS = 60_000;
export const REPORT_LOCATION_TIMEOUT_MS = 20_000;
export type ReportLocationState =
  | { status: 'idle' | 'locating' | 'denied' | 'unavailable' | 'expired' }
  | { status: 'ready'; lat: number; lon: number; obtainedAt: number };

/** Draft-only location. Persisted reports never pass through this controller on retry. */
export function createReportLocation(deps: {
  requestPermission(): Promise<boolean>;
  locate(): Promise<LocateResult>;
  enabled?: boolean;
  now(): number;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  onChange(state: ReportLocationState): void;
}) {
  let state: ReportLocationState = { status: 'idle' };
  let generation = 0;
  let expiryTimer: unknown;
  let cancelLookup: (() => void) | undefined;
  const update = (next: ReportLocationState) => {
    if (next.status !== 'ready' && next.status === state.status) return;
    state = next; deps.onChange(next);
  };
  function clear(status: 'idle' | 'unavailable' = 'idle') {
    generation++;
    cancelLookup?.(); cancelLookup = undefined;
    if (expiryTimer !== undefined) deps.clearTimer(expiryTimer);
    expiryTimer = undefined;
    update({ status });
  }
  function ready() {
    return state.status === 'ready' && deps.now() - state.obtainedAt >= 0
      && deps.now() - state.obtainedAt < REPORT_LOCATION_MAX_AGE_MS;
  }
  function expire() {
    if (state.status === 'ready' && !ready()) {
      if (expiryTimer !== undefined) deps.clearTimer(expiryTimer);
      expiryTimer = undefined;
      update({ status: 'expired' });
    }
  }
  async function request() {
    if (deps.enabled === false || state.status === 'locating') return;
    clear();
    const current = generation;
    update({ status: 'locating' });
    try {
      // Reading the OS permission dialog must not consume the position deadline.
      const granted = await deps.requestPermission();
      if (current !== generation) return;
      if (!granted) { update({ status: 'denied' }); return; }
      let deadline: unknown;
      const timeout = new Promise<LocateResult>(resolve => {
        cancelLookup = () => resolve({ ok: false, reason: 'unavailable' });
        deadline = deps.setTimer(cancelLookup, REPORT_LOCATION_TIMEOUT_MS);
      });
      let result: LocateResult;
      try { result = await Promise.race([deps.locate(), timeout]); }
      finally {
        deps.clearTimer(deadline);
        if (current === generation) cancelLookup = undefined;
      }
      if (current !== generation) return;
      if (result.ok && Number.isFinite(result.lat) && Math.abs(result.lat) <= 90
        && Number.isFinite(result.lon) && Math.abs(result.lon) <= 180) {
        const obtainedAt = result.timestamp ?? deps.now();
        if (!Number.isFinite(obtainedAt) || obtainedAt > deps.now()) {
          update({ status: 'unavailable' }); return;
        }
        update({ status: 'ready', lat: result.lat, lon: result.lon, obtainedAt });
        expire();
        if (ready()) expiryTimer = deps.setTimer(expire, REPORT_LOCATION_MAX_AGE_MS - (deps.now() - obtainedAt));
      } else update({ status: result.ok ? 'unavailable' : result.reason });
    } catch {
      if (current === generation) update({ status: 'unavailable' });
    }
  }
  function onAppState(appState: string) {
    // Android can background the app for its permission dialog. Preserve an in-flight
    // one-shot lookup; its position deadline and fix expiry still bound its lifetime.
    if (appState === 'background' && state.status !== 'locating') clear();
    if (appState === 'active') expire();
  }
  function freeze(draft: Omit<Draft, 'lat' | 'lon'>, uuid: string) {
    expire();
    if (state.status !== 'ready') throw new Error('Current device location is required. Retry location before submitting.');
    return freezeReport({ ...draft, lat: state.lat, lon: state.lon }, state.obtainedAt, uuid);
  }
  return { request, clear, ready, freeze, onAppState };
}
