/**
 * Basemap style. Defaults to OpenFreeMap (OSM-derived vector tiles; free, no key). Override with
 * EXPO_PUBLIC_MAP_STYLE_URL, e.g. for a self-hosted style. Public value: never put a secret here.
 */
export const DEFAULT_MAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';
export const mapStyleUrl = process.env.EXPO_PUBLIC_MAP_STYLE_URL?.trim() || DEFAULT_MAP_STYLE_URL;

/**
 * Origin given to the WebView page. Raw HTML otherwise gets an opaque (null) origin, and Chromium
 * then refuses MapLibre's Blob-URL module worker. `.invalid` is reserved, so it never resolves.
 */
export const MAP_PAGE_ORIGIN = 'https://campus-map.invalid/';
