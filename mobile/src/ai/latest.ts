/** Optional AI requests may finish after a draft or comparison changes. Ignore stale results. */
export function createLatest<T>(onValue: (value: T) => void, onError: () => void, onBusy: (busy: boolean) => void) {
  let generation = 0;
  let busy = false;
  return {
    clear() { generation++; busy = false; onBusy(false); },
    async run(load: () => Promise<T>) {
      if (busy) return;
      const mine = ++generation;
      busy = true; onBusy(true);
      try {
        const result = await load();
        if (mine === generation) onValue(result);
      } catch {
        if (mine === generation) onError();
      } finally {
        if (mine === generation) { busy = false; onBusy(false); }
      }
    },
  };
}
