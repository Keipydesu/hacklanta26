# Lane G: Local infrastructure, Valhalla and Vultr delivery

## Goal and baseline

Make the manual product reproducible locally and deploy it over HTTPS on Vultr for milestone 2.
Automation is independently startable and never a prerequisite for reports, map reads or routes.
Follow [the architecture](../../ARCHITECTURE.md), [roadmap](../ROADMAP.md) and
[decision 001](../decisions/001-mvp-delivery-workflow.md).

[PR #1](https://github.com/Keipydesu/hacklanta26/pull/1) is merged and provides product API/PostGIS Compose, a backend image, environment examples, scoped CI,
contract/type drift checks and component startup docs. The API still uses memory; healthy PostGIS
is not evidence of persistence. There is no Valhalla, TLS or Vultr deployment yet. Extend those files. Everything below beyond that baseline is proposed, not a verified deploy command.

**Owns:** `infra/`, `backend/Dockerfile`, `automatic/Dockerfile`, `README.md`, `.github/`.
C owns product database migrations/routing code; D owns private observation migrations/worker;
F owns scenario generation. G wires their documented commands without implementing their business
logic. Coordinate AGENTS Commands/Stack updates when verified commands land, since that is shared
guidance. Never make generated runtime data or credentials part of a planning PR.

## Local startup entrypoint

[Decision 026](../decisions/026-one-command-local-compose.md) adds `./infra/dev.sh` and a development
Compose overlay for Expo + API + PostGIS + real routing. It preserves credentials/data and builds
missing campus tiles once before startup. Automation stays optional; production profiles are
unchanged. This local entrypoint does not complete the hosted/device acceptance gates below.

## Service architecture and isolation

```text
phone → HTTPS Caddy → product API → product DB
                           └────→ Valhalla + read-only routing tiles

collector → optional observation HTTPS → automatic API/worker → observation DB
                                             └─ authenticated HTTPS PUT → product API
```

| Service | Default/manual role | Startup, health and exposure |
|---|---|---|
| `db` | PostgreSQL + PostGIS, one demo server | Persist volume; health probe checks database readiness. Internal network only; no public PostgreSQL port. Product and optional observation datasets use separate databases/roles. |
| `api` | Product FastAPI | Wait for database readiness and C's migration completion. One API worker until C supplies cross-process live coordination. Internal production port 8000; optional localhost/LAN bind for local development. |
| `valhalla` | Self-hosted campus routing | Separate tile preparation from serving. Mount built tiles, verify a real GSU route, expose only internally in production. API startup/health must not fail just because routing is temporarily unavailable. |
| `caddy` | Public product HTTPS | Expose 80/443, persist certificate state. Route product `/v1/*` and `/healthz`, including WebSockets, to API; unknown paths return 404. |
| `automatic` | Optional observation API/worker | Explicit automation Compose profile, separate credentials and health. No manual service depends on it. Build after D supplies real worker startup; never portray the stage-0 ingestion stub as a worker. |

Use separate product and observation DB users with no cross-database grants. The DB administration
credential stays in provisioning/migration operations, not app environments. Stage-0 Compose uses
its bootstrap role directly; split bootstrap administration from least-privilege product access as
persistence lands. Starting with a shared server does not make the datasets replicas or require dual
writes. D's process receives `AUTOMATION_DATABASE_URL`, never `DATABASE_URL` for the product.

Caddy's observation upstream must not be present in manual-only configuration. Use a generated
or explicitly selected automation proxy configuration so an absent service cannot break manual
proxy startup/reload. Give observation ingestion a separate HTTPS hostname. Provisioning that
hostname is conditional on enabling automation; product DNS/TLS works independently.

## Proposed file structure and operational methods

```text
infra/
  docker-compose.yml          default manual services and optional automation profile
  docker-compose.dev.yml      explicit local exposure/overrides if needed
  Caddyfile                   product-only HTTPS routing
  caddy/automation.conf       optional observation hostname configuration
  .env.example                names/placeholders, never deployable secrets
  valhalla/
    build_tiles.sh            fetch/clip/build/validate/promote
    custom_files/             ignored extracts, tiles, version manifest
  vultr/
    cloud-init.yaml           repeatable host bootstrap
    deploy.sh                 exact-commit staged deployment
    rollback.sh               last-known-good application release
  migrate.sh                  orchestrate lane-owned migration entrypoints
  check_stack.sh              readiness, route and HTTP acceptance probes
  backup.sh                   selected database backup and metadata
  restore_check.sh            restore to disposable validation database
  reset_db.sh                 explicitly selected demo dataset only
  seed_demo.sh                call F's scenarios against selected APIs
  README.md                   local and operational runbook
```

The script names and flags are planned interfaces. Implement them incrementally and document exact
verified invocations in `infra/README.md`; do not add CI steps for files that do not yet exist.
Scripts fail on command errors, validate required arguments, avoid echoing secrets, and distinguish
preflight failures from incomplete deployments. Shared shell helpers may be extracted only when
multiple scripts actually need them; no deployment framework is required for this hackathon.

| Method/stage | Required behavior |
|---|---|
| `preflight(environment, commit)` | Verify clean/exact release source, host/hostname, required non-placeholder secrets, Docker/Compose availability, disk for DB/tiles, and enabled service configuration. Reject accidental production targeting by demo-only commands. |
| `migrate(dataset)` | Invoke C or D's migration entrypoint once with that dataset's credential; wait for success before its application starts. Serialize deployment/migration execution on a host. No destructive reset or automatic downgrade. |
| `build_tiles(extract, bbox, version)` | Download source to temporary location, record date/checksum, clip, build with pinned engine, validate routes, then atomically select the new tile directory. Keep previous tiles for rollback. |
| `deploy(host, commit, profile)` | Stage exact commit/artifacts, render config, backup before risky migrations, migrate, start the selected stack and run acceptance probes. Record deployed commit and previous release; mark success only after probes pass. |
| `probe_manual(base_url)` | Check product/DB health and an explicitly demo-labeled create/read/identical-retry flow in the designated demo environment; verify HTTPS and live reconnect. Run a real route probe for milestone 2. |
| `rollback(release)` | After a failed rollout restart `current` (the last good release); otherwise restore `previous`. Restart its image/config/compatible tiles and probe. Do not roll the DB backward automatically; use a forward fix or separately planned restore if schema is incompatible. |
| `seed_demo(target, mode)` | Default to F's manual scenario. Optional automation requires explicit separate URL and server-only publisher environment. Freeze run identity/time using F's CLI; log IDs and evidence labels, not secrets. |
| `reset_demo(dataset, target)` | Require explicit demo environment, selected product or observation dataset and confirmation. Display affected dataset; never reset both implicitly or delete production data. |

## Local stack and database integration (G1)

1. Preserve the existing `infra` Compose project and `infra_product-data` volume on upgrade;
   keep explicit project-name overrides consistent. Verify normal shutdown preserves data.
   Do not use volume removal as the normal teardown in README. Add a dedicated local test database
   for destructive integration checks so a developer's reports are not erased.
2. Agree C's schema migration command and product role requirements; implement one-shot migration
   orchestration and connection readiness before API startup. Inject configuration at runtime.
   Verify creating a report, restarting API and reading the same ID after restart.
3. Replace memory-specific health assumptions only after C's DB implementation exists. Product
   health checks product API/database only; report Valhalla readiness in operational probes without
   taking manual ingestion down when routing fails.
4. Build application images from the owning locked manifests with reproducible dependency versions.
   Keep build context small and secrets outside image layers. Smoke-test imports/startup as a
   non-root runtime user where practical. Preserve C's one-worker live-update constraint.
5. Start with automation profile off and no observation credentials. Confirm every manual operation
   possible at that milestone works. Optional observations get a separately provisioned DB/user;
   G coordinates privileges with D and tests that its credentials cannot read product tables.

## Valhalla preparation and Lane C handoff (G2)

The architecture selects Valhalla but does not select an image or extract. Evaluate
`ghcr.io/valhalla/valhalla-scripted` with a Georgia OSM extract as a Lane G proposal: verify the
maintained image, supported architecture, configuration flags and resource needs at implementation time, then pin the tested digest/tag.
Do not commit a guessed image version, cloud size or assumed build duration as verified guidance.

`build_tiles.sh` should fetch the Georgia extract from
`https://download.geofabrik.de/north-america/us/georgia-latest.osm.pbf`, record its timestamp/checksum,
and clip to metro Atlanta (`-84.55,33.60,-84.20,33.95`) with osmium. Keep input/extracted PBF files,
tiles and logs ignored; only scripts and a nonsecret build recipe belong in git. Verify how the
selected scripted image consumes `/custom_files`, disables optional admin/timezone builds for the
demo, and triggers rebuilds before relying on those settings. Never run a large rebuild during
ordinary API startup or delete the working tile set before replacement passes validation.

Measure disk, memory and build time with the chosen image and extract before sizing the Vultr host.
Tile-build peak usage differs from serving usage; building on a separate machine and uploading
verified artifacts is acceptable if local/host resources require it. Preserve licensing/attribution
metadata with the extract and displayed map/provider configuration.

Hand C: pinned engine version, `VALHALLA_URL`, tile bounds/date, a working GSU origin/destination
request, response and failure example, and configured service limits. Probe pedestrian costing at
16 km/h with the proposed step penalty, plus a hazard exclusion request. C owns the three-trip
pedestrian/bicycle comparison, decoding, error classification and planner. G confirms the engine
can serve those requests. A running container or open port alone does not pass this handoff.

## HTTPS and Vultr deployment (G3–G4)

1. **Host bootstrap.** Prepare cloud-init for Ubuntu 24.04 with Docker/Compose, a deploy user and SSH
   access. Confirm current provider availability/requirements before selecting a compute plan.
   Restrict inbound access to SSH and public 80/443; DB, Valhalla and internal app ports stay private.
   Obtain the operator's actual host, hostname and credentials before creating paid infrastructure.
2. **TLS.** Use a controlled hostname with correct DNS and reachable ports. An IP-based sslip.io
   hostname is a proposed fallback if no controlled domain exists, not an adopted architecture
   decision; verify current certificate eligibility and reachability and record the selected
   hostname before promising issuance. Persist Caddy state, validate config before reload, and test from a phone's external network, not only localhost.
3. **Release selection.** Deploy an exact passing `main` commit. Do not deploy a planning/feature
   branch or assume stage 0 is production-ready. Store runtime secrets on the host with restricted
   permissions and transport them without printing; do not copy a developer's entire working tree
   or commit `.env`. Keep placeholder examples separate from real runtime values.
4. **Migration and rollout.** Serialize deployments, stage images/config/tiles, run lane-owned
   migrations, start API/proxy and probe. Record old and new image/commit IDs. Prefer additive,
   backward-compatible migrations so the previous app can run if rollout fails. Document manual
   recovery for a migration that has already committed before a later service failure.
   Every deployment attempt retains a private copy of its serving tiles in a unique release
   directory, including retries of the same commit; shared uploads are staging only.
5. **Acceptance.** Run HTTPS health, manual create/read/retry, WebSocket reconnect, real route and
   automation-off probes. Rehearse report submission on a second phone with location denied.
   Update root README with the actual URL and verified launch/runbook commands only after success.
6. **Rollback drill.** In the demo environment, select the previous known-good release, restore its
   compatible app/config/tiles and run probes. Preserve data volume. Record elapsed recovery and
   limitations; do not claim database restoration from an untested backup.

A host/hostname/credential gap blocks deployment, not local Compose, tile preparation or CI work.
Record missing inputs in the handoff with an owner; never fill them with fictitious URLs or keys.

## CI, backups and optional automation

Keep stage-0 path-filtered jobs and generated-fixture/type drift checks; extend the existing workflows
rather than creating a redundant full suite. C's integration job gets disposable PostGIS when its
migrations land. D gets a separately configured observation DB. F gets a job only when its manifest
exists. Documentation checks should still run for lane-plan changes. Cancel superseded validation
runs per branch, but serialize deployments so cancellation cannot interrupt a half-applied migration.

For deploy CI, build/test the same `main` SHA that is deployed, pass artifacts/identifiers explicitly,
and keep provider/SSH credentials in CI secrets. Run post-deploy probes and report the exact release.
A newer push must not accidentally cause a job to deploy a different untested HEAD. Failed validation
must prevent deployment. Restore the last known working compatible application if acceptance fails.

Create selected-database backups with timestamps, schema/release metadata and restricted storage.
Test restore into a disposable database and read known fixture rows; backups do not count as verified
until restored. Decide and document retention/frequency for the demo host without adding replication.
Do not publicly store raw ride traces. Object storage for recordings and managed PostgreSQL failover
remain deferred options requiring separate decisions, privacy handling and restore/failover evidence.

Add the optional automatic image/profile after D supplies ingestion/worker entrypoints and durable
outbox behavior. Validate `AUTOMATION_DATABASE_URL`, `PRODUCT_API_URL` and server-only
`AUTOMATION_PUBLISH_KEY` independently from the product settings. Configure the observation hostname
only when its profile runs. Stop automation and verify manual create/read/route; stop product API and
verify D retains publications for retry. G controls service lifecycle; D verifies outbox recovery.

## Configuration ownership

| Setting | Destination and rule |
|---|---|
| `DATABASE_URL` | Product API/migration only, product role |
| `VALHALLA_URL` | Product API, internal engine URL |
| `EXPO_PUBLIC_API_URL` | Manual app, public product HTTPS URL |
| `AUTOMATION_DATABASE_URL` | Automatic service/migration only, distinct private role |
| `PRODUCT_API_URL` | Automatic publisher and explicitly selected fixture tools |
| `AUTOMATION_PUBLISH_KEY` | Product API plus server-side publisher/authorized CLI only; never collector or Expo public values |
| `EXPO_PUBLIC_AUTOMATION_API_URL` | Collector, separate observation HTTPS URL |
| `DEMO_MODE` | Explicit synthetic behavior, off by default; visibly labeled evidence |

Document additional operational variables (hostnames, role passwords, tile path/version) when their
scripts exist. Missing secrets should fail preflight without logging values. Rotation of the shared
publisher key coordinates C and D; stale queued updates keep their IDs/revisions across restart.

## Delivery slices and evidence

- **G1:** local product database/runtime/migration wiring with C; report survives restart, automation
  absent. Keep stage-0 stub warnings until the actual capability changes.
- **G2:** reproducible tiles and serving engine; hand real route/exclusion responses to C. Develop
  in parallel with C's recorded-response adapter rather than blocking manual persistence.
- **G3:** Vultr host/TLS and milestone-1 backend deployment; external phone reaches product API.
- **G4:** passing-main deployment/rollback and C's real routing; completes milestone-2 infrastructure
  gate only when A's phone rehearsal also works. This is the first-release cut line.
- **G5:** optional observation DB/service/proxy and F seed integration for milestones 3–4; default
  manual startup remains independent. Abandonment, redundancy and raw-recording storage defer.

Existing stage-0 local commands remain:

```sh
cp infra/.env.example infra/.env
# Replace development placeholders; never commit this file.
docker compose --env-file infra/.env -f infra/docker-compose.yml up --build -d
docker compose --env-file infra/.env -f infra/docker-compose.yml ps
curl http://localhost:8000/healthz
docker compose --env-file infra/.env -f infra/docker-compose.yml down
```

These currently demonstrate a memory API plus DB container, not persistent/hosted operation. New
migration, tile, deploy, backup and reset commands are not runnable yet; implement and verify each
before placing it in the quick start or CI. Docs-only plan review checks links, ownership, consistency
and whitespace; no cloud provisioning or runtime change is part of this PR.

Every handoff includes tested commit/image versions, enabled profiles, public URLs when real,
migration and launch commands, probe results, backup/restore/rollback evidence, missing operator
inputs, and remaining stubs. The final gate is a phone using live reports and real routes over HTTPS
with automatic containers stopped, not merely a green Compose status.
