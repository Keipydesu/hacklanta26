# Lane A: Manual-first mobile app

Track 1: a Waze-style scooter hazard reporting app. It works with all automatic services switched off.

**Owns:** `mobile/` in full.
**Uses:** shared product API and fixtures from `contracts/`. No imports from `automatic/`.

## What to build

1. **Map and detail.** Expo + TypeScript, `react-native-maps`. Fetch `/v1/hazards?bbox=` for visible bounds; show polygons/markers and a detail card with kind, label, age, source, and expiry. Clearly distinguish community reports, automatic detection, and simulated/replayed evidence. Hide expired hazards locally.
2. **Manual report screen.** A large “Report hazard” button opens kind selection (`pothole`, `obstruction`, `closure`, `other`), a draggable map pin, and an optional 280-character description. Current location is a convenience; pin placement works when location permission is denied. Ask for foreground location only when requested. Generate a UUID once per submission and call `POST /v1/reports`.
3. **Submission states and retry.** Show draft, queued, sending, submitted, and failed states. Persist pending reports in AsyncStorage and retry with the same ID/body. Queued reports remain labeled locally, never presented as accepted server hazards. Successful retries must not duplicate markers; surface 409/422 for correction rather than endlessly retrying. Preserve the observation timestamp when offline.
4. **Live map and routes.** On `hazards.changed`, debounce a refetch of visible bounds. Refetch on WebSocket reconnect. Origin/destination selection calls `/v1/route`; draw shortest and lower-risk routes with distance/time/risk, explaining when no alternative is available. A routing outage must not block reporting or map browsing.
5. **Independent verification.** Use manual and automatic fixtures from day one. Run the manual report flow against the real backend with automation stopped. A standalone fixture publisher later adds automatic hazards without a mobile code change.

## Scope boundaries

- No motion permissions, ride start/stop, continuous GPS, sensor SDK imports, recorder mode, or detector integration in this release.
- Sensors and privacy trimming belong to Lane B's separate collector. If embedded collection is requested later, it is a new optional integration.
- No monitoring website or facilities UI. The mobile map is the product and demo display.
- `EXPO_PUBLIC_API_URL` points to the product API, never the observation service.

## Done when

- A user can place a pin and submit a report with location permission denied.
- With automation offline, a submitted report appears on a second phone and affects route requests.
- Offline retry preserves the report ID and creates one server report.
- The same map renders automatic fixture hazards with clear source labels and handles expiry.
- Mobile has no code or startup dependency on `automatic/`.
