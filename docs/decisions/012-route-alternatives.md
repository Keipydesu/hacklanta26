# 012. Offer up to two alternative routes beside shortest and lower-risk

- Status: Accepted
- Date: 2026-10-10

## Decision

For [issue #34](https://github.com/Keipydesu/hacklanta26/issues/34), the baseline Valhalla request asks for
`alternates: 2`. The engine returns other roads in the same response, so this adds no extra request.
Each one is scored against the same final hazard snapshot as `shortest` and `safest`, and returned in
an optional `alternatives` array (`AlternativeRoute`, kind `alternative`, at most 2), ordered by risk and
then duration. An alternative is dropped when it is:

- the same road as a route already shown (Hausdorff distance under about 10 m);
- riskier than a shown route and no faster than it;
- outside the area hazards were loaded for, because unseen area is never scored as zero risk.

An alternative with equal risk that is slower is kept, because it shows a different road.
"Bad road" means an active hazard: manual reports and automatic roughness detections. No new data source.

`routes`, `safest_available`, every fallback and the 422/503 rules from decisions
[005](005-pedestrian-costing-and-route-fallbacks.md) and [006](006-routing-errors-and-refreshed-hazard-snapshots.md)
are unchanged. A malformed `alternates` payload is an invalid engine response (503), as in decision 006.

## Contract

The change is additive. Alternatives use a separate `AlternativeRoute` schema instead of a new `Route.kind`
value, because widening `kind` broke the mobile route screen's color lookup. Existing clients ignore the
field. Lane 0 approval is requested on the PR.

## Evidence

On local Valhalla 3.9.1 (campus extract, pedestrian costing), the three recorded GSU trips each
returned 2 alternates. `shortest` is the lowest-cost route under the step penalty, not always the
shortest distance: trips a and c had alternates 44 m and 27 m shorter. With a pothole reported on
trip a's baseline, `safest` became the 544 m alternate, which was then dropped from `alternatives` as a
duplicate. The response is recorded in `backend/tests/routing/fixtures/alternates-a.json`.

## Rejected

Separate exclusion requests per hazard subset (more engine calls with no rider-visible benefit yet), soft-cost
routing (OSMnx, already deferred) and widening `Route.kind`.

## Supersedes

None.
