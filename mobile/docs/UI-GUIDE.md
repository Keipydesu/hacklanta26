# Mobile interface guide

Working adaptation of the operator-provided Exhibitionist guide, 2026-10-10.
Borrow its consistency and interaction principles; its web palette, serif typography,
desktop density and legal-workbench layout do not apply to this app.

## Map first

The map fills the working screen. A compact header and bottom task panel support it.
The default panel occupies at most 36% of available height; details may expand to 65%
only by user action. Keep the map touchable around overlays. Provider attribution must
remain above the panel. The OSM migration owns the renderer; these controls surround it.

The resting home has one primary action: Where to? No marketing headline or explanatory
paragraph. Route summaries show time, distance and reported-hazard count together.
Categories use a consistent pictogram with a short label. Supporting explanations belong
in expanded details; fixture warnings, failures and delivery states remain explicit.

## Shared primitives

- `src/ui/theme.ts` owns mobile color roles and shared geometry. Preserve the app's green
  identity; do not import the web reference's colors or theme.
- `src/ui/Icon.tsx` owns the dependency-free native pictograms. Map means explore, pin means
  endpoint/trip, circled exclamation means report, chevrons mean expand/collapse, and a
  crosshair means foreground location. Hazard categories have their own labeled pictograms.
- `ActionButton` owns touch sizing, selected, pressed and unavailable treatments. Containers
  own placement. Normally one action in a local group is primary.
- Icons supplement short labels. Icon-only disclosure has an action-specific accessible name
  and expanded state. Decorative geometry is hidden from accessibility.
- Ordinary controls have at least 48-point height. The disclosure target is 48 by 44 points.
  Do not copy the web guide's 24-point targets or 8–11px body typography.

## State vocabulary

| State | Visible treatment |
| --- | --- |
| Selected | Outline/tint and native accessibility selected state |
| Unavailable | Disabled control plus a nearby reason; opacity is supplemental |
| Comparing/sending | Local progress label; unrelated map/task controls remain usable |
| Queued | Pending count plus per-report state in expanded details; not accepted |
| Submitted | Receipt-backed status, never inferred from regained connectivity |
| Failed | Persistent error and appropriate retry/correction control |
| Stale | Explicit freshness warning; retained results must not look freshly loaded |
| Fixture | Persistent demo label; illustrative routes explicitly do not follow pins |

Changing tasks collapses the panel and resets its scroll position, while endpoint choices,
comparison and report draft remain in their owning state. Expanding is presentation only.
No timed submission, hidden tracking or fake search field is introduced.

## Current review evidence and remaining work

On iPhone 17 Pro / iOS 26.1 Simulator with Expo Go 57.0.9: inspected Map, placed two
route pins, rendered a fixture comparison, expanded/collapsed details and opened reporting.
The category picker and disabled demo-submit reason fit in the compact panel. Screenshots
show simulator fixture data, not a physical ride, production service or the future OSM map.

Remaining: Android and physical-device review, larger text, screen-reader navigation,
keyboard behavior on small screens, live offline/queue/error-state visual checks. The current
report location and optional description remain pending the separate #23/#24 work.

Known follow-up: inherited location/storage errors still share an app-level error area inside
the panel; move each error beside its owning remedy when splitting the report/location UI.
Do not hide those errors just to make the panel quieter.
