# Campus scooter hazard map

A manual-first mobile app: riders report hazards, see nearby reports, and compare routes. An independently developed automatic system can later publish detected hazards through the same backend.

**Status:** stage 0 contracts and runnable skeletons are implemented. Storage is nonpersistent, routes are fixed fixtures, and sensors/detection are not implemented. See the [stage 0 handoff](docs/STAGE-0-HANDOFF.md) for verification and remaining work.

## Start here

Read [ARCHITECTURE.md](ARCHITECTURE.md) for the API boundary and acceptance criteria, then pick an ownership lane below. See [docs/ROADMAP.md](docs/ROADMAP.md) for milestone sequence, owners, and the MVP cut line.

| Track | Plans | Responsibility |
|---|---|---|
| Manual product | [A: Mobile](docs/lanes/A-mobile.md), [C: Backend and routing](docs/lanes/C-backend-api.md) | Report form, map, shared API, persistence and routing |
| Automatic detection | [B: Collector and detector](docs/lanes/B-detection.md), [D: Hazard service](docs/lanes/D-automatic-hazards.md) | Sensor collection, observation storage, hazard generation and publication |
| Shared support | [0: Contracts](docs/lanes/0-contracts.md), [F: Simulation](docs/lanes/F-simulator.md), [G: Infrastructure](docs/lanes/G-infra.md) | API fixtures, independent development, demo data and deployment |

## Integration boundary

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

The mobile app displays both sources with clear labels. It has no sensor requirement or dependency on the automatic service. Automatic publication uses a server-side credential; automatic processing never writes directly into the product database.

## Delivery checklist

- [x] Define versioned contracts, fixtures and independently runnable skeletons.
- [ ] Deliver manual reporting, persistence, offline retry and live map updates with automation off.
- [ ] Add product routing and deploy the manual app's backend over HTTPS.
- [ ] Build automatic collection and hazard generation independently; validate publication with a fixture client first.
- [ ] Connect automatic publications and demonstrate both sources on the same map.

The first release ends after the third item. Automatic work can proceed in parallel once its contracts are agreed.

## Scope decisions

- No monitoring web app or dashboard lane.
- No continuous ride tracking or motion permission in the first user-facing app.
- Vultr database redundancy remains a proposed follow-up, not a deployed or selected configuration.

## Stage 0 quick start

Use Python 3.11+ with uv, Node 22 LTS, and Docker Compose for the optional local DB container.

```sh
uv sync --project backend --frozen
uv run --project backend uvicorn app.main:app --app-dir backend --host 0.0.0.0 --port 8000
```

In another terminal:

```sh
npm ci --prefix mobile
EXPO_PUBLIC_API_URL=http://YOUR_LAN_IP:8000 npm start --prefix mobile
```

Omit the API variable for offline fixture preview. Use SDK-55-compatible Expo Go or a development
build. Reporting works with a manually placed pin and no location permission. The stub loses
reports on restart; offline persistence is milestone 1. The route preview is not navigation.

For API + PostGIS startup see [infra](infra/README.md). Start optional automation separately:
[observation service](automatic/service/README.md), [collector](automatic/collector/README.md),
[detector](automatic/detector/README.md). Test the HTTP bridge using the
[fixture publisher](contracts/README.md); no automatic worker is required.

Setup, start, export and verification commands live in [backend](backend/README.md),
[mobile](mobile/README.md), and [contracts](contracts/README.md). No hosted deployment exists yet.
