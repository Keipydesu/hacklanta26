# 007. Automation evaluation and outbox rules

- Status: Accepted
- Date: 2026-10-10

## Decision

Hazard evaluation is serialized by a session advisory lock taken before its REPEATABLE READ snapshot.
Derived state and outbox rows commit together; `evaluated_seq` advances in a separate statement and only
to the snapshot's `dirty_seq`. Outbox rows deliver in revision order per hazard with no DB transaction
across HTTP. 401/409/422 block that hazard (successors wait); a malformed 200 receipt retries. Operators
clear a block with `release` (same revision) or `rebase` (renumber above the product's revision).
Abandoned hazards compare no timestamps (their window slides with `now`) and the traffic scan runs on
the periodic tick only. One invalid candidate is skipped, never fatal for the pass.

## Why

A second review of #8 added: abandonment `evidence_source` now includes the qualifying neighbor cells' traffic (device baseline beside simulated diversion is `mixed`); `rebase` takes the evaluator's advisory lock and refuses during an in-flight delivery; the D4 probe only accepts a hazard on its own events' location that is new or changed. Code review of PR #13 found: republishing abandoned hazards every minute; a snapshot taken before the
lock; evaluation failures stalling delivery; unhandled receipt shapes stranding claims; and a 409 that
`release` alone could never resolve. Ingest still serializes on one `worker_state` row: a sequence would
not be transactional and could mark uncommitted work as evaluated, so the hotspot is accepted for the MVP.

## Supersedes

None.
