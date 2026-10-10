# Manual mobile app

## UI concept branch

The `lane/a-ui` concept uses a full map canvas with a compact header, an expandable bottom
panel and Map / Trip / Report controls. “Where to?” opens destination-pin placement;
select Set start or expand details for foreground location. Expanding reveals additional
controls and evidence; changing tasks collapses the panel while preserving trip/draft state.
Controls follow system light/dark appearance with silver and cyan-blue accents.
The shared icon and control system is described in the [mobile UI guide](docs/UI-GUIDE.md).

Run `npm start --prefix mobile` for the labeled fixture preview, or set
`EXPO_PUBLIC_API_URL` for live flows. The rebased concept uses main's MapLibre/OpenFreeMap renderer. Use the header sun/moon switch to change UI and map appearance; attribution stays above the task panel.
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
  switches to the bundled Fiord style on OpenFreeMap tiles, without resetting the viewport or overlays.
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

Tap Report: the app requests one foreground fix, you choose a category, and Submit appears once a category is selected (decision 023).
Location is required: denial offers Settings and retry; unavailable location offers retry. Report
markers cannot be placed or dragged. Refresh a fix older than 60 seconds; saving or backgrounding
with no lookup in flight clears it. Switching tabs preserves a fresh fix. Permission dialogs have
no deadline; after permission is granted, the position lookup times out after 20 seconds. Submit
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
labeled stale. Opening Report requests foreground permission and reads one fix
(no continuous or background updates). Denial blocks new reports; route endpoint pin placement remains available.

Route comparison (slice A3): choose endpoints as described under Trip search below; map points remain
a secondary option ("Choose on map").
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

## Trip search

Where to? or the Trip tab opens From and To fields. From is Current location by default: one
foreground fix when the trip opens, with "Try again" and "Search for a start" if location is
off. Tapping a field searches addresses and places through the product API. Results show a name
and address, and choosing one sets the endpoint, dismisses the keyboard and, once both ends are
set, compares routes. Typing clears the old point, late answers are ignored, and "Choose on map"
is the secondary option. The offline preview searches the fixture places. See `src/trip/` and
[decision 020](../docs/decisions/020-trip-address-search-and-current-origin.md).

## Hazard feedback

Tap a hazard pin to open its panel under the map. The panel shows the source, category, label and
expiry, and asks "Is this … still there?" with "Still there" and "No longer there". An answer shows
as sending until the server returns a receipt for that exact answer and hazard, and only then as
received. Failed answers can be retried with the identical body. The app sends one answer per
hazard per session, separate from the report queue (`src/feedback/`). The selected hazard has its
own coarse-grid lookup around its public geometry, independent of the map viewport. That lookup
refreshes on live hints, accepted feedback, foreground return and every five seconds while active.
Removal disables new answers but retains the details and receipt; a failed lookup shows a stale
notice, and local expiry still disables new answers.

The nearby watcher checks existing permission without prompting on launch or foreground return.
Opening Trip or using Report's location action can request permission; granting it immediately
rechecks the watcher. While the app is open with location permission, coming within 40 m of a hazard opens its panel
once per session, wherever the map is panned. The app looks up hazards for the ~500 m grid block
around the rider, separately from the map, so the server sees only that coarse block. This uses
foreground location only. Precise positions are never recorded, uploaded or sent with answers, and
an ignored prompt is not an answer. Answers can't be sent in fixture mode. Server-side effects are
in [decision 013](../docs/decisions/013-hazard-feedback.md).

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

### UI fonts

Start/build automatically fetch and verify Satoshi Italic and Light Italic from Fontshare.
A first build needs network access and Python 3; subsequent runs reuse verified local files.
See [font setup](assets/fonts/README.md) and [dependency review](docs/FONT-DEPENDENCY-REVIEW.md).

## Required report location (issue #23)

Run with the live API URL above and open Report; the location request starts automatically. New reports require a
fresh fix; existing queued reports resume without acquiring one. A successful save refreshes the
next draft location only while Report is still open and foregrounded. Both Report and Trip grants
activate nearby prompts immediately; browsing only checks existing permission. Route endpoint controls are
unchanged. No API changes or dependencies were added; fixture submissions remain disabled.

Verified locally after review fixes: TypeScript typecheck, 79 Node tests (including location gating, stale results,
expiry and queue identity after restart), documentation links, whitespace checks and iOS/Android bundle exports. Native
permission dialogs and Settings return still need physical-device verification:

- Deny permission: submission stays disabled, retry/Settings are offered, and map taps cannot
  place a report pin. Enable permission in Settings and retry successfully.
- Disable location services or let a lookup time out: retry stays available. Late results must
  not overwrite a newer fix. A successful report marker cannot be dragged.
- Let a fix age beyond one minute: the marker/coordinates disappear, Submit disables and a refresh
  prompt appears without another interaction. Switching tabs preserves a fresh fix. Backgrounding
  with no lookup in flight clears it; permission-dialog background/inactive events must preserve
  a pending lookup on both platforms. Leave the permission prompt open for over 20 seconds before
  allowing it: only the subsequent position lookup has a 20-second deadline.
- Queue offline, relaunch and revoke location permission: the saved report still retries with
  its original UUID/body. Route start/destination pins remain draggable without permission.

The hosted two-phone gate and native interaction checks remain pending; Node tests do not verify
OS permission prompts or native map gestures. CI remains the native bundle export gate.

PR #31 review fixes: controller-owned expiry/deadline timers, native-fix observation timestamps,
permission-dialog lifecycle handling, and fixture-mode location gating have deterministic regression
tests. The MapLibre report marker is read-only and absent without a fresh fix. Route pins retain
their existing behavior. No dependency or public API changes. Native Android/iOS permission dialogs
and Settings return remain unverified; automated lifecycle tests do not replace device checks.

## Report categories

The Report screen has no free-text field. Riders pick one of four categories (pothole or rough surface, obstruction, closed path or road, other), which map one-to-one to the API's `kind` values in `src/reports/categories.ts`; "Other" needs no explanation. The API's optional `description` is unchanged, so reports queued by earlier versions still send. Adding a category beyond these four needs a coordinated contract change.
