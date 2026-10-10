/**
 * Report screen rules (issue #40): no preselected category, Submit appears only after a category is
 * chosen, and the device location is requested automatically when the reporting flow opens.
 */
import type { ReportLocationState } from './location';

type Status = ReportLocationState['status'];

/** Entering Report (or returning to it) asks for a fresh fix unless one is ready or in progress. */
export const shouldLocateOnEnter = (status: Status) => status === 'idle' || status === 'expired';

/** The Submit action is hidden entirely until the rider picks a category. */
export const showSubmit = (kind: string | null) => kind !== null;

export const canSubmit = (s: { kind: string | null; locationReady: boolean; fixtureMode: boolean; submitting: boolean }) =>
  s.kind !== null && s.locationReady && !s.fixtureMode && !s.submitting;

/**
 * A location control whenever the rider would otherwise be stuck without a fresh fix: retry after a
 * failure or expiry, or start one when none is in progress (e.g. right after a report was queued).
 * Not in fixture mode, where location is never requested.
 */
export function locationAction(status: Status, fixtureMode = false): string | null {
  if (fixtureMode) return null;
  if (status === 'denied' || status === 'unavailable' || status === 'expired') return 'Retry location';
  return status === 'idle' ? 'Use my location' : null;
}
