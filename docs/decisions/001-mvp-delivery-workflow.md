# 001. MVP delivery workflow for the hackathon

- Status: Accepted
- Date: 2026-10-09

## Decision

This is a hackathon project. The goal is a functioning demo, not exhaustive coverage. Delivery
follows these rules:

- **CI is the routine validation gate, not full local test runs per push.** Push small, let CI
  check it. Don't block local iteration on running a full suite before every push.
- **Short lane branches, small PRs.** `lane/<letter>-<name>`, rebase before opening, merge quickly.
  Keep `main` demoable at all times.
- **Local checks stay scoped to changed behavior and core demo blockers.** Defer non-blocking edge
  cases; a working golden path beats a hardened one for this timeline.
- **No fabricated CI against components that don't exist yet.** Add a lane's CI job when that
  lane's manifest/build actually exists. Don't write pipeline steps for code that isn't there.

## Why

Operator direction (2026-10-09, Talking Stick room): prioritize fast iteration and a working app
over per-push local verification and edge-case hardening.

## Supersedes

None. This is the first decision record.
