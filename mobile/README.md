# Manual mobile app

## UI concept branch

The `lane/a-ui` concept uses a full map canvas with a compact header, an expandable bottom
panel and Map / Trip / Report controls. “Where to?” opens destination-pin placement;
select Set start or expand details for foreground location. Expanding reveals additional
controls and evidence; changing tasks collapses the panel while preserving trip/draft state.
The shared icon and control system is described in the [mobile UI guide](docs/UI-GUIDE.md).

Run `npm start --prefix mobile` for the labeled fixture preview, or set
`EXPO_PUBLIC_API_URL` for live flows. The existing renderer remains for the separate OSM work.
Report pins and optional descriptions remain pending #23/#24. This is route comparison, not
turn-by-turn navigation; no text search, rental integration or separate bicycle costing is added.

Verified: TypeScript and all 39 mobile tests; iPhone 17 Pro / iOS 26.1 Simulator with Expo Go
57.0.9 renders Map, route-pin selection, fixture comparison, details and reporting.
[Screenshots](docs/screenshots/README.md) use fixture data. Physical-device, Android, larger-text
and full screen-reader checks remain pending. For Metro binding only to IPv6 localhost, use
`NODE_OPTIONS=--dns-result-order=ipv4first npm start --prefix mobile -- --localhost --clear`.
The screenshot session needed a clean Metro/Expo Go restart after an initial ExpoAsset error;
no package change was required.

Expo SDK 57 + TypeScript. The map is MapLibre GL JS in a WebView with OpenFreeMap OSM vector tiles
([decisions 010](../docs/decisions/010-osm-maplibre-basemap.md) and [011](../docs/decisions/011-positron-and-dark-matter-map-themes.md)). No sensor imports or motion permissions. Uses only
its local generated product types and copied fixtures; the automatic tree is not a dependency.
SDK versions follow the [Expo 57 compatibility table](https://docs.expo.dev/versions/v57.0.0/).

From the repository root (Node 22 LTS recommended):

```sh
npm ci --prefix mobile
npm run typecheck --prefix mobile
npm test --prefix mobile
npm run build --prefix mobile
npm start --prefix mobile
```

`build` exports iOS and Android JavaScript/Hermes bundles to `mobile/dist`; it does not create a
signed native binary. Open the development server using an SDK-57-compatible Expo Go or development
build. The refresh regression tests run in Node without a device. Both native bundle exports and typechecking have been verified; a physical-device visual
and interaction check is still needed.

## Map

`src/map/` holds the map. `MapLibreView` renders a self-contained page in `react-native-webview`, which
ships in Expo Go. The page runs MapLibre GL JS 6.11.2, inlined from `node_modules` into the gitignored
`src/map/maplibreBundle.generated.ts` by `npm run map:bundle`. The start, typecheck, test and build
scripts run that step first. Nothing loads from a CDN at runtime.

- **Basemap:** OpenFreeMap's OSM-derived Positron style is the default light map. The map button
  switches to OpenFreeMap Dark, a fork of Dark Matter, without resetting the viewport or overlays.
  The choice resets to Positron on launch. Override the light and dark styles with
  `EXPO_PUBLIC_MAP_STYLE_URL` and `EXPO_PUBLIC_MAP_DARK_STYLE_URL` (public values, never secrets).
  MapLibre shows the required OpenFreeMap/OpenMapTiles/OpenStreetMap attribution; its links open in
  the browser.
- **Routing consistency:** Valhalla also routes over OSM, but over a dated Georgia extract rather
  than OpenFreeMap's build, so small drift between drawn and routed paths is expected (issue #27).
- **Offline:** if the selected style can't load within 12 s, the page switches to a light or dark
  local blank background with a notice. Hazards, pins and routes still draw, so the fixture preview
  works without network. Switching themes retries the remote style.
- **Privacy:** tile requests reveal the viewed area to OpenFreeMap. Reports and routes go only to
  the product API.
- **Bridge:** app-to-page messages and their validation live in `src/map/protocol.ts`, and the
  overlay is built by `src/map/overlay.ts`. The page script is `map-web/page.js`. All three are
  covered by `tests/map.cjs` in Node. Dependency review: [MAPLIBRE-REVIEW.md](MAPLIBRE-REVIEW.md).
  Repeated world copies normalize pin longitudes and shift viewport bounds together into WGS84.
  Dateline-crossing views still clip at ±180 because the API does not support crossing bounds.
  A viewport centered exactly on the dateline consistently selects the -180 side in every copy.

With no `EXPO_PUBLIC_API_URL`, the app opens in visibly labeled offline fixture preview mode.
Map source/evidence labels and expiry are shown; timestamps shift once per app session. Report
submission is disabled in fixture mode. The route screen shows fixed example GSU routes, labeled
as an offline preview.

For the live product stub, set the URL when starting Metro:

```sh
EXPO_PUBLIC_API_URL=http://YOUR_LAN_IP:8000 npm start --prefix mobile
```

Use your computer's LAN address on a phone (not the phone's localhost). The phone and API host
must share a reachable network; use HTTPS for hosted services. The backend listens on `0.0.0.0`.
Never put a publication key in this app or any Expo public variable.

Tap Report, place/drag a pin, choose a kind and submit. No location permission is needed. Submit
freezes the report (UUID, observation time, body) and saves it to AsyncStorage before any network
call. It is then shown as queued/sending/submitted/failed and resent with the identical body after
transient failures (bounded exponential backoff), app foregrounding and relaunch. Pending reports
appear as blue pins labeled "not yet accepted" and never as server hazards. A definitive rejection
(409/422) is shown for dismissal and correction; exhausted retries keep the original ID for an
explicit "Retry original report" because the server outcome is unknown. Unreadable saved data is
copied to `report-queue.unreadable` instead of being discarded. Queue logic lives in `src/reports/queue.ts` and is tested in Node (`tests/reportQueue.cjs`).

Live updates: the app connects to `ws(s)://<API>/v1/live`, debounces `hazards.changed` hints into a
visible-bounds refetch, refetches on every (re)connect, and reconnects with capped backoff. While
the socket is down (or the backend does not serve it yet) it falls back to 5 s polling. Foregrounding
refreshes the feed, re-evaluates expiry and resumes the queue; a failed refresh keeps the last results
labeled stale. "Use my location" requests foreground permission only when tapped and reads one fix
(no continuous or background updates); denial leaves pin placement working.

Route comparison (slice A3): on the Route tab, tap the map to place the start (A) and destination
(B) pins, drag them to adjust, or use "Use my location as start" (one foreground fix, optional).
"Compare routes" posts exactly those two points to `POST /v1/route` and draws the shortest route
(grey, dashed when there is an alternative) and the lower-risk route (teal) with distance, time,
the 0–1 risk heuristic and how many reported hazards each crosses. The contract's `safest` kind is
only ever shown as "Lower-risk".

- Moving a pin clears the old comparison, and a response for an earlier pair is never displayed.
  Repeated taps share one in-flight request.
- `safest_available: false`, or two identical lines, is shown as one route with an explanation,
  never as two different paths.
- A 503 shows "Routing is unavailable right now" with retry; the map and report form keep working.
- A live `hazards.changed` hint marks an existing comparison as possibly out of date and offers a
  refresh. Queued reports do not affect routes until the server accepts them.
- When the server has no routing engine it answers with its fixed example and an
  `X-Stage-0-Stub` header; the app then labels the lines as examples that do not follow the pins.

The header line shows "Test server · reports are not kept when it restarts" only when `/healthz`
reports memory storage. Route state lives in `src/routes/model.ts` (tested in Node,
`tests/routes.cjs`) and the screen in `src/routes/RouteScreen.tsx`.

Dependencies (exact): `@react-native-async-storage/async-storage` 2.2.0 and `expo-location` 57.0.14.
A3 adds none.

Verification for A3: `npm test` passes (30 Node tests, 14 new), and CI's mobile job passes on the
pull request (`npm ci`, typecheck, tests, iOS and Android bundle export). No physical device has
run this slice. Still open: the hosted two-phone rehearsal (A4) with real routing over HTTPS, and
confirming automatic hazards render unchanged (A5). This is a comparison, not turn-by-turn
navigation.

HTTP deadlines cover response headers and JSON body consumption, including route comparisons.
A stalled body aborts after 15 seconds so a pending report can retry with its original identity.
The client regression test exercises a stalled body, timeout cleanup, retry, and route stub labeling.

## SDK 57 upgrade (2026-10-10)

After pulling the upgrade, stop Metro, reinstall from the lockfile and clear Metro's cache:

```sh
npm ci --prefix mobile
EXPO_PUBLIC_API_URL=http://YOUR_LAN_IP:8000 npm start --prefix mobile -- --clear
```

Scan the new QR code with an iPhone running Expo Go for SDK 57 on the same network.
A physical iPhone cannot install an older App Store Expo Go; a simulator or custom development
build is the alternative when its SDK differs. SDK 57 requires iOS 16.4 or newer.
Custom native builds need Xcode 26.4 or newer; bundle export does not require Xcode.

The selected exact SDK patches and security review are in [the upgrade handoff](SDK57-REVIEW.md).
The online Expo compatibility check currently recommends newer patch releases and TypeScript 6;
the pinned releases match the bundled SDK 57 compatibility manifest, and TypeScript 5.9.3 passes
our existing checks. Review upgrades before running `expo install --fix`.
Motion activity permission is explicitly disabled in the location plugin. The app still requests
only a one-shot foreground location when the user taps the location action.
