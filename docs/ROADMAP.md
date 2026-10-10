# MVP roadmap

Milestones below are the [README delivery checklist](../README.md#delivery-checklist), in order,
with owners and a demo gate added. This file tracks sequence and status only — acceptance criteria
live in each lane's plan; don't restate them here, and don't let this drift from them.

The first release ends after milestone 2 (the README's "first release" line). Automatic-track
milestones (3–4) can proceed in parallel once lane 0's contracts are agreed, per
[ARCHITECTURE.md](../ARCHITECTURE.md) and [decision 001](decisions/001-mvp-delivery-workflow.md).

## Current status and priority

Stage 0 contracts, fixtures and runnable skeletons are implemented, with scoped CI workflows.
See [the stage 0 handoff](STAGE-0-HANDOFF.md) for checks and limitations, including outstanding
physical-device smoke verification. Milestones 1–4 are not started. Next: Lane A/C manual persistence
and report queue work, with Lane G extending infrastructure. Stub routes do not complete milestone 2.

## Milestones

| # | Milestone | Owners | Depends on | Demo gate |
|---|---|---|---|---|
| 0 | Versioned contracts, fixtures, runnable skeletons | [Lane 0](lanes/0-contracts.md) | — | Every lane can build against a fixture without a live upstream service |
| 1 | Manual reporting, persistence, offline retry, live map — automation off | [Lane A](lanes/A-mobile.md), [Lane C](lanes/C-backend-api.md) | 0 | Report a hazard, see it on the map, survive a dropped connection |
| 2 | Product routing + HTTPS deploy of the manual backend | [Lane C](lanes/C-backend-api.md), [Lane G](lanes/G-infra.md) | 1 | Compare routes against live reports over HTTPS — **first-release cut line** |
| 3 | Automatic collection + hazard generation, validated against a fixture client | [Lane B](lanes/B-detection.md), [Lane D](lanes/D-automatic-hazards.md), [Lane F](lanes/F-simulator.md) | 0 (parallel with 1–2) | Detector/worker run independently; a fixture publisher validates the product HTTP boundary |
| 4 | Connect automatic publication; both sources on one map | [Lane D](lanes/D-automatic-hazards.md) ↔ [Lane C](lanes/C-backend-api.md) | 2, 3 | Manual and automatic hazards both render, correctly labeled, on the same map |

## Early CI/CD

Per [decision 001](decisions/001-mvp-delivery-workflow.md): CI is the routine gate, not a full
local suite per push.

1. **First CI task (docs-only, Lane G):** add relative-link and changed-file whitespace checks.
   Implemented in the stage 0 workflow; it checks the commit/PR diff rather than an empty checkout diff.
2. **At milestone 0:** contract/fixture validation and generated-type drift checks are implemented as path-filtered jobs.
3. **As each lane lands code:** add that lane's job (lint/build/test), scoped to its paths plus any
   shared contract it depends on, auto-cancelling superseded runs on the same branch.
4. **At milestone 2:** deploy the exact passing `main` commit, then check `/healthz` and the
   report/read flow over HTTPS. Keep deployment secrets in CI settings; retain the last working
   version for rollback. Deployment awaits the Vultr host, HTTPS hostname, and credentials.

Don't write a job for a component that doesn't exist yet.

## First PR sequence

1. Lane 0: contracts + fixtures, then runnable API/mobile skeletons and startup instructions;
   Lane G adds the corresponding CI checks in these first PRs (unblocks everyone).
2. Lane A and Lane C in parallel against lane 0's fixtures: manual report → persistence → map.
3. Lane G: HTTPS deploy of the milestone-1 backend.
4. Lane C: routing integration (milestone 2).
5. Lane B, D, F in parallel (can start as soon as lane 0 lands, independent of 1–2): detector →
   fixture-validated publication.
6. Lane D ↔ Lane C: connect real automatic publication (milestone 4).

Small PRs, `lane/<letter>-<name>` branches, rebase before opening — see
[AGENTS.md](../AGENTS.md#git--ci-workflow).

## Demo and cut line

Release only when milestones 0–2 work together: verify denied/unavailable location blocks new reports,
obtain current device location and submit over HTTPS, see it on a second phone, retry a queued report without a duplicate, and
compare shortest/lower-risk routes using that hazard with automation off. Rehearse with fresh demo
data and keep the deployed URL and launch steps in README. CI is the routine gate; this brief
on-device rehearsal checks integration rather than repeating every test locally.

Defer automatic milestones 3–4 if time is short. Abandonment detection, soft-penalty routing,
redundancy, broad edge-case hardening, and cosmetic polish do not block the manual MVP. A routing
stub or local-only backend is an intermediate demo, not completion of milestone 2.
