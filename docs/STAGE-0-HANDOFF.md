# Stage 0 handoff

Stage 0 supplies the shared boundary and independently runnable skeletons. The first release
still requires milestones 1–2. [Decision 002](decisions/002-stage-zero-contract-boundary.md) records
contract refinements and the limits of the stubs. Claude independently approved the contract
checkpoint before consumers were built; final skeleton review is recorded in the room handoff.

## What works

- Two versioned OpenAPI 3.1 contracts, live-message specification, 22 fixtures including expected
  failures, and reproducible TypeScript types checked into consumers.
- Product stub accepts reports without automation, preserves retry identity, rejects conflicts,
  filters bounds/expiry, and accepts authenticated revisioned automatic hazards without replacing
  manual ones. Emits change hints. Storage is explicitly memory only.
- Manual Expo app: map/source/evidence/expiry display, pin-based report form, in-session retry,
  route fixture preview. Runs with offline fixtures when no API URL is configured.
- Independent observation stub: events/points batch limits, UUID duplicates and atomic conflict
  rejection. Independent collector sends only simulated fixture data. Detector interface compiles
  and deliberately emits no events. Publication client uses the HTTP boundary.
- Compose starts only product API and PostGIS. Automation is not a startup dependency.
- CI jobs are scoped by lane/shared contracts and cancel superseded runs. No deploy job yet.

## Verification

Verified locally during implementation:

- Both OpenAPI specs and all 22 fixtures pass validation; invalid fixtures are rejected.
- Product: 10 tests; observation: 4 tests. Canonical request-schema parity, core retries/conflicts,
  expiry, revisions, source preservation, atomic batches and live-message shape covered. Expiry
  cleanup regressions verify that revived expired/resolved publications survive suspended notifications.
- Two mobile refresh regressions cover delayed submission after a pan and stale responses/errors.
  Both Expo apps typecheck and export iOS and Android bundles; dependency versions match installed
  Expo SDK compatibility metadata. Detector build and no-fabricated-evidence check pass.
- Actual Docker Compose build/start: healthy PostGIS and running API, no automatic container.
- Live HTTP probe: manual creation/retry, authenticated publication create/retry/update/stale
  rejection/resolution, preserved manual report, fixed route response.
- Independent observation HTTP health, event/point uploads and duplicate retries pass.
- Relative documentation links and whitespace checks pass.

Native exports are not a physical-device UI/permission test or signed binaries. A teammate still
needs to open the apps on SDK-55-compatible Expo Go/development builds and verify map rendering,
pin gestures and phone-to-host connectivity. CI results are separate from these local checks.

## How to run

Use the root [quick start](../README.md#stage-0-quick-start). Exact owning commands:
[contracts](../contracts/README.md), [backend](../backend/README.md),
[mobile](../mobile/README.md), [observation API](../automatic/service/README.md),
[collector](../automatic/collector/README.md), [detector](../automatic/detector/README.md),
[Compose](../infra/README.md).

## Remaining by owner

- A: persistent queued reports, location convenience, reconnecting live updates, route destination
  selection and device acceptance. In-session failures retain their ID/body; app restarts do not.
- C: database transactions and durable idempotency, real Valhalla planner and production health.
  The API ignores route coordinates and returns illustrative GSU lines, clearly labeled in the UI.
- B: signal detection, sensor permissions/recording, 100 m privacy trimming, upload queue, real rides.
- D: private observation DB, worker, clustering/decay, stable derived IDs and durable outbox.
- F: simulator scenarios/replay beyond the shared fixture publisher.
- G: TLS/Vultr/Valhalla deployment and automation profile with separate DB credentials.

Lane ownership resumes after handoff; shared contracts/schemas require coordinated changes.
