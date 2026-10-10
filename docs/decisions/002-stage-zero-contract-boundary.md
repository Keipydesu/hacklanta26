# 002. Stage zero contract boundary and stubs

- Status: Accepted
- Date: 2026-10-10

## Decision

The checked-in OpenAPI files are the canonical HTTP schemas. Generated TypeScript types live in
each consumer so the manual app can build without the automatic tree. Python models must match
these contracts; fixture and behavior validation guard the boundary. Do not silently change the
contracts to accommodate implementation after handoff.

Resolve initially unspecified details consistently:

- UUIDs identify submissions/observations; revisions are positive integers starting at 1.
- Require timezone-aware timestamps and finite, nonnegative observation measurements. Unknown
  speed stays internal to the detector; the collector must wait for valid measurements before upload.
- Omitted manual descriptions normalize to an empty string for retry identity.
- Empty observation batches succeed with zero counts. Conflicts, including within one batch,
  reject all writes. Point UUIDs are globally unique; their identity includes the path's ride UUID.
- Bounding boxes must have increasing minima/maxima; antimeridian crossing is unsupported.

Stage 0 uses isolated, nonpersistent memory stores, a fixed illustrative route response, a no-op
detector, and fixture-only collector. No persistent queues, sensors, outbox, risk worker, or actual
navigation are claimed. Compose starts product API and PostGIS only; the stub does not yet use DB.
These limitations must be visible in startup docs and app copy. They do not satisfy milestones 1–2.

## Why

A stable, testable boundary lets lanes implement independently. Inventing placeholder persistence,
sensor behavior, or navigation would hide missing work and confuse the milestone demo gates.

## Supersedes

None. Refines the existing architecture without changing its manual-first scope or HTTP endpoints.
