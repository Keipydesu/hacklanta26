# 011. Require device location for new hazard reports

- Status: Accepted
- Date: 2026-10-10

## Decision

Per operator-requested [issue #23](https://github.com/Keipydesu/hacklanta26/issues/23), new mobile
hazard reports require a one-shot foreground device location. Remove manual report-pin placement
and dragging. Denied/unavailable location blocks submission with retry guidance; permission denial
also offers device Settings. Route endpoint pins and optional route location remain unchanged.

A draft fix expires after 60 seconds and is cleared on leaving Report, backgrounding, or saving.
Refreshing invalidates the prior fix immediately. A lookup times out after 20 seconds; late results
from cleared requests are ignored. These are conservative draft freshness limits, not a guarantee
of GPS accuracy or proof that a hazard exists at that position. No background/continuous tracking.

Persisted queue entries, including older manually positioned reports, keep their original UUID,
coordinates, timestamp and body across retries without acquiring location again. Product API
contracts do not change; the client requirement is not server-side location attestation.

## Supersedes

The manual report-pin fallback requirement in AGENTS.md, ARCHITECTURE.md, README.md, the Lane A
plan and mobile/rehearsal guidance. No earlier numbered decision is superseded. Decision number
010 is reserved by the concurrently active UI design worktree.
