export type WatchStatus = 'paused' | 'checking' | 'denied' | 'watching' | 'unavailable';
/** Reuse granted permission; browsing must never open a permission dialog. */
export function createForegroundWatch<T>(deps: {
  permission(): Promise<{ granted: boolean }>;
  watch(onPosition: (position: T) => void, onError: () => void): Promise<{ remove(): void }>;
  onPosition(position: T): void;
  onActive(active: boolean): void;
  onStatus?(status: WatchStatus): void;
}) {
  let generation = 0;
  let subscription: { remove(): void } | null = null;
  return {
    async setActive(active: boolean): Promise<void> {
      const mine = ++generation;
      subscription?.remove();
      subscription = null;
      deps.onActive(false);
      deps.onStatus?.(active ? 'checking' : 'paused');
      if (!active) return;
      const fail = () => {
        if (mine !== generation) return;
        generation++;
        subscription?.remove(); subscription = null;
        deps.onActive(false);
        deps.onStatus?.('unavailable');
      };
      try {
        const { granted } = await deps.permission();
        if (mine !== generation) return;
        if (!granted) { deps.onStatus?.('denied'); return; }
        deps.onActive(true);
        const watching = await deps.watch(position => {
          if (mine === generation) deps.onPosition(position);
        }, fail);
        if (mine !== generation) watching.remove();
        else { subscription = watching; deps.onStatus?.('watching'); }
      } catch { fail(); }
    },
  };
}
