import type { components } from '../api/schema';

export type Point = components['schemas']['Coordinate'];
export type RouteResponse = components['schemas']['RouteResponse'];
export type Route = components['schemas']['Route'];
/** `illustrative` is true when the server (or offline preview) returned its fixed example lines. */
export interface RouteResult { response: RouteResponse; illustrative: boolean }

export type RouteStatus = 'idle' | 'loading' | 'ready' | 'unavailable' | 'failed';
export interface RouteState {
  origin: Point | null;
  destination: Point | null;
  status: RouteStatus;
  result: RouteResult | null;
  error: string | null;
  /** A hazard changed after this comparison was made; it may no longer reflect the map. */
  outdated: boolean;
}
export interface RouteDeps {
  load(origin: Point, destination: Point): Promise<RouteResult>;
  onChange?(state: RouteState): void;
}

export const validPoint = (p: Point | null | undefined): p is Point =>
  !!p && Number.isFinite(p.lat) && Number.isFinite(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180;
const samePoint = (a: Point | null, b: Point | null) => !!a && !!b && a.lat === b.lat && a.lon === b.lon;
/** Two pins closer than about a metre are not a trip. */
const coincident = (a: Point, b: Point) => Math.abs(a.lat - b.lat) < 1e-5 && Math.abs(a.lon - b.lon) < 1e-5;
export const canRequest = (s: Pick<RouteState, 'origin' | 'destination'>) =>
  validPoint(s.origin) && validPoint(s.destination) && !coincident(s.origin, s.destination);

/**
 * Selected endpoints and the comparison for exactly that pair. Request state is independent of the
 * map feed and the report form: a routing failure never touches either.
 */
export function createRouteComparison(deps: RouteDeps) {
  let state: RouteState = { origin: null, destination: null, status: 'idle', result: null, error: null, outdated: false };
  // Bumped whenever the endpoints change, so a response for an older pair is never shown.
  let generation = 0;
  let inFlight: { generation: number; promise: Promise<void> } | undefined;

  const set = (next: Partial<RouteState>) => { state = { ...state, ...next }; deps.onChange?.({ ...state }); };
  function setEndpoint(which: 'origin' | 'destination', point: Point | null) {
    if (point !== null && !validPoint(point)) return;
    if (samePoint(state[which], point) || (state[which] === null && point === null)) return;
    generation++;
    // The displayed lines belonged to the previous pair.
    set({ [which]: point, status: 'idle', result: null, error: null, outdated: false });
  }

  /** One request per endpoint pair at a time; repeated taps share it. */
  function request(): Promise<void> {
    const { origin, destination } = state;
    if (!validPoint(origin) || !validPoint(destination) || coincident(origin, destination)) return Promise.resolve();
    if (inFlight && inFlight.generation === generation) return inFlight.promise;
    const mine = generation;
    set({ status: 'loading', error: null });
    const promise = (async () => {
      try {
        const result = await deps.load(origin, destination);
        if (mine !== generation) return;
        if (!shortestOf(result.response)) throw new Error('The server returned no route.');
        set({ status: 'ready', result, error: null, outdated: false });
      } catch (e) {
        if (mine !== generation) return;
        const status = (e as { status?: number } | null)?.status;
        // Keep the previous comparison visible (marked outdated) if a refresh fails.
        if (status === 503) set({ status: 'unavailable', error: 'Routing is unavailable right now. The map and reporting still work.', outdated: state.result !== null });
        else if (status === 422) set({ status: 'failed', error: 'These points cannot be routed. Move the pins and try again.', result: null });
        else set({ status: 'failed', error: `Could not compare routes: ${e instanceof Error ? e.message : String(e)}`, outdated: state.result !== null });
      }
    })().finally(() => { if (inFlight?.promise === promise) inFlight = undefined; });
    inFlight = { generation: mine, promise };
    return promise;
  }

  return {
    state: () => ({ ...state }),
    setOrigin: (point: Point | null) => setEndpoint('origin', point),
    setDestination: (point: Point | null) => setEndpoint('destination', point),
    swap() {
      if (!state.origin && !state.destination) return;
      generation++;
      set({ origin: state.destination, destination: state.origin, status: 'idle', result: null, error: null, outdated: false });
    },
    clear() {
      generation++;
      set({ origin: null, destination: null, status: 'idle', result: null, error: null, outdated: false });
    },
    request,
    /** A change hint arrived. Local queued reports do not count until the server accepts them. */
    hazardsChanged() { if (state.result && !state.outdated) set({ outdated: true }); },
  };
}
export type RouteComparison = ReturnType<typeof createRouteComparison>;

const shortestOf = (r: RouteResponse) => r.routes.find(route => route.kind === 'shortest');
const sameLine = (a: Route, b: Route) => {
  const p = a.geometry.coordinates, q = b.geometry.coordinates;
  return p.length === q.length && p.every((c, i) => c[0] === q[i][0] && c[1] === q[i][1]);
};

export interface RouteLine {
  kind: Route['kind'];
  /** The contract says "safest"; people only ever see "Lower-risk". */
  label: 'Shortest' | 'Lower-risk';
  distance: string; duration: string; risk: string;
  hazardCount: number;
  coordinates: Route['geometry']['coordinates'];
}
export interface Presented {
  shortest: RouteLine;
  /** Null when there is no alternative or it is the same path: one path is never shown as two. */
  lowerRisk: RouteLine | null;
  summary: string;
  illustrative: boolean;
}

export const formatDistance = (m: number) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(m < 10_000 ? 1 : 0)} km`);
export const formatDuration = (s: number) => (s < 60 ? 'under 1 min' : `${Math.round(s / 60)} min`);
/** A routing heuristic from current reports on a 0–1 scale; not a probability or a safety rating. */
export const formatRisk = (score: number) => `risk ${score.toFixed(2)}`;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

const line = (route: Route, label: RouteLine['label']): RouteLine => ({
  kind: route.kind, label, distance: formatDistance(route.distance_m), duration: formatDuration(route.duration_s),
  risk: formatRisk(route.risk_score), hazardCount: route.hazard_ids.length, coordinates: route.geometry.coordinates,
});

export function presentRoutes(result: RouteResult): Presented | null {
  const shortest = shortestOf(result.response);
  if (!shortest) return null;
  const alternative = result.response.routes.find(route => route.kind === 'safest');
  const base = { shortest: line(shortest, 'Shortest'), illustrative: result.illustrative };
  const crossing = shortest.hazard_ids.length ? `It crosses ${plural(shortest.hazard_ids.length, 'reported hazard')}.` : 'It crosses no reported hazards.';
  if (!result.response.safest_available || !alternative) {
    return { ...base, lowerRisk: null, summary: `No lower-risk alternative is available between these points, so only the shortest route is shown. ${crossing}` };
  }
  if (sameLine(shortest, alternative)) {
    return { ...base, lowerRisk: null, summary: `The shortest route is also the lower-risk route here. ${crossing}` };
  }
  const extra = alternative.distance_m - shortest.distance_m;
  const fewer = shortest.hazard_ids.length - alternative.hazard_ids.length;
  const length = Math.abs(extra) < 1 ? 'the same length' : `${formatDistance(Math.abs(extra))} ${extra > 0 ? 'longer' : 'shorter'}`;
  const hazards = fewer > 0 ? `crosses ${plural(fewer, 'fewer reported hazard')}` : fewer < 0 ? `crosses ${plural(-fewer, 'more reported hazard')}` : 'crosses the same number of reported hazards';
  return { ...base, lowerRisk: line(alternative, 'Lower-risk'), summary: `The lower-risk route is ${length} and ${hazards}.` };
}
