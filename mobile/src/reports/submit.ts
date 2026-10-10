/** A stable handler guard: acquire before UUID creation, independently of React renders. */
export function createSubmitGuard() {
  let busy = false;
  return async (submit: () => Promise<void>): Promise<void> => {
    if (busy) return;
    busy = true;
    try { await submit(); }
    finally { busy = false; }
  };
}
