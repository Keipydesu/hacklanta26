# 024. Static OSM bike-lane map overlay

- Status: Accepted
- Date: 2026-10-10

## Decision

The manual app bundles the `present` bike-lane segments from the checked-in OSM campus export
([decision 012](012-osm-bike-lane-coverage.md)) as one geometry-only MapLibre source. A muted line
appears on the map in both light and dark themes, beneath hazards and routes. It is non-interactive,
reappears after every style load (including the offline blank fallback), and credits OpenStreetMap
contributors. A deterministic generator and check keep the mobile asset aligned with the source.

Only confirmed `present` segments are drawn. `unknown` is not absence; neither status is shown as
a safety judgment. The overlay covers the Georgia Tech and GSU export area only and can differ from
the separately built basemap and Valhalla graph. It sends no new location request and changes no
route costs, hazard scores, API contract or publication behavior.

## Rejected

- Fetching bike lanes through a new product endpoint for this small static dataset.
- Drawing unknown or absent segments as though they were verified lanes.
- Making route risk or safety claims from this unvalidated coverage.
