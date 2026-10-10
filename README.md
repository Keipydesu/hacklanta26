# Campus scooter hazard map

A manual-first mobile app: riders report hazards, see nearby reports, and compare routes. An independently developed automatic system can later publish detected hazards through the same backend.

**Status:** design and development plans only. Application code, OpenAPI files, infrastructure and runnable commands are planned deliverables, not implemented yet.

## Start here

Read [ARCHITECTURE.md](ARCHITECTURE.md) for the API boundary and acceptance criteria, then pick an ownership lane below.

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

- [ ] Define versioned contracts, fixtures and independently runnable skeletons.
- [ ] Deliver manual reporting, persistence, offline retry and live map updates with automation off.
- [ ] Add product routing and deploy the manual app's backend over HTTPS.
- [ ] Build automatic collection and hazard generation independently; validate publication with a fixture client first.
- [ ] Connect automatic publications and demonstrate both sources on the same map.

The first release ends after the third item. Automatic work can proceed in parallel once its contracts are agreed.

## Scope decisions

- No monitoring web app or dashboard lane.
- No continuous ride tracking or motion permission in the first user-facing app.
- Vultr database redundancy remains a proposed follow-up, not a deployed or selected configuration.
