# Manual mobile app

Expo SDK 55 + TypeScript, React Native Maps. No sensor imports or motion permissions. Uses only
its local generated product types and copied fixtures; the automatic tree is not a dependency.
SDK versions follow the [Expo 55 compatibility table](https://docs.expo.dev/versions/v55.0.0/).

From the repository root (Node 22 LTS recommended):

```sh
npm ci --prefix mobile
npm run typecheck --prefix mobile
npm test --prefix mobile
npm run build --prefix mobile
npm start --prefix mobile
```

`build` exports iOS and Android JavaScript/Hermes bundles to `mobile/dist`; it does not create a
signed native binary. Open the development server using an SDK-55-compatible Expo Go or development
build. The refresh regression tests run in Node without a device. Both native bundle exports and typechecking have been verified; a physical-device visual
and interaction check is still needed.

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

Dependencies (exact): `@react-native-async-storage/async-storage` 2.2.0 and `expo-location` 55.1.14.
A3 adds none.

Verification for A3: `npm test` passes (30 Node tests, 14 new). `npm run typecheck`, `npm run build`
and on-device checks were **not** run for this slice (it was written without npm registry access);
CI's mobile job is the gate. Still open: the hosted two-phone rehearsal (A4) with real routing over
HTTPS, and confirming automatic hazards render unchanged (A5). This is a comparison, not
turn-by-turn navigation.
