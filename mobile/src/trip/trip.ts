/**
 * Trip endpoints with readable labels, feeding resolved points to the route comparison. The origin
 * defaults to Current location, resolved by a one-shot foreground fix only when a trip is planned.
 * A late fix never overwrites an origin the rider chose meanwhile.
 */
import type { LocateResult } from '../location/foreground';

export type Point = { lat: number; lon: number };
export type CurrentStatus = 'idle' | 'locating' | 'ready' | 'denied' | 'unavailable';
export type Endpoint =
  | { kind: 'current'; status: CurrentStatus; point: Point | null }
  | { kind: 'place'; name: string; address: string; point: Point }
  | { kind: 'map'; point: Point }
  | { kind: 'none' };
export type Which = 'origin' | 'destination';
export type TripState = { origin: Endpoint; destination: Endpoint };
export type TripDeps = {
  locate(): Promise<LocateResult>;
  setOrigin(point: Point | null): void;
  setDestination(point: Point | null): void;
  onChange(state: TripState): void;
};

export const endpointPoint = (endpoint: Endpoint): Point | null => (endpoint.kind === 'none' ? null : endpoint.point);
export function endpointLabel(endpoint: Endpoint): string {
  switch (endpoint.kind) {
    case 'current': return 'Current location';
    case 'place': return endpoint.name;
    case 'map': return 'Point on map';
    case 'none': return '';
  }
}

const freshOrigin = (): Endpoint => ({ kind: 'current', status: 'idle', point: null });

export function createTrip(deps: TripDeps) {
  let state: TripState = { origin: freshOrigin(), destination: { kind: 'none' } };
  let locating = 0;

  function apply(which: Which, endpoint: Endpoint) {
    if (which === 'origin') locating++;
    state = { ...state, [which]: endpoint };
    (which === 'origin' ? deps.setOrigin : deps.setDestination)(endpointPoint(endpoint));
    deps.onChange(state);
  }

  async function locateCurrent(): Promise<void> {
    if (state.origin.kind !== 'current') return;
    apply('origin', { kind: 'current', status: 'locating', point: null });
    const mine = locating;
    const result = await deps.locate();
    if (mine !== locating || state.origin.kind !== 'current') return;
    apply('origin', result.ok
      ? { kind: 'current', status: 'ready', point: { lat: result.lat, lon: result.lon } }
      : { kind: 'current', status: result.reason, point: null });
  }

  const locatingNow = () => [state.origin, state.destination].some(e => e.kind === 'current' && e.status === 'locating');

  return {
    state: () => state,
    /** A trip is being planned: resolve Current location if it has not been resolved yet. */
    start(): Promise<void> {
      return state.origin.kind === 'current' && state.origin.status === 'idle' ? locateCurrent() : Promise.resolve();
    },
    retryLocation: locateCurrent,
    useCurrentLocation(): Promise<void> {
      apply('origin', freshOrigin());
      return locateCurrent();
    },
    choose(which: Which, place: { name: string; address: string; lat: number; lon: number }) {
      apply(which, { kind: 'place', name: place.name, address: place.address, point: { lat: place.lat, lon: place.lon } });
    },
    pick(which: Which, point: Point) { apply(which, { kind: 'map', point }); },
    /** Typing in a field invalidates its resolved endpoint until a new result is chosen. */
    edit(which: Which) { if (state[which].kind !== 'none') apply(which, { kind: 'none' }); },
    canSwap: () => !locatingNow() && (state.origin.kind !== 'none' || state.destination.kind !== 'none'),
    swap() {
      if (!locatingNow()) {
        const { origin, destination } = state;
        apply('origin', destination);
        apply('destination', origin);
      }
    },
    clear(): Promise<void> {
      apply('destination', { kind: 'none' });
      apply('origin', freshOrigin());
      return locateCurrent();
    },
  };
}
export type Trip = ReturnType<typeof createTrip>;
