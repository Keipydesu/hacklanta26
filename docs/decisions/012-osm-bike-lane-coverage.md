# 012. Campus bike-lane coverage comes from OpenStreetMap

- Status: Accepted
- Date: 2026-10-10

## Decision

Bike-lane coverage for Georgia Tech and GSU ([issue #29](https://github.com/Keipydesu/hacklanta26/issues/29))
is exported from OpenStreetMap by `backend/bike_lanes/import_osm.py` and checked in as GeoJSON.
OSM is the only source: the Valhalla graph is built from OSM, and the basemap is moving to OSM
(#27), so the map, routing and bike-lane data can describe one snapshot (`--date`).

Each segment is `present`, `absent` or `unknown`, per side and overall. A missing tag is `unknown`,
never `absent`. Bare lane/track tags on one-way streets establish overall presence without
inventing side-specific evidence; explicit side/both tags take precedence. Overpass error remarks
abort refreshes before either dataset is written, including HTTP-200 partial responses. Sharrows and shared-use paths count as `absent` (no dedicated lane), but keep
their own facility value. Evidence rules and coverage boxes are in
[the bike-lane README](../../backend/bike_lanes/README.md).

This is data only. Nothing consumes it yet; map styling and route scoring are follow-ups.
It does not change pedestrian costing ([decision 005](005-pedestrian-costing-and-route-fallbacks.md)),
and bike-lane presence is not a safety guarantee. No API or contract changes.

## Rejected

- **ARC Regional Bike, Ped, Trail Inventory as a primary or merged source:** it lists only existing
  facilities, so it cannot confirm absence, and its geometry does not match the routing graph.
  It is used for the spot-check.
- **Google Maps bicycling layer:** display only; its terms forbid extracting the data or showing
  it on a non-Google map.
- **Building from the Geofabrik extract with osmium:** adds a tool and a large download. Overpass
  with `--date` gives the same snapshot alignment for two small areas.
- **Service roads:** none were tagged in the October 2026 pull.

## Supersedes

None.
