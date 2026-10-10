# 010. OSM basemap with MapLibre GL JS in a WebView

- Status: Accepted
- Date: 2026-10-10

## Decision

The manual app draws its map with MapLibre GL JS 6.11.2 inside `react-native-webview` 13.16.1,
using OpenFreeMap's OSM-derived vector tiles (`https://tiles.openfreemap.org/styles/liberty`)
instead of the platform map (`react-native-maps`: Apple Maps on iOS, Google Maps on Android).
Routing is unchanged: the app sends tapped endpoints to `POST /v1/route`, and the product API
calls Valhalla, which builds its graph from OSM. Operator direction; tracked in issue #27.

- **WebView, not native MapLibre.** Decision 009 requires the app to run in Expo Go.
  `@maplibre/maplibre-react-native` is a native module that needs a development build. The WebView
  module ships in Expo Go for SDK 57.
- **Bundled library, no CDN.** MapLibre 6 ships ES modules only. `scripts/build-map-bundle.mjs`
  inlines the pinned `dist` files into a generated, gitignored module. The page turns the shared
  chunk and worker into Blob URLs. The page is given the origin `https://campus-map.invalid/`,
  because raw HTML otherwise gets an opaque origin and Chromium refuses the Blob module worker.
- **Tile source.** OpenFreeMap is free, needs no key and allows commercial use. MapLibre's
  attribution control shows the required "OpenFreeMap © OpenMapTiles Data from OpenStreetMap".
  `tile.openstreetmap.org` is not used, because its usage policy forbids distribution in apps.
  `EXPO_PUBLIC_MAP_STYLE_URL` overrides the style. It is public and never a secret.
- **Version.** 6.11.2 was the latest patch on a minor line more than two weeks old. All releases up
  to 6.4.0, including the whole 5.x line, are affected by the critical XSS advisory
  GHSA-jrc7-96c5-q579. Popups are built from text nodes, never HTML. The WebView loads only its own
  page in place, opens other http(s) links in the browser and blocks every other scheme.
- **Consistency claim.** The basemap and Valhalla are both OSM-derived, but OpenFreeMap serves its
  own planet build while Valhalla uses a dated Georgia extract. Expect small drift between drawn
  paths and routed paths. Exact consistency requires self-hosting a basemap built from the same
  extract as the routing tiles. That is a follow-up, not part of this decision.
- **Privacy.** Every tile request reveals the viewed area to OpenFreeMap. Reports and routes are
  unaffected.
- **Offline.** If the style cannot load (an error or a 12 s timeout), the page switches to a local
  blank style and shows a notice. Hazards, pins and routes still render, and the fixture preview
  keeps working without network.

## Verification and limits

Mobile typecheck, 57 Node tests and iOS/Android bundle export pass. The tests cover bounds,
message validation, navigation guarding, overlay parity, script escaping and the page script
against a fake MapLibre.
The real generated page was also smoke-tested in headless Chrome over an HTTP origin. Online, the
OpenFreeMap basemap and the hazard, route and pin overlays rendered. Offline, the blank-style
fallback rendered the same overlays. A physical-device Expo Go check on iOS and Android is still
required before merge: WebKit and Android WebView behavior for Blob module workers and WebGL is
not proven by desktop Chrome. See the [dependency review](../../mobile/MAPLIBRE-REVIEW.md).

## Rejected alternatives

- Native `@maplibre/maplibre-react-native`, because it breaks Expo Go (decision 009).
- Loading MapLibre from a CDN, because it adds a runtime third party and fails offline.
- `tile.openstreetmap.org` raster tiles, because of its usage policy.
- MapLibre 5.x, because it is unmaintained and affected by the critical advisory.

## Supersedes

The React Native Maps rendering in decision 009's stack. Decision 009's Expo Go requirement stands.
