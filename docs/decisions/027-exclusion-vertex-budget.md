# 027. Bound hazard exclusions by vertex budget, and reduce hazard-circle resolution

- Status: Accepted
- Date: 2026-10-10

## Decision

`select_exclusions` stops adding hazard rings to a Valhalla `exclude_polygons` request once their
combined vertex count would exceed 100 (`MAX_EXCLUSION_VERTICES`), Valhalla's own
`max_exclude_polygons_vertices` limit, in addition to the existing 20-hazard count cap
(`MAX_EXCLUSIONS`). Hazard count alone does not bound payload size: each reported hazard's circle
buffer defaults to ~65 vertices, so as few as 2 hazards near a route already exceeded the limit and
every lower-risk route call failed with an engine 400, surfaced to riders as the generic
"Routing is unavailable" 503 per [decision 006](006-routing-errors-and-refreshed-hazard-snapshots.md).

A hazard skipped for exclusion by either cap still participates fully in both routes' risk scoring
and `hazard_ids` ([planner.py](../../backend/app/routing/planner.py) scores against every loaded
hazard, not just the excluded subset) — only which roads Valhalla is asked to avoid is capped, never
what a rider sees scored against a chosen road.

`report_area`'s circle buffer resolution is also reduced from Shapely's default 16 segments/quadrant
(~65 vertices) to 4 (~17 vertices). This is deliberate, not cosmetic: with the 100-vertex budget and
unchanged default resolution, `floor(100/65) = 1` — only a single hazard could ever be excluded at a
time regardless of the count cap, making multi-hazard lower-risk routing effectively dead on arrival.
At 17 vertices, `floor(100/17) = 5` hazards can be excluded together. The shape change applies only to
newly created reports; it does not rewrite existing stored hazard geometry.

## Rejected

Keeping the default buffer resolution and relying on the vertex budget alone: technically correct
(no more 400s) but reduces the exclusion feature to "only ever avoids the single nearest hazard,"
which is a worse outcome than the bug it fixes once more than one hazard exists near a route.

A fixed vertex-per-hazard allowance divided evenly across `MAX_EXCLUSIONS`: more complex than a
running total and provides no behavioral difference, since both stop accepting further hazards once
the shared budget is spent.

## Verification

`backend/tests/routing/test_routing.py`: `test_exclusions_capped_at_twenty_nearest` (unchanged,
small-vertex hazards still cap at 20) and `test_exclusions_capped_by_vertex_budget_not_just_count`
(high-vertex hazards modeled on the real circle buffer; asserts a non-empty, budget-respecting
selection) plus a scoring-independence case showing a budget-skipped hazard still contributes to
`risk_score`/`hazard_ids`. Full backend suite passes unchanged otherwise.

## Supersedes

None.
