# Mobile interface guide

Working adaptation of the operator-provided Exhibitionist guide, 2026-10-10.
Borrow its consistency and interaction principles; its web palette, serif typography,
desktop density and legal-workbench layout do not apply to this app.

## Map first

The map fills the working screen. A compact header and bottom task panel support it.
The default panel occupies at most 36% of available height; details may expand to 65%
only by user action. Keep the map touchable around overlays. Provider attribution must
remain above the panel. The rebased UI uses MapLibre/OpenFreeMap. Its canvas ends above the measured task panel so attribution stays visible. Use the header sun/moon switch to change the UI and Positron/Dark Matter together without resetting the camera.

The resting home has one primary action: Where to? No marketing headline or explanatory
paragraph. Route summaries show time, distance and reported-hazard count together.
Categories use a consistent pictogram with a short label. Supporting explanations belong
in expanded details; fixture warnings, failures and delivery states remain explicit.

## Shared primitives

- `src/ui/theme.ts` owns the operator's silver/cyan-blue palette, light/dark roles and shared
  geometry. Do not import the web reference's colors or theme.
- `src/ui/Icon.tsx` owns the dependency-free native pictograms. Map means explore, pin means
  endpoint/trip, circled exclamation means report, chevrons mean expand/collapse, and a
  crosshair means foreground location. Hazard categories have their own labeled pictograms.
- `ActionButton` owns touch sizing, selected, pressed and unavailable treatments. Containers
  own placement. Normally one action in a local group is primary.
- Icons supplement short labels. Icon-only disclosure has an action-specific accessible name
  and expanded state. Decorative geometry is hidden from accessibility.
- Ordinary controls have at least 48-point height. The disclosure target is 48 by 44 points.
  Do not copy the web guide's 24-point targets or 8–11px body typography.

## Light and dark color roles

Source: [selected Coolors palette](https://coolors.co/palette/353535-3c6e71-ffffff-d9d9d9-284b63).
See [decision 014](../../docs/decisions/014-silver-cyan-mobile-palette.md).

| Color | Role |
| --- | --- |
| `#353535` charcoal | Light-mode text; dark-mode surfaces |
| `#3c6e71` teal/cyan | Selected controls and lower-risk route accent |
| `#ffffff` white | Light surfaces; selected/primary and dark-mode foreground |
| `#d9d9d9` metallic silver | Dividers, dark-mode outlines and secondary foreground |
| `#284b63` deep blue | Primary action and light-mode notices |

Device appearance supplies the initial mode; the header switch overrides UI and map together for this session (decision 016). Silver secondary buttons and unselected hazard categories use the operator-supplied metal
grain at 22% opacity over silver, with charcoal labels in both appearances. Keep the map,
text, cyan selections and blue primary actions untextured. See [decision 015](../../docs/decisions/015-metallic-silver-texture.md). Selected controls retain accessible selected state and short labels.
White on cyan is 5.74:1; white on blue 9.22:1; charcoal on white 12.27:1; silver on charcoal
8.69:1. These are computed solid-color text pairs, not a full accessibility certification.
Error foregrounds remain red exceptions (`#a00020` light / `#ffb4ab` dark). Existing hazard
source colors stay separate from brand accents. Dark route lines use silver for the baseline
and a silver casing behind cyan to preserve visibility; OSM styling remains separate work.

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
