# 006. Routing errors and refreshed hazard snapshots

- Status: Accepted
- Date: 2026-10-10

## Decision

Only a well-formed Valhalla HTTP 400 with integer error code 442 is recognized as no path.
The baseline maps that outcome to 422; the exclusion call falls back to the baseline with
`safest_available: false`. Other HTTP 400s, malformed error payloads, and nonfinite route metrics
are operational failures and return 503. Do not classify unknown engine failures as rider input
errors or silently degrade them to a successful comparison.

Every expanded search queries the complete union envelope at a fresh evaluation time. Replace
the prior snapshot, including removal of absent hazards; use that last complete snapshot for
both candidates' risk scores and the next exclusion pass. Do not union records from different
lifecycle snapshots or hold a database transaction open during Valhalla requests. Changes after
the last query are handled by live hints and a new route request, not an atomic cross-service read.

## Why

PR #12 review reproduced a valid two-point request receiving an engine configuration error as
rider-facing 422, malformed upstream data escaping as 500, and removed hazards surviving a
full-envelope reload. The operator requested fixes with Codex implementing and Claude reviewing.

## Supersedes

[Decision 005](005-pedestrian-costing-and-route-fallbacks.md)'s generic rejected-request fallback
and baseline rejected-location classification. Its costing, riskier-detour fallback and coverage
rules remain unchanged. Rejecting all unknown engine errors as operational avoids an unverified
list of supposedly rider-correctable codes.
