# 024. Foreground live trip position and honest routing

- Status: Accepted
- Date: 2026-10-10
- Supersedes: decision 014's exclusion of ride tracking for foreground position display only;
  decision 020's one-shot-only trip display; the offline fixture-route presentation in Lane A.

## Decision

The operator requested that the app track the rider while following a route. Trip now displays
an independent live GPS dot and supports camera follow/recenter. The chosen start/destination
remain fixed: location updates never drag route pins or trigger a request per GPS sample.
Panning or editing endpoints pauses camera following; Recenter resumes it. The dot continues
moving while the map is free to explore. Leaving Trip disables camera following.

Reuse the foreground permission-aware watcher, with high accuracy, no minimum movement and 1 s requested
updates on Trip; OS delivery is not guaranteed at that cadence. Browsing checks existing permission
without prompting. Trip/Report and the explicit retry action can request foreground permission.
Pause and invalidate pending subscriptions/fixes on inactive/background. Recheck permission on
return. Surface denial and watch errors, with retry/Settings. Reject nonfinite/out-of-range,
older/out-of-order, over-50 m accuracy, and over-20 s old fixes. A stale dot disappears and the
camera stops following it until another usable fix arrives. Native permission text includes tracking.

Keep only the latest fix in memory. No motion permission, background service, ride recording,
server trace upload, accounts, or automatic-system dependency is introduced. Reports still use
their separate one-shot draft fix. Camera following reveals the viewed area through existing
basemap requests and hazard viewport queries; position is not otherwise uploaded by tracking.

The screenshot supplied with the request closely matches the fixed GSU route fixture, though
its runtime configuration was not supplied. Regardless of configuration, a selected destination
must never receive an unrelated example route. Both offline planning and a connected server's
fixture response now show routing unavailable without drawing example lines. Fixture hazards
and place search remain available. Real routing requires a reachable product API with Valhalla;
use the existing routing demo runbook. Do not change tile coverage based on an unverified theory.

## Limits and verification

This delivers live foreground position, not turn instructions, automatic rerouting, route progress,
or background navigation. Those require separate product work. Node tests cover freshness, watch
failure/lifecycle, independent markers, camera gesture/recenter behavior, and fixture rejection.
Physical-device checks still must confirm moving GPS, permission dialogs/Settings return,
background/resume, stale GPS, and map gestures on iOS/Android. No new dependencies or API changes.
