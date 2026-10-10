# 003. Keep expiry mutations and viewport refreshes current

- Status: Accepted
- Date: 2026-10-10

## Decision

The single-process product stub removes all expired/resolved map entries before awaiting any
notification. It retains report/revision identity for retries. Never continue deleting from a
snapshot after yielding to publishers: a higher revision can reactivate an entry during that yield.
Notification hints may arrive after a refresh; clients refetch current state rather than treating
an expiry hint as an instruction to delete a hazard.

Mobile refreshes read the current viewport at call time, including refreshes from delayed report
submissions. Apply a response or error only if both its request order and viewport are still current.
A request counter alone cannot detect a newer request made by an old render's submit handler.

## Why

PR #1 review reproduced active hazard loss during expiry cleanup and old viewport data replacing
current hazards after a delayed submit. Regression tests preserve both concurrency invariants.

## Supersedes

None. No HTTP/schema or lane boundary changes.
