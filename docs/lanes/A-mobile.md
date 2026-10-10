# Lane A: Manual-first mobile app

## Goal, baseline and ownership

Deliver a phone app that reports hazards, shows nearby reports and compares routes while every
automatic process is stopped. Follow [the architecture](../../ARCHITECTURE.md),
[roadmap](../ROADMAP.md) and [delivery workflow](../decisions/001-mvp-delivery-workflow.md).

For the UI design pass, lead with scooter/bike trip planning and use hazards as supporting trip
context. Lime and Waze are the primary references in the [working brief](../UI-INSPIRATION.md).
Follow [decision 014](../decisions/014-scooter-bike-first-ui.md): visual priority does not imply
new travel modes, rental integration, continuous tracking or a change to milestone order.
[Decision 015](../decisions/015-map-first-mobile-controls.md) makes the map the primary canvas,
with short labeled icons and expandable details; follow the [mobile UI guide](../../mobile/docs/UI-GUIDE.md).

**Owns:** `mobile/`. Consume only the product HTTP/live contract and local generated types/fixtures.
No imports from `automatic/`, sensor libraries, motion permissions, continuous location, ride
start/stop or recording belong in this release. Publication credentials never enter the app.
`EXPO_PUBLIC_API_URL` must point only to the product API, never the observation/automatic service,
including when Lane G supplies multiple service URLs for the hosted rehearsal.

Stage 0 is merged through [PR #1](https://github.com/Keipydesu/hacklanta26/pull/1) and already has Expo SDK 55, React Native Maps (since replaced by MapLibre GL JS in a WebView, decision 010), a pin form, source/evidence/expiry display,
in-session retry and illustrative routes. It polls every five seconds and has viewport freshness
regression tests. It has no durable queue, reconnecting live channel, current-location convenience
or selectable route endpoints. Build on those files; do not rebuild the skeleton or describe its
fixture routes as navigation. All new method names below are proposed internal interfaces.

The current mobile runtime is SDK 57; see [decision 009](../decisions/009-mobile-expo57.md)
for the Expo Go compatibility upgrade and device checks still required.

## Proposed structure and data flow

```text
mobile/
  App.tsx                      screen composition and shared selection
  src/api/
    schema.d.ts                checked-in generated product types
    client.ts                  HTTP transport and typed API adapters
    hazardRefresh.ts           current viewport/request ordering guard
    live.ts                    reconnecting change-hint subscription
  src/reports/
    model.ts                   draft/submission types and transitions
    storage.ts                 versioned AsyncStorage queue persistence
    queue.ts                   one serialized sender and retry scheduling
    ReportScreen.tsx           kind, pin, description and submission status
  src/map/
    bounds.ts                  viewport to product bbox
    HazardMap.tsx              polygons/markers and local queued overlays
    HazardDetail.tsx           source/evidence/time/expiry
    useHazards.ts              refresh, expiry and app lifecycle
  src/location/foreground.ts   one-shot foreground report location
  src/routes/
    model.ts                   selected endpoints/request state
    RouteScreen.tsx            comparison and failure state
  src/fixtures/                local generated/copied preview fixtures
  tests/                      queue/refresh behavior without a phone
```

User obtains current device location → editable draft → immutable submission persisted locally → sender → product
receipt → current-viewport refetch. A queued pin is a separate local overlay, never an accepted
server hazard. Server responses and change hints update the feed; expiry hides entries locally.
Route requests use selected origin/destination and the same product API, independently of form and
map request state. Route errors cannot disable report submission.

Keep state near its owning feature and use a small shared controller where report submission must
refresh the map. Do not add a global state library merely to split `App.tsx`. Add AsyncStorage and
foreground-location dependencies to the mobile manifest only, using the installed Expo-compatible
versions during implementation. No detector or observation client is needed.

## Required report location

[Decision 021](../decisions/021-required-report-location.md) supersedes permission-free report pin placement.
Only a device fix acquired for the current draft enables submission. A fix expires after 60 seconds;
refreshing revokes the old fix immediately. Saving or backgrounding with no lookup in flight clears
it; switching tabs preserves a fresh fix. Permission-dialog background events preserve the pending
lookup. A 20-second position deadline starts after permission is granted; late results cannot
replace a retry. Expiry publishes a refresh prompt immediately and is rechecked before saving.
The observation timestamp is the device fix time. See [decision 022](../decisions/022-report-location-lifecycle.md).
No map tap/drag sets a report point. Route endpoint selection remains unchanged. Queue retries
never request location or replace the original body, including reports saved before this change.

## Report model and durable queue

A draft has editable kind and optional description; its point comes only from a current one-shot device fix. On submit, validate current coordinates,
kind and 280-character plain text limit; create the UUID and observation timestamp once, then freeze
the complete product request. State belongs to the submission, not to whatever form is now open.

| State | Meaning and transition |
|---|---|
| `draft` | Editable, not yet queued or accepted. Submit freezes one body and persists it before network I/O. |
| `queued` | Durable pending body, waiting for connection/retry. Display explicitly as pending locally. |
| `sending` | One active request for the persisted body. On restart, recover this record as queued because server outcome may be unknown. |
| `submitted` | Received successful 201 or duplicate 200 receipt. Persist receipt or remove pending work durably before allowing queue advancement. Refresh feed using current bounds. |
| `failed` | Validation/conflict or a surfaced retry failure. Store reason and whether exact-body retry remains possible. Correction after definitive rejection creates a new draft/submission UUID; unknown outcomes require exact retry first. |

Use a versioned queue envelope keyed by submission UUID, containing immutable body, state, attempts,
next retry time and optional receipt/error. Serialize storage writes and network sends through one
controller. If persistence fails before sending, show failure and keep the draft; do not imply it is
queued. If the server accepts but local receipt persistence fails, resending the original body is
safe through server idempotency. Never remove pending work on a transport timeout or unknown result.

| Proposed method | Implementation and behavior |
|---|---|
| `freezeSubmission(draft, now, uuid) -> Submission` | Require a current device fix and normalize optional description; capture device point and observation time once. Return immutable body and queued metadata. |
| `loadQueue() -> QueueSnapshot` | Parse versioned AsyncStorage data. Recover sending entries to queued, preserve original bodies/times and surface unreadable data rather than silently discarding it. Small version migrations must retain IDs. |
| `persistQueue(snapshot) -> Promise<void>` | Await serialized writes. Update durable metadata before scheduling dependent work; report storage errors to the form/controller. |
| `enqueue(draft) -> Promise<SubmissionId>` | Freeze and persist before scheduling the sender. Disable duplicate submit taps during creation; one press/retry cannot mint several UUIDs. |
| `drainQueue(trigger) -> Promise<void>` | Single-flight loop sends due queued items. At startup, network restoration, foreground return and explicit retry, reuse the same immutable body. Avoid concurrent timers/drains for the same ID. |
| `classifyFailure(error) -> Retryable or Terminal` | Transport timeout, 408, 429 and temporary server errors get bounded exponential backoff with jitter. 409/422 and other permanent 4xx surface terminal failure. Honor a valid retry delay when supplied; cap repeated attempts and show explicit retry. |
| `applyReceipt(id, receipt) -> Promise<void>` | Verify response belongs to the sending item, durably complete pending state, show submitted and request current-bounds refresh. Duplicate success is equivalent to first success. |
| `newDraftFromFailure(id) -> Draft` | Copy editable values but do not mutate or silently reuse the failed submission body. Allow this only after a definitive rejection; an exhausted retry budget or lost response has an unknown server outcome and must retain the original UUID/body until reconciled by exact retry. Explicit corrected submit after rejection gets a new UUID. |

Keep the observation timestamp when offline, including across days. An already-expired submission
can be accepted by C but absent from the active feed; explain the accepted-but-expired result rather
than inventing a server marker. Never claim delivery merely because the phone regained connectivity.
The queue does not require background execution guarantees: drain while the app is active and resume
on next launch. Background ride tracking is outside scope.

## API, map and live methods

Keep `client.ts` typed from the local generated schema. Add request timeout/cancellation and
structured API error handling without changing public endpoint shapes. `getHazards(bbox)`,
`submitReport(body)` and `getRoutes(origin, destination)` target `EXPO_PUBLIC_API_URL` only.

| Method | How it works |
|---|---|
| `regionToBounds(region) -> Bbox` | Convert latitude/longitude deltas to `minLon,minLat,maxLon,maxLat`, clamp world bounds and preserve the API's increasing-bounds rule. Handle unsupported antimeridian views explicitly rather than sending reversed bounds. |
| `refreshHazards(reason) -> Promise<void>` | Read current region at call time, assign request generation, fetch and apply success/error only if both request and viewport are still current. Preserve stage-0 decision 003 regressions, including delayed submit after pan. Abort superseded requests as an optimization, not the only correctness guard. |
| `visibleHazards(feed, now) -> Hazard[]` | Filter active and unexpired entries on render/timer and immediately on foreground return. Retain source/evidence/count fields; never infer source from kind or geometry. |
| `connectLive(url, onChange) -> dispose` | Connect product WS/WSS matching HTTP/HTTPS, debounce change hints into a visible-bounds refetch, refetch on reconnect, retry with capped backoff and close sockets/timers on disposal. Ignore malformed hints safely. |
| `onForeground()` | Refresh current bounds, reevaluate expiry, reconnect as needed and resume queue. If live remains unavailable, retain a documented foreground polling fallback with one timer. |
| `locateOnce() -> Point or PermissionResult` | Request foreground location only after the user asks to use their location, or when a trip is opened to resolve the Current location origin (decision 020). New reports require the returned device point; denied/unavailable position blocks report submission with retry/Settings guidance and leaves trip address search usable. Only route endpoints retain manual pin placement. Do not start continuous updates. |

Show cached/last successful feed with an offline/stale indicator on transient refresh failure.
Live hints are not authoritative deletions: an expired hazard may have been republished before the
hint arrives. Always refetch. Do not let stale errors replace a newer successful viewport result.
Detail shows kind, label, community versus automatic source, simulated/replay/mixed evidence where
present, age and expiry. Scores are routing heuristics, not probabilities or verified severity.

Retain visibly labeled fixture preview when no API URL is configured: timestamps shift once per
preview session, report submission remains disabled, and routes remain explicitly illustrative.
An unavailable configured API must show a connection error; do not silently fall back to fictional
successful submissions or fixture data that appears live.

## Routing flow and methods

The origin defaults to Current location (one foreground fix when a trip is opened), and either endpoint can be set by address/place search through `GET /v1/places`; map points remain a secondary choice (decision 020). `src/trip/` holds the endpoint model, the debounced search and the From/To fields.
`requestRoutes(origin, destination)` posts both selected points and keys request state by that pair.
When endpoints change, invalidate the displayed comparison and suppress stale responses just as for
viewport reads. Disable the route action until two valid points exist, independently of reporting.

`presentRoutes(response)` draws separate shortest and lower-risk styles and displays distance,
duration and risk heuristic with a clear legend. Contract kind `safest` remains an internal value;
copy says “lower-risk.” If `safest_available` is false, explain that no alternative is available and
avoid presenting duplicated geometry as two different paths. If both successful routes happen to
share geometry, show the result honestly. A 503 shows routing unavailable with retry while the
hazard map and report form remain functional. This is comparison, not turn-by-turn navigation.

A new hazard hint refreshes the map and marks an existing comparison as potentially outdated;
allow a refresh for the unchanged endpoints, with one in-flight request and debouncing if automatic
refresh is used. Local queued reports do not influence routing until accepted server-side.

## Implementation slices and acceptance

1. **A1 — Extract feature seams and durable reporting (milestone 1).** Build on stage-0 screens,
   require current device location for new reports per decision 021, add queue model/storage/controller and explicit five states.
   Exit: kill/relaunch after queueing or an unknown send outcome, then retry with exactly the same
   ID/body and obtain one server report. Use a fake transport for development without C persistence.
2. **A2 — Live map and location convenience (milestone 1).** Add current-bounds refresh integration,
   reconnecting live channel, foreground lifecycle and one-shot location. Exit: deny permission and verify reporting is blocked,
   enable permission and retry location, submit and observe on another phone, reconnect after a missed change and hide expiry. Run
   against C with automation stopped; preserve delayed-submit/pan regression checks.
3. **A3 — Selectable route comparison (milestone 2).** Add endpoint state and typed route request,
   geometry/metrics/fallback/error views. Use fixtures while C develops the planner. Exit: real
   hosted routes respond to accepted manual hazards; outage affects only comparison. Fixture UI
   completion alone does not meet the milestone gate.
4. **A4 — Hosted release rehearsal (milestone 2).** G supplies product HTTPS, C durable reports and
   Valhalla. Verify two physical devices, denied permissions, offline restart/retry, live reconnect,
   expiry and route comparison with all automatic processes stopped. Document platform/network
   results and remaining issues; native bundle export is not device verification.
5. **A5 — Combined-source confirmation (milestone 4).** F's fixture publisher first, then D's worker,
   adds automatic hazards without app changes. Confirm source/evidence and resolution/expiry.
   Do not add automatic service startup dependencies or sensor imports to make this demonstration.

Dependencies are fixture-friendly: A1–A3 can progress against stage-0 contracts; durable live gates
need C, hosted gates need G, combined evidence needs F/D. If an API gap appears, propose a coordinated
contract change rather than editing generated types or `backend/app/schemas.py` locally.

## Validation and handoff

Existing stage-0 commands from the repository root:

```sh
npm ci --prefix mobile
npm run typecheck --prefix mobile
npm test --prefix mobile
npm run build --prefix mobile
EXPO_PUBLIC_API_URL=http://YOUR_LAN_IP:8000 npm start --prefix mobile
```

Add queue behavior cases to the existing test setup; test lost receipt/restart, duplicate submit,
terminal conflict and exact retry identity using fake storage/transport and a controlled clock.
Include an accepted request whose response is lost through retry exhaustion: correction must not
create a second submission while the original outcome is unknown.
Keep refresh regression tests. Cover reconnect refetch and route stale-response/fallback behavior
without live upstreams. Run typecheck plus the changed behavior checks locally; CI remains the
routine full lane gate. Bundle export writes output and requires the stick in a shared room.

Run device checks on SDK-57-compatible Expo Go/development builds. Verify both Positron and Dark Matter
map themes (decision 011), switching without losing the viewport or overlays, airplane-mode fallback,
map gestures, pin drag, attribution links opening in the browser, keyboard/form,
permission denial, screen reader/status text, connection recovery and both platform renderings where
devices are available. `npm run build` produces JS/Hermes exports, not signed binaries or proof that
permissions work on-device. Use phone-reachable LAN URLs locally and G's HTTPS URL for hosted tests.

Handoff records what works, exact app/API revisions and launch URL, commands and devices actually
checked, retry IDs/receipts, outage behavior, and remaining stubs. Do not remove fixture warnings
until the corresponding live capability exists. Defer accounts, cross-source merging,
continuous tracking, motion detection, dashboard and cosmetic polish beyond the manual release.
