# Campus scooter hazard map

A manual-first mobile app: riders report hazards, see nearby reports, and compare routes. An independently developed automatic system can later publish detected hazards through the same backend.

**Status:** the manual app supports persistent reporting, route comparison through Valhalla, and foreground live trip position. The API uses PostGIS when configured (memory otherwise); directions require a real routing engine. Physical-device validation and hosted deployment remain outstanding. See component READMEs and the historical [stage 0 handoff](docs/STAGE-0-HANDOFF.md).

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
- Foreground live trip position and camera follow are supported ([decision 024](docs/decisions/024-foreground-trip-tracking.md)). Background tracking, ride recording and motion permission remain out of scope.
- Vultr database redundancy remains a proposed follow-up, not a deployed or selected configuration.

## One-command local app

With Docker Desktop running and Python 3 installed, from the repository root:

```sh
./infra/dev.sh
```

This creates ignored local credentials if needed, prepares GSU routing tiles on first launch,
and starts PostGIS, the product API, Valhalla and Expo in Docker. Existing credentials, tiles
and database data are reused. No host `npm ci` or separate backend terminal is needed.
Scan the printed QR code with SDK-57-compatible Expo Go on the same Wi-Fi.
The first build downloads dependencies, fonts and map data; campus routes cover the GSU area.

```sh
./infra/dev.sh logs     # service logs
./infra/dev.sh down     # stop; preserve reports and tiles
```

Stop any old standalone API/Expo terminals first (ports 8000/8081). If network detection chooses
an unsuitable interface, use `LAN_IP=192.168.1.10 ./infra/dev.sh` with your computer's Wi-Fi IP.
Re-run after source changes to rebuild. Automation stays optional. See the
[local Compose runbook](infra/README.md#one-command-phone-development) for ports and troubleshooting.

## Separate host processes (fixture backend by default)

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

Omit the API variable for offline fixture preview. Use SDK-57-compatible Expo Go or a development
build. New reports require a current one-shot foreground location; denied/unavailable location offers retry, not manual pin placement. Route endpoint pins remain available. The stub loses
reports on restart. Offline preview does not provide directions. For real routes, follow the [routing demo setup](infra/README.md); Trip shows your live position while the app is open, with no automatic rerouting.

For API + PostGIS startup, optional routing/automation profiles, HTTPS and the Vultr deployment
runbook see [infra](infra/README.md). Start optional automation separately:
[observation service](automatic/service/README.md), [collector](automatic/collector/README.md),
[detector](automatic/detector/README.md). Test the HTTP bridge using the
[fixture publisher](contracts/README.md); no automatic worker is required.

Setup, start, export and verification commands live in [backend](backend/README.md),
[mobile](mobile/README.md), and [contracts](contracts/README.md). The manual backend is deployed over HTTPS at `https://144-202-21-20.sslip.io`.
See the [deployment handoff](infra/VULTR-DEMO.md) for verified checks, Expo launch steps,
and remaining phone validation.
