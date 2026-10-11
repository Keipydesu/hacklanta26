/** Builds the map overlay from app state; pure so parity with the old react-native-maps view is testable. */
import type { LngLat, MapMarker, Overlay, RouteLine } from './protocol';
import { categoryLabel, hazardSourceLabel, hazardTitle } from '../reports/categories';

type HazardFeature = {
  geometry: { coordinates: number[][][] };
  properties: { id: string; source: 'manual' | 'automatic'; evidence_source?: string | null; kind: string; label: string };
};
type PendingReport = { id: string; state: string; body: { lat: number; lon: number; kind: string } };
type Point = { lat: number; lon: number };
type Line = { coordinates: number[][] };

export const MARKER_COLORS = { hazard: '#d64532', selected: '#f2a900', pending: '#2b6cd4', pin: '#d64532', origin: '#2f8f3a', destination: '#7b3fb0' } as const;

export type OverlayInput = {
  screen: 'map' | 'report' | 'route';
  hazards: readonly HazardFeature[];
  submissions: readonly PendingReport[];
  pin: Point | null;
  routes: { shortest: Line; lowerRisk: Line | null } | null;
  origin: Point | null;
  originIsCurrent?: boolean;
  destinationIsCurrent?: boolean;
  destination: Point | null;
  routeColors: { shortest: string; safest: string };
  selectedHazardId?: string | null;
  livePosition?: Point | null;
};

const hazardIcon = (kind?: string): MapMarker['icon'] =>
  ['pothole', 'obstruction', 'closure', 'braking', 'surface', 'abandoned'].includes(kind ?? '')
    ? kind as MapMarker['icon'] : 'other';

const at = (p: Point): LngLat => [p.lon, p.lat];
const ring = (r: number[][]) => r.map(([lon, lat]) => [lon, lat] as LngLat);

export function buildOverlay(input: OverlayInput): Overlay {
  const markers: MapMarker[] = [];
  for (const h of input.hazards) {
    markers.push({ id: `hazard-${h.properties.id}`, position: ring([h.geometry.coordinates[0][0]])[0],
      color: h.properties.id === input.selectedHazardId ? MARKER_COLORS.selected : MARKER_COLORS.hazard,
      icon: hazardIcon(h.properties.kind), title: hazardSourceLabel(h.properties), description: hazardTitle(h.properties), select: h.properties.id });
  }
  for (const sub of input.submissions) {
    if (sub.state === 'submitted') continue;
    markers.push({ id: `pending-${sub.id}`, position: at(sub.body), color: MARKER_COLORS.pending,
      icon: hazardIcon(sub.body.kind), title: 'Pending report (not yet accepted)', description: categoryLabel(sub.body.kind) });
  }
  if (input.screen === 'report' && input.pin) markers.push({ id: 'pin', position: at(input.pin), color: MARKER_COLORS.pending, icon: 'location', title: 'Your current report location', draggable: false });

  if (input.screen === 'route' && input.livePosition) markers.push({ id: 'live-position', position: at(input.livePosition), color: '#1877f2', title: 'Your location', draggable: false, dot: true });

  const routes: RouteLine[] = [];
  if (input.screen === 'route') {
    const presented = input.routes;
    if (presented?.lowerRisk) {
      routes.push({ id: 'lower-risk', coordinates: presented.lowerRisk.coordinates.map(([lon, lat]) => [lon, lat] as LngLat), color: input.routeColors.safest, width: 6, dashed: false });
    }
    if (presented) {
      routes.push({ id: 'shortest', coordinates: presented.shortest.coordinates.map(([lon, lat]) => [lon, lat] as LngLat), color: input.routeColors.shortest, width: 4, dashed: !!presented.lowerRisk });
    }
    if (input.origin) markers.push({ id: 'origin', position: at(input.origin), color: input.originIsCurrent ? MARKER_COLORS.pending : MARKER_COLORS.origin, icon: input.originIsCurrent ? 'location' : undefined, title: input.originIsCurrent ? 'Your location · trip start' : 'Start (A)', draggable: !input.originIsCurrent });
    if (input.destination) markers.push({ id: 'destination', position: at(input.destination), color: input.destinationIsCurrent ? MARKER_COLORS.pending : MARKER_COLORS.destination, icon: input.destinationIsCurrent ? 'location' : undefined, title: input.destinationIsCurrent ? 'Your location · trip destination' : 'Destination (B)', draggable: !input.destinationIsCurrent });
  }
  return {
    hazards: input.hazards.map(h => ({ id: h.properties.id, source: h.properties.source, rings: h.geometry.coordinates.map(ring) })),
    markers,
    routes,
  };
}
