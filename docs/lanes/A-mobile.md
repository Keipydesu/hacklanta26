# Lane A: Mobile app

The rider's app: record a ride, see hazards, compare routes.

**Owns:** `mobile/` except `mobile/src/detection/`.
**Uses:** `createDetector` from Lane B, the REST API, optionally the WebSocket.

## What to build

1. **Permissions.** Ask for foreground location (`Location.requestForegroundPermissionsAsync`) and motion (`DeviceMotion.requestPermissionsAsync`) on first ride start. Show a plain-language reason before each prompt. Add the usage strings to `app.json`.
2. **Sensor feed** (`src/sensors/`).
   - `DeviceMotion.setUpdateInterval(20)` for 50 Hz. For each reading build a `MotionSample`: `accel` from `acceleration`, `gravity` as `accelerationIncludingGravity - acceleration`.
   - `Location.watchPositionAsync` with `Accuracy.BestForNavigation`, `timeInterval: 1000`, `distanceInterval: 0`. Map to `LocationFix`. Treat a missing or negative speed as `null`.
   - Keep the screen awake during a ride with `expo-keep-awake`. Sensors stop when the screen locks in Expo Go.
3. **Ride lifecycle** (`src/state/`). Start creates a fresh `ride_id` with `Crypto.randomUUID()` and resets the detector. Stop flushes uploads and discards the trailing buffer (step 5).
4. **Detector wiring.** Push every motion sample and location fix into the detector. On each `DetectedEvent`, convert to the API `Event` shape (snake_case, ISO timestamp, new UUID as `id`, `source: "device"`) and queue it.
5. **Privacy trimming** (`src/privacy/`). Do it as a stream so nothing sensitive is ever sent:
   - Do not upload anything until the rider is 100 m of path distance from the start.
   - Hold back a trailing buffer: only release points and events that are more than 100 m of path behind the current position.
   - On stop, throw the buffer away. That removes the last 100 m.
6. **API client** (`src/api/`). Typed with `types.gen.ts`. Batch points every 10 s, events immediately. Keep an offline queue in AsyncStorage and retry with backoff. Retries are safe because the server ignores duplicate event ids.
7. **Map screen** (`app/index.tsx`, `src/map/`). `MapView` centered on the rider. On region change (debounced about 500 ms) fetch `/v1/hazards` and `/v1/events` for the visible `bbox`. Draw hazards as `Polygon`, colored by `kind`. Draw events as small translucent `Circle` shapes rather than a heatmap layer.
8. **Route screen** (`app/route.tsx`). Origin is the current location. Long-press sets the destination. Call `POST /v1/route`, draw both routes as `Polyline`, and show a card for each with distance, time, and risk. When `safest_available` is false, say so instead of drawing two identical lines.
9. **Ride screen** (`app/ride.tsx`). Big start and stop button, current speed, events this ride, and a live readout of horizontal g. The readout is the fastest way to tune thresholds with Lane B.
10. **Recorder mode.** A hidden toggle that writes raw motion and GPS to CSV in the format described in `simulator/recorded/README.md`, then shares the files. Lanes B and F depend on these recordings.
11. **Demo mode.** A hidden toggle for the indoor judge demo, where there is no real speed and GPS is unreliable. It does three things:
    - Sets `demoMode: true` on the detector, which turns the speed check off.
    - Feeds the detector fixed location fixes at a configurable demo coordinate with good accuracy, instead of real GPS. Default to the spot in `simulator/scenarios/demo_seed.yaml`.
    - Bypasses the 100 m privacy trim, since the phone never moves.
    Show a visible "DEMO" badge while it is on.

## Watch out for

- Axis signs for `accelerationIncludingGravity` differ between iOS and Android. Test on one of each, and confirm the computed gravity vector has magnitude near 9.8 on both.
- In Expo Go the iOS map is Apple Maps. Stick to `Polygon`, `Polyline`, `Circle`, and `Marker`, which work on both platforms without a Google Maps key.
- Background location does not work in Expo Go. The demo runs with the phone mounted and the screen on. Do not spend time on background tracking.
- UI copy says "lower-risk route", never "safe route".
- `EXPO_PUBLIC_API_URL` must be HTTPS and reachable from the phone. `localhost` is the phone, not your laptop.

## Done when

- Start and stop a ride; events and points reach the API while riding.
- Airplane mode during a ride loses nothing once the connection returns.
- Map shows hazards and events for the visible area.
- Route screen draws both routes with stats.
- Recorder mode produces CSVs that Lane B's tests can load.
- Demo mode produces a pin on the dashboard from a hand jerk.
