# UI — working inspiration and design brief

Status: scooter/bike-first product direction agreed; visual design and implementation remain open.
Tracking: [UI #28](https://github.com/Keipydesu/hacklanta26/issues/28).
Started: 2026-10-10. Branch: `lane/a-ui`. Owner: Lane A for mobile implementation.

## What we are trying to improve

Help people get around campus by scooter or bike, with hazard awareness built into the trip.
The opening question is “Where are you going?” Route planning is the primary task; nearby hazards
and quick reporting add useful context and community value throughout that task.

Operator direction (2026-10-10): prioritize Waze and the Lime scooter app as inspiration, with
scooter/bike transit first and hazard mapping as an added benefit. Here, transit means getting
around by scooter or bike; public-transport schedules and multimodal transfers are not implied.
See [decision 014](decisions/014-scooter-bike-first-ui.md).

A successful home screen should still be useful when there are no hazard reports: riders can
choose endpoints and compare a trip. Hazard detail and reporting should be easy to reach without
displacing the destination and selected route.

The current app already implements reporting, a durable queue, live hazard refresh and route
comparison. This research builds on those behaviors. The question is how to make them easier to
understand and use, not how to replace them with an attractive static demo.

This is a living list: add references, challenge the analysis and narrow the direction before
implementation. Product observations below come from linked first-party documentation reviewed
on 2026-10-10. “Why it may work” and our adaptations are design hypotheses, not measured usability
results. No hands-on comparison or device screenshot review has been performed yet; detailed
claims about current spacing, gestures and platform parity remain unverified.

## Working inspiration list

| Reference | What to study | Relevance | Initial disposition |
| --- | --- | --- | --- |
| Lime | Scooter/bike identity and a clear next action on a map | Make the app feel built for short everyday trips | Primary trip-experience reference |
| Waze | A short category-based reporting flow | Add community awareness to a trip | Primary hazard-interaction reference |
| Transit | Nearby map/list pairing and live-data indicators | Useful information immediately, with honest freshness | Supporting information reference |
| Citymapper | Route choices named for rider priorities | Explain why someone would choose a longer route | Supporting comparison reference |
| Apple Maps | Trip context presented before committing to a route | Reveal practical obstacles at the decision point | Supporting reference |
| Google Maps | Route emphasis and travel-time labels | Connect a comparison card to its geography | Supporting reference; mobile visuals to verify |

### Lime: make scooter and bike travel the obvious purpose

**Observed:** Lime uses its map to find nearby vehicles, then lets riders select or scan a vehicle
to begin. It surfaces charge and approximate range before riding.
[Source: Lime's riding guide](https://www.li.me/how-to-ride).

**Why it may work:** The map has a concrete job and a clear next action. Information is tied to
whether the rider can make the trip, rather than presented as a general map database.

**Our adaptation:** Give the map one dominant trip-planning action: “Choose destination.” Use
scooter/bike language and iconography, a compact endpoint panel, and a clear transition into
route comparison. Keep the selected route prominent while hazard details open over the map.
Our equivalent of Lime's trip-readiness information is time, distance and reported hazards.
These layout ideas are proposals, not claims about Lime's exact current screen arrangement.

**Observed:** Lime also explains riding and parking zones through shaded areas, symbols and
interactive details. [Source: Lime zones](https://help.li.me/hc/en-gb/articles/360040206933-Navigating-riding-and-parking-zones).

**Why it may work:** Spatial constraints are understandable in the same place as the trip.
For our app, a hazard overlay can explain why a route choice matters without becoming the
whole screen. Keep routes legible through overlays, and let a tap reveal category and evidence.

**Limit:** Community hazards are not official riding restrictions. Do not style them as confirmed
no-go zones. Lime is a rental service; borrowing its clarity does not add vehicle inventory,
QR unlocking, payments, battery estimates or ride tracking to our product. Scooter/bike branding
also does not establish separate mode-aware routing: the current API has no travel-mode field.

**Check:** Can a first-time user identify this as a scooter/bike trip app and begin planning
without needing to understand or submit a hazard? Is that still true on an empty hazard map?

### Waze: make reporting a small, understandable task

**Observed:** Waze documents a report action followed by a hazard category and optional more
specific type. Its flow can send automatically after a delay.
[Source: Waze hazard reporting](https://support.google.com/waze/answer/13739290?hl=en-GB).

**Why it may work:** A visible contribution action avoids menu hunting. Recognizable categories
reduce the work of describing a problem and make the resulting reports more consistent.

**Our adaptation:** Explore a persistent “Report hazard” action opening a compact category picker.
Use an icon plus a short label for Pothole, Obstruction, Closure and Other. Keep an explicit submit
action and show whether location is ready before the user reaches it. Keep reporting usable while
stopped; speed of interaction is not a reason to encourage tapping while riding.

**Limit:** Do not copy timed automatic submission. Our queued and accepted states must stay
distinct. Current-location-only reporting and removal of free text are requested changes in
#23 and #24, not already implemented behavior. New categories require contract coordination.

**Check:** Can someone report the intended category and then correctly tell us whether it was
saved locally or accepted by the server?

### Transit: useful nearby information without setup

**Observed:** Transit combines a location map with nearby lines and departure times. It uses a
radio-wave indicator for real-time departures and lets users open an item for more detail.
[Source: Transit introduction](https://help.transitapp.com/article/93-how-to-use-transit).

**Why it may work:** The map answers “where?” while the list answers “what matters here?” A
freshness cue helps people distinguish current information from a schedule or older result.

**Our adaptation:** Keep a compact, expandable nearby-hazard list available beneath the primary trip controls. A selected hazard
should remain selected in both places. Show category, source and expiry in its detail view.
Keep “Showing earlier reports · Retry” visible when refresh fails, without clearing useful data.

**Limit:** A connected socket does not prove every hazard is accurate. Do not use “Live” as a
verification badge. Separate community reports, automatic evidence and local pending reports.
Sorting by proximity would need a defined reference point when location is unavailable.

**Check:** Can a rider connect a list item to its marker and notice stale data without opening a
settings page? Can they distinguish a pending report from a server hazard?

### Citymapper: explain the reason for each route

**Observed:** Citymapper's Routing Powers describe route choices through priorities such as
simplicity and step-free travel, rather than treating speed as the only preference.
[Source: Routing Powers](https://www4.citymapper.com/news/2296/introducing-routing-powers).

**Why it may work:** Naming the tradeoff gives people a reason to choose. It reduces the burden
of decoding multiple lines and numbers before understanding what differs.

**Our adaptation:** Present Shortest and Lower-risk as comparable cards with the same metric
order: time, distance, reported hazards crossed. Show an additional time difference when useful.
Keep the risk heuristic explained in details; do not convert it into a probability of injury.
Selecting a card should clearly identify its corresponding line.

**Limit:** We have two route kinds, not a general preference engine. Do not invent accessibility,
stairs, lighting or verified safety guarantees from our existing response. If the geometry is
identical or no alternative exists, show one route and explain why.

**Check:** Can someone explain the tradeoff in their own words, including that lower-risk is not
a guarantee? Does the comparison remain honest when both results are the same?

### Apple Maps: put relevant trip context beside the choice

**Observed:** Apple's cycling guidance describes route previews with elevation and road context,
plus choices to avoid hills or busy roads.
[Source: cycling directions](https://support.apple.com/en-gb/guide/iphone/iph431ac5856/ios).

**Why it may work:** Information is easier to act on when it appears where the choice is made.
People can assess a route before committing rather than discovering important context later.

**Our adaptation:** Keep the chosen endpoints and route summary together. Let riders inspect
hazards associated with the selected route without losing their comparison. Explore a compact
detail panel that expands only when more explanation is needed.

**Limit:** The panel is our proposed treatment, not a verified description of Apple's current
layout. Elevation and busy-road data are outside our response contract. Borrow the timing of
information, not unsupported attributes or a promise of turn-by-turn navigation.

**Check:** Can someone inspect a hazard and return to the same route selection without starting
over? Does an expanded panel leave enough map visible to understand location?

### Google Maps: connect route metrics to geography

**Observed:** Google's desktop directions guide describes an emphasized blue route, gray
alternatives and travel-time labels on the map.
[Source: directions and routes](https://support.google.com/maps/answer/144339?hl=en).

**Why it may work:** Visual emphasis provides a focal point; map labels connect a numerical
choice to the path it represents.

**Our adaptation:** Explore strong emphasis for the selected route and quieter alternatives,
with matching labels in the route cards. Preserve an explicit Shortest/Lower-risk legend.
Use line treatment and text as well as color so route selection remains understandable when
colors are difficult to distinguish.

**Limit:** This source establishes desktop behavior; inspect mobile screenshots before borrowing
layout or gestures. Muted lines still need adequate visibility over the chosen basemap. Keep
selection styling distinct from what the line means: selected does not mean lower-risk.

**Check:** Can riders identify the selected route at a glance and distinguish both routes at
campus zoom levels, including where their geometry overlaps?

## A direction to explore

### First runnable concept

Operator feedback supersedes the first stacked-screen concept: the map fills the working
screen, with a compact header and an expandable bottom task panel. The resting home shows
Where to?, a report count and compact icon/label navigation. Route cards show time, distance
and hazard counts side by side. Reporting uses a single row of labeled category pictograms.
Large headings and introductory paragraphs have been removed.

The user-provided Exhibitionist guide supplies consistency principles only: visual cues before
words, shared primitives, semantic states and contextual feedback. Its web colors, type and
layout are explicitly excluded. See [decision 015](decisions/015-map-first-mobile-controls.md)
and the [mobile adaptation](../mobile/docs/UI-GUIDE.md).

The current map renderer remains in place for the separate OSM migration. Report pins and the
optional description remain pending #23/#24; the description is in expanded details. TypeScript
and 39 mobile tests pass. The revised screens have been inspected in iOS Simulator; physical
hardware, Android, large text and full accessibility review remain outstanding.

Use Lime as the anchor for scooter/bike identity and a focused map task, and Waze as the anchor
for contributing and understanding community reports. The proposed journey is:

1. Open a campus map with a prominent “Choose destination” action.
2. Choose start and destination; show which endpoint the next map tap will place.
3. Compare Shortest and Lower-risk with time, distance and hazard context.
4. Inspect a hazard or report one, then return to the same trip context.

The current product supports map-pin endpoints, not destination text search. A search field is a
future concept requiring a place-search/geocoding choice; the first design must work with pins.
Do not show a working Scooter/Bike toggle until routing actually distinguishes the modes. The
existing pedestrian costing at scooter pace is a starting implementation, not proof of bicycle
suitability or bicycle-specific travel times.

Visual hypotheses: a quiet basemap, prominent paths and route geometry, large labeled controls,
and an energetic accent for the main action. Reserve hazard colors and source/evidence badges
for their meaning. Avoid filling the resting screen with warning colors or a long report feed.
The operator first selected silver/cyan-blue accents ([decision 016](decisions/016-silver-cyan-mobile-palette.md)),
then replaced them with the Bypass film palette and type; see
[decision 026](decisions/026-bypass-film-theme.md).

| Surface | Proposed hierarchy | States the design must include |
| --- | --- | --- |
| Trip home | Map → Choose destination → endpoint/route summary → nearby hazards and Report action | Loading, empty area, stale feed, offline fixture preview |
| Report | Category → location readiness → submit → delivery status | Draft, locating, permission denied, queued, sending, submitted, failed |
| Hazard detail | Category → source/evidence → observed time and expiry | Community, automatic, simulated/replayed/mixed evidence, expired selection |
| Compare | Endpoints → route cards → selected route details | Incomplete endpoints, loading, comparison, identical routes, outdated result, outage |

The selected first arrangement is a map home with compact task panels. Keep the implementation
on native primitives while exploring; no navigation or bottom-sheet dependency is required.

Some copy to test:

- “Saved on this phone — waiting to send.”
- “Report submitted.” Only after an accepted receipt.
- “Location is needed to report here. Try again.” For the proposed #23 flow.
- “Routing is unavailable right now. Try again.”
- “No distinct lower-risk alternative is available.”
- “Example routes — these do not follow your selected points.” For a stub response.

## Relationship to existing work

The checked-in [architecture](../ARCHITECTURE.md), [mobile plan](lanes/A-mobile.md) and
[mobile README](../mobile/README.md) remain the implementation references. This research does not
supersede them. Several open requests intentionally change that baseline:

| Issue | Relationship to UI work |
| --- | --- |
| [#23: current location for reporting](https://github.com/Keipydesu/hacklanta26/issues/23) | Design permission/readiness states around the requested flow; implementation must update the conflicting manual-pin guidance together. Route pins are separate. |
| [#24: categories and Other](https://github.com/Keipydesu/hacklanta26/issues/24) | Use existing categories in initial concepts and omit free text in the proposed reporting design. |
| [#25: hazard confirmation](https://github.com/Keipydesu/hacklanta26/issues/25) | Reserve a possible detail-view location; do not imply working feedback until API and lifecycle policy are defined. |
| [#26: missing routing engine](https://github.com/Keipydesu/hacklanta26/issues/26) | Clear copy accompanies a real runtime fix; design cannot turn illustrative lines into live routes. |
| [#27: OSM/MapLibre map](https://github.com/Keipydesu/hacklanta26/issues/27) | Test overlay visibility against the eventual basemap and preserve attribution. Engine/tile choice is separate from visual direction. |

Keep the manual app independent of automation. Preserve retry identity, source/evidence labels,
expiry and honest fixture mode. Use “lower-risk,” never “safe route.” Do not add a dashboard,
continuous tracking or unsupported API fields through a design concept.

## Questions for our next pass

1. How should Lime's focused trip experience and Waze's approachable community character combine
   in our visual identity?
2. Which destination-selection treatment makes map-pin planning obvious without suggesting
   text search already exists?
3. Are the compact task controls and expand/collapse affordance clear without instruction?
4. How much information should a hazard show before opening details?
5. What should the app show if a rider is offline and cannot obtain a fresh location for a new
   report? Resolve this alongside #23 without altering already-frozen queued submissions.

## How to extend and validate this list

For each new reference, record the app, exact screen/state, source and observation date; explain
the mechanism that helps the user, our adaptation, what would not fit, and a question to test.
Add screenshots with platform/version context when available. Keep visual observations separate
from documentation claims and subjective preference.

Next working steps:

- [x] Prioritize Lime and Waze from operator feedback; keep other references as supporting studies.
- [ ] Inspect current mobile screens and collect annotated reference screenshots.
- [x] Replace the stacked concept with a map canvas and compact expandable task panel.
- [ ] Walk through reporting, stale data, permission denial and route failure before polishing.
- [ ] Check small screens, larger text, screen-reader labels, touch targets and color-independent cues.
- [ ] Choose a direction and record the reasoning, then split implementation into small Lane A changes.

Research validation so far: repository brief and related issues reviewed; first-party sources
consulted. The first runnable concept is described above. No dependency change, physical-device test or
usability study is claimed; simulator evidence is recorded in the mobile guide.
