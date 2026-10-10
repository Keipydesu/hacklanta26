/** Nearby prompts reuse granted permission; browsing must never open a permission dialog. */
export function createForegroundWatch<T>(deps: {
  permission(): Promise<{ granted: boolean }>;
  watch(onPosition: (position: T) => void): Promise<{ remove(): void }>;
  onPosition(position: T): void;
  onActive(active: boolean): void;
}) {
  let generation = 0;
  let subscription: { remove(): void } | null = null;
  return {
    async setActive(active: boolean): Promise<void> {
      const mine = ++generation;
      subscription?.remove();
      subscription = null;
      deps.onActive(false);
      if (!active) return;
      try {
        const { granted } = await deps.permission();
        if (!granted || mine !== generation) return;
        deps.onActive(true);
        const watching = await deps.watch(position => {
          if (mine === generation) deps.onPosition(position);
        });
        if (mine !== generation) watching.remove();
        else subscription = watching;
      } catch { /* Location unavailable: browsing and manual endpoint selection still work. */ }
    },
  };
}
