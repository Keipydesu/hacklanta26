# Campus scooter hazard map — agent instructions

A manual-first mobile app: riders report hazards, see nearby reports, and compare routes.
An independently developed automatic detection system later publishes detected hazards through the
same backend. This file is the standing brief for every agent. `CLAUDE.md` is a symlink to it —
edit this file, never create a second copy of its rules.

## Before you plan anything

1. **Read [ARCHITECTURE.md](ARCHITECTURE.md) in full.** It holds the API boundary, data model,
   routing design, environment variables, and acceptance criteria — the actual product contract.
2. **Read [README.md](README.md)** for scope, the delivery checklist, and the scope decisions
   (what is explicitly out: no dashboard, no continuous ride tracking, no selected DB redundancy).
3. **Read your lane's plan under `docs/lanes/`** before touching its paths — see the ownership
   table below.
4. **Check `docs/decisions/` for anything touching your change.** No index — search it:
   `rg -il "<topic>" docs/decisions/`.

A plan that has not done all four is not ready to propose.

## Decisions

One numbered file per decision in `docs/decisions/` (`NNN-short-slug.md`), using the next free
number. Open with `# NNN. Title`, then `- Status:` and `- Date:` lines. No index — search by topic with `rg -il "<topic>" docs/decisions/`. A later
decision supersedes an earlier conflicting one; say so in its own "Supersedes" line rather than
editing the old record. An explicit operator instruction that changes direction authorizes writing
a new decision immediately, without asking for repeated confirmation — ask only when how to resolve
the conflict with existing guidance is genuinely unclear. Name the conflicting record and explain
the change; follow accepted decisions until deliberately superseded. Record non-obvious constraints,
invariants, and rejected alternatives that future work must respect in the same change that
introduces them. Keep records short and update affected plans to match.

## Current state

Documentation only: no application code, dependency manifests, OpenAPI files, infrastructure, or
runnable build/test commands exist yet. Treat every path, command, and dependency named below and
in the architecture/lane docs as a planned deliverable, not something installed or runnable, until
it actually exists in the tree.

## Planned stack

| Layer | Choice |
|---|---|
| Mobile | Expo + TypeScript |
| Backend | FastAPI |
| Data | PostgreSQL + PostGIS |
| Routing | Valhalla (`costing: pedestrian`, scooter-paced walking speed, heavy step penalty) |
| Automatic collector | Separate Expo sensor/recorder app |
| Automatic detector | Pure TypeScript signal detection (`automatic/detector/`) |
| Automatic service | FastAPI ingestion, private observation DB, risk worker, publisher |
| Hosting | Vultr; one PostgreSQL server for the demo, product and observation DBs separate |

These are design decisions recorded in the architecture, not installed dependencies. When
bootstrapping an assigned lane, add and verify its setup/build/test commands; do not claim that
planned commands already work.

## Commands

None exist yet. When a lane adds a runnable component, document its exact setup, start, build, and
test commands in that lane's README/plan and update this section — do not present a planned command
as verified.

## Architecture orientation

```text
Manual mobile app ── POST /v1/reports ───────────────┐
                                                   ▼
                                              Shared backend
                                                   ▲
Automatic service ── PUT /v1/automatic/hazards/{id} ─┘
                                                   │
                         GET /v1/hazards ◀──────────┘
                                │
                         Mobile map + routing
```

The mobile app displays both sources with clear labels, has no sensor requirement, and has no
dependency on the automatic service. Automatic publication uses a server-side credential
(`Authorization: Bearer <AUTOMATION_PUBLISH_KEY>`); automatic processing never writes directly into
the product database or imports into the manual app. Its observation database and credentials are
separate from the product database, even when they share a server.

## Planned ownership

These paths describe the intended layout; they are not all present yet.

| Lane | Plan | Owned paths |
| --- | --- | --- |
| 0 Contracts | [Contracts](docs/lanes/0-contracts.md) | `contracts/`, `backend/app/schemas.py`, initial skeletons until handoff |
| A Mobile | [Mobile](docs/lanes/A-mobile.md) | `mobile/` |
| B Detection | [Detection](docs/lanes/B-detection.md) | `automatic/detector/`, `automatic/collector/` |
| C Backend | [Backend and routing](docs/lanes/C-backend-api.md) | `backend/` except `app/schemas.py` and `Dockerfile` |
| D Automatic hazards | [Automatic service](docs/lanes/D-automatic-hazards.md) | `automatic/service/`, `automatic/tests/` |
| F Simulator | [Simulation](docs/lanes/F-simulator.md) | `simulator/` |
| G Infrastructure | [Infrastructure](docs/lanes/G-infra.md) | `infra/`, `backend/Dockerfile`, `automatic/Dockerfile`, `README.md`, `.github/` |

Lane E is intentionally absent. Edit only your assigned lane's paths unless the user authorizes
broader work or a coordinated handoff changes ownership. Add dependencies only to the owning
manifest; product routing belongs to Lane C.

Lane 0 contracts and fixtures are the synchronization point for independent development. Establish
them before implementing integrations, and use fixtures while upstream services are unavailable.
After phase 0 handoff, shared contracts and schemas are frozen for independent lane implementation —
propose cross-lane contract/schema changes for coordinated approval instead of silently changing the
boundary. Explicit user-requested design revisions authorize updating the architecture and affected
lane plans together.

## Principles

### Product integrity

- Ship the manual product first: report a hazard, display nearby hazards, compare routes.
  Reporting, hazard reads, and routing must work with automation stopped.
- Preserve source and evidence labels, report idempotency, publication revisions, and expiry
  semantics from the architecture. Automatic updates must never overwrite manual reports.
- Coordinate objects use `lat`/`lon`; GeoJSON uses `[lon, lat]`. Bounding boxes use
  `minLon,minLat,maxLon,maxLat`.
- Public data contains hazard aggregates, not ride traces or ordered ride paths. Simulated/replayed
  automatic hazards remain visibly labeled as such. UI copy says "lower-risk," never "safe route."

### Engineering

- Keep the monitoring web app, continuous ride tracking, and motion permissions out of the first
  user-facing release (see README scope decisions). Database redundancy is a proposal, not selected
  or provisioned infrastructure — do not implement application-level dual writes.
- Keep publication credentials server-side, never in Expo public variables or collector code. Do
  not commit secrets or identifying recording endpoints.
- For lane implementation, follow the `lane/<letter>-<name>` branch convention, use small PRs into
  `main`, and rebase before opening a PR. Do not disrupt a peer's active checkout in a shared
  workspace.

### Interface

- Manual reporting works with location permission denied: users can place a map pin.
- Keep draft, queued, sending, submitted, and failed report states distinct. Queued reports are not
  accepted server hazards; preserve the submission ID and body across retries.
- Show source/evidence labels and expiry. A routing outage must not block reporting or map browsing.

## Git & CI workflow

This is a hackathon: prioritize a functioning app over exhaustive coverage. See
[decision 001](docs/decisions/001-mvp-delivery-workflow.md).

- Short `lane/<letter>-<name>` branches, small PRs, rebase before opening. Keep `main` demoable.
- **CI is the routine validation gate, not a full local suite before every push.** Push small and
  let CI check it; don't block local iteration re-running everything each time.
- As a lane adds a CI job, scope it to that lane and its shared contract dependencies, and have superseded runs
  auto-cancel on a new push to the same branch, so feedback stays fast. Don't write a CI step for a
  component that doesn't exist yet.
- Once a deploy step exists, deploy from a passing `main`, not from feature branches.

## Testing

No application tests exist yet. Keep local checks scoped to the behavior you changed and whatever
blocks the demo path — not exhaustive edge cases; see [decision 001](docs/decisions/001-mvp-delivery-workflow.md).
Prefer behavior tests for a lane's golden-path acceptance criteria (manual operation with automation
absent, the core retry/conflict/expiry/source-preservation cases that are actually demo-visible).
Use recorded routing responses and fixtures so checks do not require live upstream services.

## Gotchas

- This is a design-and-planning-phase repository. Do not assume any directory under `mobile/`,
  `backend/`, `automatic/`, `contracts/`, `infra/`, or `simulator/` exists — check first.
- The lane table above is the intended, not current, layout.

## Working agreements

End each PR/handoff with what works, how to run it, and what remains stubbed. When adding runnable
components, update this file's Commands and Stack sections rather than leaving them stale.

### Shared work with Talking Stick

When using this repository's Talking Stick room, follow the installed `talking-stick` skill and
load `tt instructions show --json`. Join once; use room chat for operator interaction. Agree on a
plan with participating peers before implementation.

Only a successful `tt wait` or `tt take` result with `status: "your_turn"` and a live `guardian_pid`
grants shared write authority. This includes builds, dependency installation, and generated output,
even when agents touch different files. Read-only investigation can proceed without the stick.
Follow the skill's single-listener, handoff, and standby rules; never treat a message or
acknowledgement as ownership.

Verify before handing off, and record changes, evidence, risks, and the next action. Every
participating agent independently reviews the final state and explicitly agrees or vetoes; further
edits require renewed final review. Stay joined on standby when only operator input remains.

## Verification and keeping guidance current

For documentation-only changes, review the diff, verify relative links point to existing files,
check consistency with the architecture and lane plans, and run `git diff --check`. For newly
created untracked files, inspect their contents too; ordinary `git diff` does not include them. No
application tests can be run at the current stage.

State which checks actually ran and their outcomes, along with anything unavailable or still
stubbed. Keep implementation and its corresponding contracts, fixtures, and documentation
consistent.
