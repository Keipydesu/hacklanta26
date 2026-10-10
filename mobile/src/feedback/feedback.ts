/**
 * "Is this hazard still there?" answers. Separate from the report queue: one answer per hazard per
 * app session, sent immediately, shown as accepted only after the server's receipt. A failed send
 * can be retried with the identical body (same UUID), which the server treats as a duplicate.
 */
export type FeedbackResponse = 'still_there' | 'gone';
export type FeedbackBody = { id: string; response: FeedbackResponse };
export type FeedbackStatus = 'sending' | 'accepted' | 'failed';
export type FeedbackState = { body: FeedbackBody; status: FeedbackStatus; error?: string; retryable: boolean };
export type FeedbackReceipt = { feedback_id: string; hazard_id: string; duplicate: boolean };
export type FeedbackDeps = {
  send(hazardId: string, body: FeedbackBody): Promise<FeedbackReceipt>;
  uuid(): string;
  onChange(states: Readonly<Record<string, FeedbackState>>): void;
  onAccepted?(hazardId: string): void;
};

const KIND_NAMES: Record<string, string> = { braking: 'hard-braking spot', surface: 'rough surface', abandoned: 'abandoned path' };
export const feedbackQuestion = (kind: string) => `Is this ${KIND_NAMES[kind] ?? kind} still there?`;

const isPermanent = (error: unknown) => (error as { permanent?: boolean } | null)?.permanent === true;
export const confirms = (receipt: unknown, hazardId: string, body: FeedbackBody) => {
  const r = receipt as Partial<FeedbackReceipt> | null;
  return !!r && r.feedback_id === body.id && r.hazard_id === hazardId && typeof r.duplicate === 'boolean';
};

export function createFeedback(deps: FeedbackDeps) {
  let states: Record<string, FeedbackState> = {};
  const set = (hazardId: string, state: FeedbackState) => { states = { ...states, [hazardId]: state }; deps.onChange(states); };

  async function send(hazardId: string, body: FeedbackBody) {
    set(hazardId, { body, status: 'sending', retryable: false });
    try {
      const receipt = await deps.send(hazardId, body);
      if (!confirms(receipt, hazardId, body)) throw new Error('The server did not confirm this answer');
      set(hazardId, { body, status: 'accepted', retryable: false });
      deps.onAccepted?.(hazardId);
    } catch (error) {
      set(hazardId, { body, status: 'failed', error: error instanceof Error ? error.message : String(error), retryable: !isPermanent(error) });
    }
  }

  return {
    states: () => states,
    respond(hazardId: string, response: FeedbackResponse): Promise<void> {
      const current = states[hazardId];
      if (current && (current.status !== 'failed' || current.retryable)) return Promise.resolve();
      return send(hazardId, { id: deps.uuid(), response });
    },
    retry(hazardId: string): Promise<void> {
      const current = states[hazardId];
      if (!current || current.status !== 'failed' || !current.retryable) return Promise.resolve();
      return send(hazardId, current.body);
    },
  };
}
export type Feedback = ReturnType<typeof createFeedback>;
