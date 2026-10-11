# Mobile interface guide

Working adaptation of the operator-provided Exhibitionist guide, 2026-10-10.
Borrow its consistency and interaction principles; its web palette, serif typography,
desktop density and legal-workbench layout do not apply to this app.

## Map first

The map extends behind the status bar to the top screen edge. Only the interactive controls
use the safe area, keeping them below the camera cutout and above the home indicator.
The measured bottom inset keeps map attribution above the task panel. A floating appearance icon and bottom task panel support it. The top icon has no card or
wordmark behind it; fixture mode stays explicitly labeled in the bottom panel.
The default panel occupies at most 36% of available height; details may expand to 65%
only by user action. Keep the map touchable around overlays. Provider attribution must
remain above the panel. The rebased UI uses MapLibre/OpenFreeMap. Its canvas ends above the measured task panel so attribution stays visible. Use the header sun/moon switch to change the UI and Positron/Bypass Night together without resetting the camera.

The resting home has one primary action: Where to? No marketing headline or explanatory
paragraph. Trip opens with From (Current location by default) and To fields that search
addresses and places; results show a name and address. There are no pin-mode buttons or
routine helper lines. Choose on map is a secondary option inside an open field (decision 020). Report opens by
requesting the device location, shows unselected categories, and reveals a single Submit after
a category is chosen; there is no placement hint or demo caption (decision 023). Route summaries show time, distance and reported-hazard count together.
Categories use a consistent pictogram with a short label. Supporting explanations belong
in expanded details; fixture warnings, failures and delivery states remain explicit.

## Shared primitives

- `src/ui/theme.ts` owns the Bypass film palette roles, light/dark values, font faces and shared
  geometry; `src/ui/mapColors.ts` holds the raw values shared with the map page. Do not import
  the web reference's colors or theme.
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

Source: the Bypass demo film. See [decision 026](../../docs/decisions/026-bypass-film-theme.md),
which supersedes the silver/cyan palette (016), the metallic texture (017) and Fiord (019).

| Role | Dark (film) | Light (day) |
| --- | --- | --- |
| Map ground / page | `#0B0D14` night | `#ECEEF2` paper |
| Panels | `#171A26` | `#F8F9FB` |
| Secondary controls, cards, fields | `#1E2231` with `#2C3146` edge | `#FFFFFF` with `#CDD2DE` edge |
| Text / supporting text | `#EDEFF7` / `#9AA1BB` | `#151829` / `#555C75` |
| Primary action | `#FFC533` amber, `#151829` label | `#F2A900` amber, `#151829` label |
| Selected control | `#EDEFF7` pill, `#151829` label | `#151829` pill, `#F8F9FB` label |
| Kicker and notices | `#FFC533` | `#7D5200` |
| Hazard zone on the map | `#FF6A55` | `#D64532` |
| Hazard source label and sheet edge | `#FF6A55` | `#C23A28` |
| Lower-risk route / shortest route | `#69F0D1` mint / `#FFE083` straw, dashed | `#005F73` teal / `#3A4160` steel, dashed |

Device appearance supplies the initial mode; the header switch overrides UI and map together for this session (decision 018).
There is no texture layer. One primary action per local group is amber; selection is the light pill, never amber.
Amber and red keep their meanings: amber is "act" or "selected hazard", red is "hazard". Do not use
either as decoration. Error foregrounds remain red exceptions (`#a00020` light / `#ffb4ab` dark).

On the map both hazard sources share the hazard red. The marker glyph and the text label carry the
source: a diamond with an exclamation mark for a community report, a pulsing ring for an automatic
hazard, and "Community report" or "Automatically detected · <evidence>" in the sheet. The lower-risk
line sits on a casing in the map's ground colour and glows; the shortest line is dashed.

Computed solid-colour pairs: dark ink on amber `#FFC533` 11.1:1 (8.8:1 on day amber `#F2A900`);
mist on panel `#171A26` 15.1:1; slate `#9AA1BB` on panel 6.8:1; dark ink on the light pill 15.3:1;
hazard label `#FF6A55` on `#1E2231` 5.6:1 and `#C23A28` on white 5.3:1; light-appearance kicker
`#7D5200` on `#F8F9FB` 6.5:1. These are calculations, not a full accessibility certification.

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

## Typography

Barlow Condensed ExtraBold, in capitals, for headings and route metrics; Barlow Condensed Bold, in
capitals, for button labels. Overpass SemiBold for values, inputs and errors; Overpass Regular for
captions. Overpass Mono SemiBold, in small letter-spaced capitals, for kickers, source labels and
facts. Select the actual font face through the shared theme; do not synthesize bold/italic
variants. Fonts are committed under `assets/fonts/` (SIL OFL 1.1); system text remains usable if
font loading fails. Map-provider labels stay in the tile provider's fonts.
