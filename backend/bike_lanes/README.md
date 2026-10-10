# Campus bike-lane coverage

Street segments around Georgia Tech and GSU with bike-lane status, from OpenStreetMap. This is
infrastructure data, separate from hazard reports; it does not depend on the automatic service.
The mobile map bundles confirmed `present` segments as a mild static overlay
([decision 025](../../docs/decisions/025-static-bike-lane-map-overlay.md)). Route
scoring remains a follow-up, and bike-lane presence is not a safety guarantee. See
[decision 012](../../docs/decisions/012-osm-bike-lane-coverage.md).

| File | Contents |
|---|---|
| `import_osm.py` | Standard-library exporter (Overpass API) |
| `campus-bike-lanes.geojson` | All segments for both campuses, one feature per line |
| `sample.geojson` | One segment per campus/status/facility combination, for consumer tests |

## Refresh

```sh
python3 backend/bike_lanes/import_osm.py                              # current OSM data
python3 backend/bike_lanes/import_osm.py --date <extract timestamp>   # pinned snapshot, ISO 8601 UTC
```

Pass `--date` with the timestamp of the OSM extract that Valhalla and the basemap were built from,
so all three describe the same snapshot. The public Overpass server is often busy; the script
retries 429/5xx responses with backoff. A JSON `remark` aborts the refresh before either file
is written, even when HTTP status is 200; partial results are never accepted. Review the diff, rerun
`uv run --project backend pytest -c backend/pyproject.toml backend/tests -q`, and update the
spot-check below if facilities changed. Current files: OSM snapshot `2026-10-10T18:36:21Z`.
Regenerate the bundled mobile overlay with `npm run bike-lanes:generate --prefix mobile`, then run
`npm run bike-lanes:check --prefix mobile` before committing the refreshed export.

## Coverage boundaries

Bounding boxes (`minLon,minLat,maxLon,maxLat`) are the OSM campus outline bounds plus about 150 m
for adjacent streets. Every way intersecting a box is included whole, so lines can extend past it.

| Campus | Box | Outline source |
|---|---|---|
| `gatech` | `-84.4090,33.7670,-84.3842,33.7850` | relation 3341535 (Georgia Tech, Atlanta) |
| `gsu` | `-84.3923,33.7485,-84.3787,33.7610` | ways 586614408 and 1110422299 (GSU downtown) |

Included: `highway` = trunk, primary, secondary, tertiary (and their links), unclassified,
residential, living_street, cycleway; and path/footway/pedestrian with `bicycle=designated|yes`.
Excluded: `service` roads (all 942 were untagged in the October 2026 pull, so they added no
information), motorways, and other campuses.

## Data model

GeoJSON `[lon, lat]` LineStrings. Top-level `metadata` records source, license, attribution,
OSM snapshot, retrieval time and the boxes.

| Property | Meaning |
|---|---|
| `source_id`, `source_version`, `source_updated` | `osm:way/<id>`, OSM version and last edit time |
| `campus`, `name`, `highway`, `oneway` | Context from OSM tags |
| `bike_lane` | `present`, `absent` (confirmed no dedicated lane) or `unknown` |
| `facility` | For path ways only: `cycleway` or `shared_path`; otherwise null |
| `left`, `right` | For streets: `status`, `facility` and `oneway` (`cycleway:<side>:oneway`) per side; null for paths |

## Evidence rules

Per side, the most specific tag wins: `cycleway:left|right`, then `cycleway:both`, then `cycleway`.

| Tag value | Status | Facility |
|---|---|---|
| `lane`, `opposite_lane` | present | `lane` |
| `track`, `opposite_track` | present | `track` |
| `separate` | present | `separate` (the facility is its own way in this file) |
| `shared_lane` | absent | `shared_lane` (sharrow) |
| `share_busway`, `opposite_share_busway` | absent | `share_busway` |
| `shoulder` | absent | `shoulder` |
| `no`, `none`, `opposite` | absent | `none` |
| tag missing | **unknown** | null |
| any other value | unknown | the raw value |

- `opposite*` on plain `cycleway` describes only the contraflow (left) side.
- On a one-way street (`oneway=yes|1|true|-1`), bare `cycleway=lane|track` establishes
  segment-level presence but leaves unspecified sides `unknown`. Explicit side/both tags still win.
- Segment `bike_lane` is `present` if either side is present or the unsided one-way rule applies, `absent` only if both sides are
  confirmed absent, otherwise `unknown`. A missing tag is never treated as absence.
- `highway=cycleway` is `present` with facility `cycleway`. A designated or permitted shared path
  is `absent` with facility `shared_path`: bicycle infrastructure, but not a dedicated lane.

## Sources

| Source | Use | License | Retrieved | Notes |
|---|---|---|---|---|
| [OpenStreetMap](https://www.openstreetmap.org/copyright) via Overpass | Selected | ODbL 1.0; credit "© OpenStreetMap contributors" | 2026-10-10 | Same source as the Valhalla graph and the planned OSM basemap (#27); the only source that records absence and per-side detail |
| [ARC Regional Bike, Ped, Trail Inventory (2024)](https://services1.arcgis.com/Ug5xGQbHsD8zuZzM/arcgis/rest/services/Bike_Ped_Inventory_May2024/FeatureServer/90), layer "Existing Facilities" | Spot-check only | CC BY 4.0, Atlanta Regional Commission | 2026-10-10 | Lists existing facilities only, so it cannot confirm absence; last edited 2024-11 |
| City of Atlanta GIS | Not used | — | 2026-10-10 | No official current service found; only an unofficial 2019 copy (`COA_BikeLanes`) on ArcGIS Online |
| Google Maps bicycling layer | Rejected | Google Maps Platform terms | — | Display-only; terms forbid extracting data or using it with non-Google maps |
| Georgia Tech / GSU transportation maps | Not evaluated | — | — | Follow-up if OSM gaps on campus roads matter |

## Known gaps

- 616 of 961 segments are `unknown`: 387 of 626 at Georgia Tech, 229 of 335 at GSU. Most are
  residential and minor streets with no `cycleway` tags.
- Service roads, including some campus internal roads, are excluded.
- Buffered and protected lanes are both `lane`/`track`/`separate`; OSM buffer and separation tags
  are not exported.

## Spot-check (2026-10-10)

Each ARC existing facility, clipped to the campus box, was compared with OSM segments within 15 m.
This is a desk comparison between two datasets, not a field observation.

| Campus | ARC facility (type, year) | OSM result |
|---|---|---|
| Georgia Tech | Ferst Dr, Hemphill Ave (uphill lanes / downhill sharrows) | Agrees, per side: Hemphill Ave `left: shared_lane`, `right: lane` |
| Georgia Tech | 5th St, 6th St, State St, Means St, 3rd St NE, Marietta St (conventional/buffered lanes) | Agrees: `present`, `lane` |
| Georgia Tech | Spring St, W Peachtree St (protected/parking-side lanes) | Agrees: `present` (`track`, `separate`, `lane`) |
| Georgia Tech | Luckie St / Tech Pkwy (two-way cycle track), Atlantic Dr, EcoCommons (campus paths) | Agrees: `separate` sides and `cycleway` ways |
| Georgia Tech | 10th St, Holly St (multi-use paths) | Agrees on facility: OSM `shared_path` (status `absent` by the rules above) |
| GSU | Edgewood Ave, Decatur St, Auburn Ave, Peachtree Center Ave, John Portman, Park Pl, Central Ave, MLK Jr Dr, Trinity Ave | Agrees: `present` |
| GSU | **Washington St SW** (protected lane, 2023) | **Discrepancy:** only 34% matched; ways 9245544 and 583666182 have no cycleway tags (`unknown`) |
| GSU | **Capitol Ave SW** (buffered lane, 2023) | **Discrepancy:** 16% matched; the in-box section is `unknown` |
| Georgia Tech | — | **Discrepancy:** OSM tags a lane on Techwood Dr NW (234 m) that ARC does not list |
| GSU | — | **Discrepancy:** OSM tags a protected lane on Courtland St (about 500 m) that ARC does not list |

Unresolved discrepancies need a field check or an OSM edit; this export reports OSM as-is.
