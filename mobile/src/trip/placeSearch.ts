/**
 * Search-as-you-type for one trip field. Debounced, and only the newest query's answer is applied:
 * a late response for older text never replaces newer results.
 */
export type PlaceResult = { id: string; name: string; address: string; lat: number; lon: number };
export type SearchStatus = 'idle' | 'short' | 'loading' | 'results' | 'empty' | 'failed';
export type SearchState = { query: string; status: SearchStatus; places: PlaceResult[]; error?: string };
export type SearchDeps = {
  search(query: string): Promise<PlaceResult[]>;
  onChange(state: SearchState): void;
  schedule(run: () => void, ms: number): unknown;
  cancel(handle: unknown): void;
};
export const MIN_QUERY = 3;
export const DEBOUNCE_MS = 300;

export function createPlaceSearch(deps: SearchDeps) {
  let state: SearchState = { query: '', status: 'idle', places: [] };
  let latest = 0;
  let timer: unknown;
  const set = (next: SearchState) => { state = next; deps.onChange(state); };

  async function run() {
    const mine = ++latest;
    const query = state.query.trim();
    set({ query: state.query, status: 'loading', places: [] });
    try {
      const places = await deps.search(query);
      if (mine !== latest) return;
      set({ query: state.query, status: places.length ? 'results' : 'empty', places });
    } catch (error) {
      if (mine !== latest) return;
      set({ query: state.query, status: 'failed', places: [], error: error instanceof Error ? error.message : String(error) });
    }
  }

  return {
    state: () => state,
    type(query: string) {
      latest++;
      if (timer !== undefined) deps.cancel(timer);
      timer = undefined;
      const trimmed = query.trim();
      if (!trimmed) return set({ query, status: 'idle', places: [] });
      if (trimmed.length < MIN_QUERY) return set({ query, status: 'short', places: [] });
      set({ query, status: 'loading', places: [] });
      timer = deps.schedule(() => { timer = undefined; void run(); }, DEBOUNCE_MS);
    },
    retry(): Promise<void> {
      if (state.query.trim().length < MIN_QUERY) return Promise.resolve();
      if (timer !== undefined) deps.cancel(timer);
      timer = undefined;
      return run();
    },
    reset() {
      latest++;
      if (timer !== undefined) deps.cancel(timer);
      timer = undefined;
      set({ query: '', status: 'idle', places: [] });
    },
  };
}
export type PlaceSearch = ReturnType<typeof createPlaceSearch>;
