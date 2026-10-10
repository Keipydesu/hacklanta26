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

/** A location control only when the rider has something to do: retry after a failure or expiry. */
export const locationAction = (status: Status): string | null =>
  status === 'denied' || status === 'unavailable' || status === 'expired' ? 'Retry location' : null;
