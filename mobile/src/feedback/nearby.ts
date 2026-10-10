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
