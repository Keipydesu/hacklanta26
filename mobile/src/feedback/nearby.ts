/**
 * Opens a hazard's answer panel when the rider is close to it while the app is open. Pure: the app
 * feeds foreground positions; nothing is tracked in the background or sent anywhere. Each hazard is
 * prompted at most once per session, and ignoring a prompt is not an answer.
 */
export const NEARBY_RADIUS_M = 40;

export type NearbyHazard = { id: string; ring: number[][] };
export type Position = { lat: number; lon: number };

const EARTH_RADIUS_M = 6_371_008.8;
export function distanceM(a: Position, lon: number, lat: number): number {
  const rad = Math.PI / 180;
  const dLat = (lat - a.lat) * rad, dLon = (lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Metres from the position to the hazard's outer ring: 0 inside it, else to the nearest edge. */
function hazardDistanceM(position: Position, ring: number[][]): number {
  if (!ring.length) return Infinity;
  const rad = Math.PI / 180, scale = EARTH_RADIUS_M * rad, cos = Math.cos(position.lat * rad);
  const pts = ring.map(([lon, lat]) => [(lon - position.lon) * scale * cos, (lat - position.lat) * scale]);
  if (pts.length === 1) return Math.hypot(pts[0][0], pts[0][1]);
  let inside = false, best = Infinity;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > 0) !== (yj > 0) && 0 < ((xj - xi) * (0 - yi)) / (yj - yi) + xi) inside = !inside;
    const dx = xj - xi, dy = yj - yi, length2 = dx * dx + dy * dy;
    const t = length2 ? Math.max(0, Math.min(1, -(xi * dx + yi * dy) / length2)) : 0;
    best = Math.min(best, Math.hypot(xi + t * dx, yi + t * dy));
  }
  return inside ? 0 : best;
}

export function createNearbyPrompter(radiusM = NEARBY_RADIUS_M) {
  const prompted = new Set<string>();
  return {
    /** The closest not-yet-prompted hazard within the radius, marked as prompted; otherwise null. */
    next(position: Position, hazards: readonly NearbyHazard[]): string | null {
      let best: { id: string; distance: number } | null = null;
      for (const hazard of hazards) {
        if (prompted.has(hazard.id)) continue;
        const distance = hazardDistanceM(position, hazard.ring);
        if (distance <= radiusM && (!best || distance < best.distance)) best = { id: hazard.id, distance };
      }
      if (!best) return null;
      prompted.add(best.id);
      return best.id;
    },
  };
}

export type NearbyFeature = {
  geometry: { coordinates: number[][][] };
  properties: { id: string; status: string; expires_at: string };
};
export type WatcherDeps<F extends NearbyFeature> = {
  load(bbox: string): Promise<{ features: F[] }>;
  now(): number;
  busy(): boolean;
  onPrompt(hazard: F): void;
};
/** Grid cell in degrees (~500 m). Lookups name a 3x3 block of cells, never the rider's exact position. */
export const CELL_DEG = 0.005;
export const REFETCH_MS = 60_000;

export const cellOf = (p: Position) => `${Math.floor(p.lat / CELL_DEG)},${Math.floor(p.lon / CELL_DEG)}`;

/** The rider's grid cell plus its neighbours as `minLon,minLat,maxLon,maxLat`, clamped to WGS84. */
export function cellBbox(p: Position): string {
  const clamp = (v: number, limit: number) => Math.min(limit, Math.max(-limit, v));
  const south = Math.floor(p.lat / CELL_DEG) * CELL_DEG - CELL_DEG, west = Math.floor(p.lon / CELL_DEG) * CELL_DEG - CELL_DEG;
  return [clamp(west, 180), clamp(south, 90), clamp(west + 3 * CELL_DEG, 180), clamp(south + 3 * CELL_DEG, 90)]
    .map(v => Number(v.toFixed(6))).join(',');
}

/**
 * Feeds the prompter from its own hazard lookup for the rider's ~500 m grid block, independent of the
 * map viewport, and re-checks the latest position whenever that lookup returns. The server only
 * learns which block was looked up, as when browsing the map.
 */
export function createNearbyWatcher<F extends NearbyFeature>(deps: WatcherDeps<F>, prompter = createNearbyPrompter()) {
  let hazards: F[] = [];
  let latest: Position | null = null;
  let fetched: { at: number; cell: string } | null = null;
  let loading = false;

  function evaluate() {
    if (!latest || deps.busy()) return;
    const now = deps.now();
    const live = hazards.filter(h => h.properties.status === 'active' && Date.parse(h.properties.expires_at) > now);
    const id = prompter.next(latest, live.map(h => ({ id: h.properties.id, ring: h.geometry.coordinates[0] ?? [] })));
    const hazard = id ? live.find(h => h.properties.id === id) : undefined;
    if (hazard) deps.onPrompt(hazard);
  }

  async function refetch(position: Position) {
    loading = true;
    fetched = { at: deps.now(), cell: cellOf(position) };
    try {
      hazards = (await deps.load(cellBbox(position))).features;
    } catch {
      fetched = null;
    } finally {
      loading = false;
    }
    evaluate();
  }

  const stale = (position: Position) => !fetched || deps.now() - fetched.at >= REFETCH_MS || fetched.cell !== cellOf(position);

  return {
    position(position: Position): Promise<void> {
      latest = position;
      evaluate();
      return !loading && stale(position) ? refetch(position) : Promise.resolve();
    },
    invalidate(): Promise<void> {
      fetched = null;
      return latest && !loading ? refetch(latest) : Promise.resolve();
    },
    evaluate,
  };
}
