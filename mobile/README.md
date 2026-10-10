# Manual mobile app · stage 0

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
submission is disabled in fixture mode. The route screen shows fixed illustrative GSU routes.

For the live product stub, set the URL when starting Metro:

```sh
EXPO_PUBLIC_API_URL=http://YOUR_LAN_IP:8000 npm start --prefix mobile
```

Use your computer's LAN address on a phone (not the phone's localhost). The phone and API host
must share a reachable network; use HTTPS for hosted services. The backend listens on `0.0.0.0`.
Never put a publication key in this app or any Expo public variable.

Tap Report, place/drag a pin, choose a kind and submit. No location permission is needed. A failed
submission retains its original UUID, timestamp and body for explicit retry within that session.
Editing requires New draft. Draft, sending, submitted and failed are displayed; a persistent queued
state is not implemented. Closing the app loses unsent work. Accepted reports refresh every 5 s.

Lane A still owns persistent offline queuing, foreground-location convenience, reconnecting live
updates, destination selection and device polish. Routes remain stubs until Lane C supplies
Valhalla. A routing failure does not disable the map or report form.
