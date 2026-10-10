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
3. **Read [docs/ROADMAP.md](docs/ROADMAP.md)** for milestone sequence, owners, dependencies, and
   the MVP cut line.
4. **Read your lane's plan under `docs/lanes/`** before touching its paths — see the ownership
   table below.
5. **Check `docs/decisions/` for anything touching your change.** No index — search it:
   `rg -il "<topic>" docs/decisions/`.

A plan that has not done all five is not ready to propose.

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

Stage 0 contracts, fixtures and independently runnable skeletons now exist. The product API persists to PostGIS when `DATABASE_URL` is set (memory otherwise); the
observation API persists to its private PostGIS database and runs a hazard worker/outbox when
`AUTOMATION_DATABASE_URL` is set (memory stub otherwise); mobile/collector export native bundles. The collector implements foreground sensing, privacy trimming
and durable uploads; the detector implements hard-brake and bump detection. Physical-device validation,
real-recording tuning and hosted deployment remain outstanding. See component READMEs and [stage 0 handoff](docs/STAGE-0-HANDOFF.md).

## Stack

| Layer | Stage 0 state |
|---|---|
| Mobile | Expo SDK 57 + TypeScript; MapLibre GL JS in a WebView with OpenFreeMap OSM tiles (decision 010); fixture/live stub screens |
| Backend | FastAPI; PostGIS persistence via psycopg when `DATABASE_URL` is set, memory stub otherwise |
| Data | PostgreSQL + PostGIS Compose container; product API persists reports/hazards/revisions |
| Routing | Valhalla pedestrian costing (scooter pace/step penalty) when `VALHALLA_URL` is set; fixed fixture otherwise |
| Automatic collector | Separate Expo app: device motion/GPS sensing (foreground only), privacy trimming, durable upload queue, indoor demo |
| Automatic detector | Pure TypeScript hard-brake and bump detector in `automatic/detector/` |
| Automatic service | Independent FastAPI; durable PostGIS ingestion, serialized hazard worker and publication outbox when `AUTOMATION_DATABASE_URL` is set (memory stub otherwise) |
| Hosting | Compose manual stack with opt-in `routing` / `https` / `automation` profiles and Vultr deploy/rollback scripts (`infra/`); Vultr path not yet run on a real host |

## Commands

From the repository root (Python 3.11+, uv, Node 22 LTS recommended):

- Contracts: `uv sync --project contracts --frozen`, then
  `uv run --project contracts python contracts/scripts/validate.py`.
- Generated types: `npm ci --prefix contracts`, then `npm run generate --prefix contracts`.
- Product API: `uv sync --project backend --frozen`, then
  `uv run --project backend uvicorn app.main:app --app-dir backend --host 0.0.0.0 --port 8000`.
- Product tests: `uv run --project backend pytest -c backend/pyproject.toml backend/tests -q`.
- Campus bike-lane data refresh: `python3 backend/bike_lanes/import_osm.py [--date <OSM snapshot>]`.
- Mobile: `npm ci --prefix mobile`; `npm start --prefix mobile`;
  `npm run typecheck --prefix mobile`; `npm test --prefix mobile`; `npm run build --prefix mobile`.
- Observation API: `uv sync --project automatic/service --frozen`, then
  `uv run --project automatic/service uvicorn app.main:app --app-dir automatic/service --port 8001`.
- Observation tests:
  `uv run --project automatic/service pytest -c automatic/service/pyproject.toml automatic/tests -q`.
- Collector: `npm ci --prefix automatic/collector`; `npm start --prefix automatic/collector`;
  `npm run typecheck --prefix automatic/collector`; `npm test --prefix automatic/collector`;
  `npm run build --prefix automatic/collector`.
- Detector: `npm ci --prefix automatic/detector`; `npm test --prefix automatic/detector`.
- Simulator: `PYTHONPATH=simulator/src python3 -m unittest discover -s simulator/tests -t simulator`;
  `node --test "simulator/replay-detector/*.test.mjs"`.
- Documentation: `python3 scripts/check_docs.py`; `git diff --check`.
- Compose setup/start/stop: [infra README](infra/README.md). Stack probes `infra/check_stack.sh URL`;
  backup/restore proof `infra/backup.sh` then `infra/restore_check.sh FILE`; routing tiles
  `infra/valhalla/build_tiles.sh EXTRACT`; Vultr `infra/vultr/deploy.sh` / `rollback.sh` (not yet run on a host).

Verified commands and remaining device checks are recorded in the handoff. Native exports produce
JavaScript/Hermes bundles, not signed binaries. Keep local checks scoped; CI is the routine gate.

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

## Ownership

Stage 0 created initial skeletons; ownership now follows these lanes. Some later deliverables remain planned.

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

- Use only libraries and exact versions vetted for security before adding or upgrading them.
  Never select a release merely because it is newest. Prefer established, maintained releases
  with time for community review; check current security advisories, package provenance and
  maintainer changes, release diffs, install scripts, and newly introduced transitive dependencies.
  Pin or lock the reviewed versions and record the review date, sources, and rationale in the
  PR or handoff. Release age, popularity, and a clean vulnerability scan alone do not establish
  safety. If vetting is incomplete or compromise is suspected, defer adoption or choose a vetted
  alternative. Apply security fixes promptly after reviewing the specific patched release.
- Keep the monitoring web app, continuous ride tracking, and motion permissions out of the first
  user-facing release (see README scope decisions). Database redundancy is a proposal, not selected
  or provisioned infrastructure — do not implement application-level dual writes.
- Keep publication credentials server-side, never in Expo public variables or collector code. Do
  not commit secrets or identifying recording endpoints.
- For lane implementation, follow the `lane/<letter>-<name>` branch convention, use small PRs into
  `main`, and rebase before opening a PR. Do not disrupt a peer's active checkout in a shared
  workspace.

### Interface

- New manual reports require a current one-shot foreground device location; denied/unavailable location blocks new submissions with retry guidance. No manual report-pin placement. Saved reports retry with their original location and ID; route endpoint pins remain optional-location controls.
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

Stage 0 contract and stub behavior tests exist. Keep local checks scoped to the behavior you changed and whatever
blocks the demo path — not exhaustive edge cases; see [decision 001](docs/decisions/001-mvp-delivery-workflow.md).
Prefer behavior tests for a lane's golden-path acceptance criteria (manual operation with automation
absent, the core retry/conflict/expiry/source-preservation cases that are actually demo-visible).
Use recorded routing responses and fixtures so checks do not require live upstream services.

## Gotchas

- Stage 0 stubs are not production implementations. Check component READMEs before relying on behavior.
- `simulator/` exists (scenario CLI; run `PYTHONPATH=simulator/src python3 -m simulator.cli scenarios`). Real-ride
  tuning, closure scenarios and the hosted rehearsal are still planned.

## Working agreements

End each PR/handoff with what works, how to run it, and what remains stubbed. When adding runnable
components, update this file's Commands and Stack sections rather than leaving them stale.

### Shared work with Talking Stick

Talking Stick is optional, not a prerequisite for contributing. If it is unavailable or you are
not participating in a room, follow the normal single-agent Git/PR workflow in this file; no
installation or `tt` commands are required. The room-specific rules below apply only when using
Talking Stick. Lack of tooling does not authorize concurrent writes to an active shared checkout;
coordinate with its participants or use a separate checkout.

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
created untracked files, inspect their contents too; ordinary `git diff` does not include them. Run the owning component checks for code changes.

State which checks actually ran and their outcomes, along with anything unavailable or still
stubbed. Keep implementation and its corresponding contracts, fixtures, and documentation
consistent.
