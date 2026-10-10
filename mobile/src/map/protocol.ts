/**
 * Messages between the app and the MapLibre WebView. Pure and React-free so it runs in Node tests.
 * Positions use GeoJSON order ([lon, lat]) like the product API.
 */
export type LngLat = [number, number];
export type Bounds = { west: number; south: number; east: number; north: number };

export type HazardShape = { id: string; source: 'manual' | 'automatic'; rings: LngLat[][] };
export type MapMarker = {
  id: string;
  position: LngLat;
  color: string;
  title: string;
  description?: string;
  draggable?: boolean;
};
export type RouteLine = { id: string; coordinates: LngLat[]; color: string; width: number; dashed: boolean };
export type Overlay = { hazards: HazardShape[]; markers: MapMarker[]; routes: RouteLine[] };

export type ToWeb = { type: 'overlay'; overlay: Overlay };
export type FromWeb =
  | { type: 'ready' }
  | { type: 'press'; position: LngLat }
  | { type: 'drag'; id: string; position: LngLat }
  | { type: 'bounds'; bounds: Bounds }
  | { type: 'basemap'; status: 'loaded' | 'unavailable'; detail?: string };

const clamp = (value: number, limit: number) => Math.min(limit, Math.max(-limit, value));
const finite = (...values: unknown[]) => values.every(v => typeof v === 'number' && Number.isFinite(v));
const isPosition = (value: unknown): value is LngLat =>
  Array.isArray(value) && value.length === 2 && finite(value[0], value[1]) && Math.abs(value[0]) <= 180 && Math.abs(value[1]) <= 90;

/**
 * Normalize MapLibre's getBounds() into the WGS84 box the API accepts. A view spanning the whole
 * world (or wrapping past it) becomes -180..180; otherwise each edge is clamped. Antimeridian
 * crossing is unsupported by the API (decision 002), so a wrapped edge is cut at ±180.
 */
export function normalizeBounds(raw: Bounds): Bounds | null {
  if (!finite(raw.west, raw.south, raw.east, raw.north)) return null;
  const wide = raw.east - raw.west >= 360;
  const west = wide ? -180 : clamp(raw.west, 180);
  const east = wide ? 180 : clamp(raw.east, 180);
  const south = clamp(raw.south, 90), north = clamp(raw.north, 90);
  if (!(west < east && south < north)) return null;
  return { west, south, east, north };
}

/** `minLon,minLat,maxLon,maxLat` for GET /v1/hazards. */
export const bboxParam = (b: Bounds) => [b.west, b.south, b.east, b.north].join(',');

/** Bounds around a center, matching the old react-native-maps initial region. */
export const boundsAround = (center: LngLat, lonDelta: number, latDelta: number): Bounds =>
  normalizeBounds({ west: center[0] - lonDelta / 2, east: center[0] + lonDelta / 2, south: center[1] - latDelta / 2, north: center[1] + latDelta / 2 })!;

/** Parse a WebView message. Anything malformed is ignored rather than trusted. */
export function parseFromWeb(data: string): FromWeb | null {
  let message: any;
  try { message = JSON.parse(data); } catch { return null; }
  if (!message || typeof message !== 'object') return null;
  switch (message.type) {
    case 'ready': return { type: 'ready' };
    case 'press': return isPosition(message.position) ? { type: 'press', position: message.position } : null;
    case 'drag':
      return typeof message.id === 'string' && isPosition(message.position) ? { type: 'drag', id: message.id, position: message.position } : null;
    case 'bounds': {
      const b = message.bounds;
      if (!b || !finite(b.west, b.south, b.east, b.north)) return null;
      const bounds = normalizeBounds(b);
      return bounds ? { type: 'bounds', bounds } : null;
    }
    case 'basemap':
      if (message.status !== 'loaded' && message.status !== 'unavailable') return null;
      return { type: 'basemap', status: message.status, detail: typeof message.detail === 'string' ? message.detail.slice(0, 200) : undefined };
    default: return null;
  }
}

/** JavaScript to inject into the WebView; JSON is a valid JS expression. */
export const injection = (message: ToWeb) => `window.__campusMap && window.__campusMap.receive(${JSON.stringify(message)}); true;`;

export type NavigationDecision = 'load' | 'external' | 'block';
/**
 * What the WebView does with a navigation. Only the page's own document loads in place. Outside
 * http(s) links (attribution comes from the remote style) open in the system browser. Every other
 * scheme (javascript:, data:, file:, intent:, other about: pages, blob: ...) is refused. Exactly
 * `about:blank` may load: react-native-webview always allows it because a raw-HTML page can
 * bootstrap through it, and it runs no code.
 */
export function navigationDecision(url: string, pageOrigin: string): NavigationDecision {
  if (url === 'about:blank') return 'load';
  let parsed: URL, origin: URL;
  try { parsed = new URL(url); origin = new URL(pageOrigin); } catch { return 'block'; }
  if (parsed.protocol === origin.protocol && parsed.host === origin.host && !parsed.username && !parsed.password) return 'load';
  if ((parsed.protocol === 'https:' || parsed.protocol === 'http:') && !parsed.username && !parsed.password) return 'external';
  return 'block';
}
