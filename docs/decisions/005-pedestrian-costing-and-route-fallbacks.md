# 005. Pedestrian costing and route fallback rules

- Status: Accepted
- Date: 2026-10-10

## Decision

Routing uses Valhalla `pedestrian` costing (16 km/h, step penalty 600), not `bicycle`. The baseline
(`shortest`) is the unexcluded route under that costing. `safest` excludes active, unexpired hazards
with score >= 0.4 from both sources (nearest 20 to the baseline route, never ones touching an
endpoint), and both routes are scored against every loaded hazard, including sub-0.4 ones.

Fallbacks: if the exclusion request finds no path or is rejected, return the baseline for both kinds
with `safest_available=false`; if the alternative scores riskier than the baseline, do the same. A
baseline with no path or rejected locations is HTTP 422. An engine outage, bad response, or a route
that leaves the area hazards were loaded for (after one widening) is HTTP 503; unseen area is never
scored as zero risk.

## Why

Same-engine comparison on three GSU trips: pedestrian vs bicycle 0.588/1.459 km, 1.197/1.180 km,
0.501/0.506 km. Bicycle costing detoured 2.5x on trip a and was no better elsewhere. Code review of
the first routing PR found that treating every Valhalla 400 as an outage, ranking exclusions by the
straight line, and labelling a riskier detour "safest" were all wrong.

## Rejected

Bicycle costing; Valhalla's own shortest option (drops the intended step penalty); treating all 400s
as no-path (hides misconfiguration).

## Supersedes

None.
