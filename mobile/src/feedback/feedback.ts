/**
 * "Is this hazard still there?" answers. Separate from the report queue: one answer per hazard per
 * app session, sent immediately, shown as accepted only after the server's receipt. A failed send
 * can be retried with the identical body (same UUID), which the server treats as a duplicate.
 */
export type FeedbackResponse = 'still_there' | 'gone';
export type FeedbackBody = { id: string; response: FeedbackResponse };
export type FeedbackStatus = 'sending' | 'accepted' | 'failed';
export type FeedbackState = { body: FeedbackBody; status: FeedbackStatus; error?: string; retryable: boolean };
export type FeedbackDeps = {
  send(hazardId: string, body: FeedbackBody): Promise<unknown>;
  uuid(): string;
  onChange(states: Readonly<Record<string, FeedbackState>>): void;
  onAccepted?(hazardId: string): void;
};

const KIND_NAMES: Record<string, string> = { braking: 'hard-braking spot', surface: 'rough surface', abandoned: 'abandoned path' };
export const feedbackQuestion = (kind: string) => `Is this ${KIND_NAMES[kind] ?? kind} still there?`;

const isPermanent = (error: unknown) => (error as { permanent?: boolean } | null)?.permanent === true;

export function createFeedback(deps: FeedbackDeps) {
  let states: Record<string, FeedbackState> = {};
  const set = (hazardId: string, state: FeedbackState) => { states = { ...states, [hazardId]: state }; deps.onChange(states); };

  async function send(hazardId: string, body: FeedbackBody) {
    set(hazardId, { body, status: 'sending', retryable: false });
    try {
      await deps.send(hazardId, body);
      set(hazardId, { body, status: 'accepted', retryable: false });
      deps.onAccepted?.(hazardId);
    } catch (error) {
      set(hazardId, { body, status: 'failed', error: error instanceof Error ? error.message : String(error), retryable: !isPermanent(error) });
    }
  }

  return {
    states: () => states,
    /** Ignored while an answer for this hazard is sending, accepted, or failed-but-retryable. */
    respond(hazardId: string, response: FeedbackResponse): Promise<void> {
      const current = states[hazardId];
      if (current && (current.status !== 'failed' || current.retryable)) return Promise.resolve();
      return send(hazardId, { id: deps.uuid(), response });
    },
    /** Resend the identical body after a retryable failure. */
    retry(hazardId: string): Promise<void> {
      const current = states[hazardId];
      if (!current || current.status !== 'failed' || !current.retryable) return Promise.resolve();
      return send(hazardId, current.body);
    },
  };
}
export type Feedback = ReturnType<typeof createFeedback>;
