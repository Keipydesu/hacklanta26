# Infrastructure

Local Compose stack, routing tiles, HTTPS and the Vultr deployment scripts (Lane G).

The manual product is the default: `db` + `api`. Everything else is an opt-in Compose profile, and
no manual service depends on an optional one.

```text
phone → HTTPS Caddy [https] → api → db (product database)
                               └──→ valhalla [routing] + read-only tiles

collector → Caddy, own hostname → automatic [automation] → db (observations database, own role)
                                        └── authenticated PUT → api
```

| Service | Profile | Exposure | Notes |
|---|---|---|---|
| `db` | always | Compose network only, no published port | PostGIS; named volume `infra_product-data` |
| `api` | always | `API_BIND:API_PORT` (default `0.0.0.0:8000` for LAN development) | one worker; health checks the product only |
| `valhalla` | `routing` | internal `8002` | serves prebuilt tiles mounted read-only |
| `caddy` | `https` | 80, 443 | proxies `/v1/*` and `/healthz`, everything else 404 |
| `automatic` | `automation` | `AUTOMATION_BIND:AUTOMATION_PORT` (default `0.0.0.0:8001`) | observation API + worker; own database role; not a dependency of anything |

## What has actually been run

| Piece | Status |
|---|---|
| Compose file, all profiles parse | run locally (`docker compose config`) and in CI |
| `dev.sh` + dev overlay + Expo Docker image | On 2026-10-10: isolated first database startup and repeat launch; persistent API/real LAN route probes; Metro/iOS manifest and native bundle with correct LAN API URL; 16 infrastructure tests and docs checks passed. Physical Expo Go interaction with this container remains to be checked. |
| Images build from locked manifests; manual stack starts healthy; `check_stack.sh`; `backup.sh` → `restore_check.sh`; observation role isolation; automation start/stop independence; `reset_db.sh`; Caddyfile validation | exercised by the CI `stack` job on every change under `infra/` — see that job's result on the PR, not this table, for the current state |
| `valhalla/build_tiles.sh`, the `routing` profile serving real tiles | Campus extract built and validated locally on 2026-10-10; real route probe passed over LAN. Full metro extract remains unmeasured. |
| `vultr/cloud-init.yaml`, `vultr/deploy.sh`, `vultr/rollback.sh`, real TLS issuance | **not run** against a real host — no host, hostname or credentials existed. The remote deploy/rollback logic was exercised locally with mocked `docker`/`flock` for: A/B/C failed rollout restarts B; first-upgrade failure restarts the only release; successful-then-bad release rolls back to `previous`; failed route or write probes leave `current` untouched. `--probe-route` and `--probe-report` were run against the stage 0 backend (fixture rejected, report probe passed). |
| `seed_demo.sh`, `check_stack.sh --write-demo` | **not run** against a real stack (they call Lane F's simulator) |

Nothing is deployed. There is no public URL yet.

## One-command phone development

From the repository root, with Docker Desktop, Python 3, Git and curl available:

```sh
./infra/dev.sh
```

The launcher prepares `infra/.env` with random credentials only when no database exists, builds
missing GSU tiles with the existing preparation script, and uses `docker-compose.dev.yml` over
the base Compose file to start `db`, `valhalla`, `api` and `mobile`. Existing credentials and
`infra_product-data` are preserved. The API gets real routing automatically; the Expo container
installs all locked dependencies (including MapLibre), verifies fonts and generates the map bundle.
It receives only public LAN URLs, never backend secrets. Source is copied at build time; rerun
this command to pick up edits. No host npm install or additional backend command is needed.

Readiness checks persistent API health, a real campus route, Metro health and the iOS manifest's
advertised bundle URL. Scan the printed QR in Expo Go on the same Wi-Fi. The native application
runs on your phone; Docker hosts its development server. This is not a web dashboard or signed app.

```sh
./infra/dev.sh status
./infra/dev.sh logs
./infra/dev.sh down       # stops only these four services; keeps all data and tiles
LAN_IP=192.168.1.10 ./infra/dev.sh   # override Wi-Fi address detection
API_PORT=18000 EXPO_PORT=18081 ./infra/dev.sh  # alternate host ports
```

Use the same port/project overrides on subsequent commands. `COMPOSE_PROJECT_NAME` preserves an
existing custom project; default remains `infra`. `ENV_FILE` may select another Git-ignored,
untracked file inside this checkout. The default is `infra/.env`; it is never sourced as shell code.
Stop standalone Uvicorn/Expo terminals on conflicting ports; the launcher reports which port.
If database authentication fails, restore the original password in `.env` or deliberately update
the local database role to match. Replacing `.env` does not change an initialized database password.
The launcher never resets data or silently rotates an existing password.

For direct Compose usage after initial preparation (set your actual LAN_IP):

```sh
LAN_IP=192.168.1.10 docker compose --env-file infra/.env \
  -f infra/docker-compose.yml -f infra/docker-compose.dev.yml --profile routing up -d --build --wait
```

The base Compose file continues to support manual API-only, optional automation and production
HTTPS independently. The dev overlay is for a trusted LAN; do not use it on the public Vultr host.
The Expo runtime is pinned and documented in [its review](DEV-RUNTIME-REVIEW.md).

## Local development

```sh
cp infra/.env.example infra/.env        # replace the two placeholders; never commit this file
docker compose --env-file infra/.env -f infra/docker-compose.yml up --build -d --wait
infra/check_stack.sh http://localhost:8000
docker compose --env-file infra/.env -f infra/docker-compose.yml down     # keeps the data volume
```

`down` keeps your data. Do not make `down -v` a habit; use `infra/reset_db.sh` when you mean to
empty a demo dataset.

Whether reports survive an API restart depends on the product code in the checkout: `/healthz`
says `storage: postgis` once Lane C's persistence is merged and `storage: memory` before that.
`check_stack.sh --expect-storage postgis` turns that into a failing probe.

The Compose project remains `infra`, preserving the existing `infra_product-data` volume
and containers when upgrading from main. If you previously used `-p` or
`COMPOSE_PROJECT_NAME`, keep using that same project override to retain its data.

### Routing (optional)

For the manual demo, one command builds or reuses tiles, starts `db`, `valhalla` and `api`, and
succeeds only after a real route request passes (never on fixture routes):

```sh
infra/start_routing_demo.sh --campus   # first run: small GSU extract from Overpass, no osmium needed
infra/start_routing_demo.sh            # later runs: reuse the validated tiles in valhalla/custom_files/
```

It sets `VALHALLA_URL=http://valhalla:8002` for its Compose calls without editing `infra/.env`.
It probes the running API's published address from Compose, including shell overrides of
`API_PORT` and `API_BIND`. Point the phone at the printed `EXPO_PUBLIC_API_URL`; replace
`YOUR_LAN_IP` with this machine's LAN address for a wildcard bind. A loopback-only bind must be
changed to a LAN address before a phone can connect. Failure to resolve the published address
stops the script instead of probing a guessed port.

The same steps by hand:

```sh
infra/valhalla/build_tiles.sh --campus   # or path/to/extract.osm.pbf, or --geofabrik (needs osmium)
# then in infra/.env:  VALHALLA_URL=http://valhalla:8002
docker compose --env-file infra/.env -f infra/docker-compose.yml --profile routing up -d --wait
infra/check_stack.sh http://localhost:8000 --expect-routing valhalla --probe-route
```

Without a configured `VALHALLA_URL` the API answers with its fixed example route and an `X-Stage-0-Stub`
header. A configured but unreachable engine returns 503. Outside offline preview mode the app treats that as an outage ("Routing is unavailable
right now") with a retry button, rather than drawing example lines; reporting and the hazard map keep
working.

The script builds in a temporary directory, serves the new tiles on a private port, requests a
real pedestrian route across GSU (16 km/h, step penalty 600), and only then replaces
`valhalla/custom_files/`, keeping the previous set in `previous/`. It writes `manifest.json` with
the extract checksum, bounding box, date and engine image digest. Extracts, tiles and logs are
ignored by git.

The `ghcr.io/valhalla/valhalla:3.9.1` image and build flags passed the small campus build and route
probe on 2026-10-10. The manifest records the served image digest. Memory, disk and build time for
the full metro Atlanta extract remain unmeasured. With an empty
`VALHALLA_URL` the API keeps answering with its fixed example route and says so in a response
header. The API never fails health because routing is down.

### Automation (optional)

```sh
# in infra/.env: OBSERVATIONS_DB_PASSWORD=<different from the product password>
infra/provision_observation_db.sh
docker compose --env-file infra/.env -f infra/docker-compose.yml --profile automation up -d --build --wait automatic
infra/check_stack.sh http://localhost:8000 --automation-url http://localhost:8001
```

The observation service gets `AUTOMATION_DATABASE_URL`, `PRODUCT_API_URL` and the publisher key —
never `DATABASE_URL` or the product password. `provision_observation_db.sh` creates the
`observations` role and database (a fresh volume gets them from `db/init/10-observations.sh`
instead) and then proves the role cannot open the product database. The two databases hold
different data; they are not replicas of each other.

The observation ingress has no authentication in the frozen contract. Treat its hostname as
semi-private for the demo and do not leave it running unattended.

## Scripts

All take settings from `infra/.env` (override with `ENV_FILE=`). None prints a secret.

| Script | Purpose |
|---|---|
| `check_stack.sh BASE_URL [--automation-url URL] [--expect-storage X] [--expect-routing X] [--probe-route] [--probe-report] [--write-demo]` | Health, feed read, unauthenticated publication rejected, non-API paths 404 over HTTPS. `--probe-route` (read-only) fails unless `/v1/route` returns 200 with a real LineString route and not the stage 0 fixed fixture. `--probe-report` (needs `DEMO_ENVIRONMENT=yes`) creates a DEMO report, retries it identically (expects 200 `duplicate`) and reads it back once from the feed. `--write-demo` adds a DEMO report create/retry/conflict/read-back and a route probe through the simulator. |
| `seed_demo.sh PRODUCT_URL [--automation-url URL] [--at LAT,LON]` | Demo data through the public APIs via Lane F's simulator. |
| `backup.sh [product\|observations] [DIR]` | `pg_dump` custom format, mode 600, with a JSON sidecar. |
| `restore_check.sh FILE` | Restores into a throwaway database, counts rows, drops it. A backup is unverified until this passes. |
| `reset_db.sh product\|observations --yes-delete-demo-data` | Empties one dataset and restarts its service. |
| `provision_observation_db.sh` | Separate role and database for automation, plus an isolation check. |
| `enable_automation_proxy.sh on\|off` | Adds or removes the observation hostname in Caddy, validating before reload. |

`seed_demo.sh`, `reset_db.sh` and `--write-demo` refuse to run unless `DEMO_ENVIRONMENT=yes`.
There is no retention policy or scheduled backup; for the demo host, run `backup.sh` before each
deployment (the deploy script does) and before any reset. Replication is not configured, and a
backup on the same disk does not survive losing the host.

## HTTPS and Vultr

Inputs only the operator can supply — none exist in this repository:

| Input | Where it goes |
|---|---|
| A Vultr instance (Ubuntu 24.04) and your SSH public key | `vultr/cloud-init.yaml` as user data, key replaced |
| A hostname whose DNS A record points at the instance | `PRODUCT_HOSTNAME` in the host's `.env` |
| Real `PRODUCT_DB_PASSWORD` and `AUTOMATION_PUBLISH_KEY` | `/opt/campus/shared/.env` on the host, mode 600 |
| For automation: `OBSERVATIONS_DB_PASSWORD`, a second hostname | same file; `OBSERVATION_HOSTNAME` |

If you have no domain, an IP-based name such as `203-0-113-10.sslip.io` is a possible fallback.
That is a proposal, not something tested here: check that a certificate can be issued for it
before relying on it.

Steps, once those exist:

1. Create the instance with `vultr/cloud-init.yaml`. It installs Docker, creates the `deploy` user
   and `/opt/campus`, and opens only SSH, 80 and 443. Choose the plan after measuring the tile
   build; serving needs far less than building, and tiles can be built elsewhere and uploaded.
2. On the host, create `/opt/campus/shared/.env` from `.env.example` with real values,
   `API_BIND=127.0.0.1`, and `chmod 600` it. For routing, upload the built `custom_files/` to
   `/opt/campus/shared/custom_files/` and set `VALHALLA_URL=http://valhalla:8002`.
   Finish the upload before deploying; this directory is staging only. Each routing deployment
   copies the serving files into its own release directory, so later uploads cannot change a
   running or rollback release. Allow disk space for a tile copy per retained release.
3. From a checkout: `infra/vultr/deploy.sh deploy@HOST <commit-on-main> [--profile routing] [--profile automation] [--demo]`.
4. From a phone on mobile data (not the host's network): open `https://HOSTNAME/healthz`, then run
   the app with `EXPO_PUBLIC_API_URL=https://HOSTNAME`.

`deploy.sh` refuses a commit that is not on `origin/main`, refuses placeholder settings, takes a
lock on the host, uploads an export of that exact commit (never a working tree), dumps the product
database, builds, provisions the observation database first when automation is selected, starts
the stack, and runs `check_stack.sh` over HTTPS. With `--profile routing` acceptance also requires
`routing=valhalla` and a real successful route request, so broken routing fails the deployment. With
`--demo` (a designated demo host only) it then creates a DEMO report, retries it identically and
reads it back, once. Without `--demo` the write path is not exercised and `deployments.log` records
`write_probe=skipped`. Only after acceptance does it move the `current` link and record the release.
If a rollout fails after the new stack started, `current` stays on the last good release and
`/opt/campus/failed_release` names the failed one.

`rollback.sh deploy@HOST [--current|--previous]` restarts a known-good release and probes it. After a
failed rollout (the `failed_release` marker exists) it restarts `current`, the last good release,
which also works after the first upgrade when no `previous` exists; otherwise it restarts `previous`.
The flags override that choice. Each deployment attempt has a unique directory, even for the
same commit, and rollback mounts that release’s tile snapshot. Pass the same `--profile` flags
as the deploy. **It does not roll the
database back.** Product and observation migrations run at service start and are additive so far;
if a release ever ships a migration the previous code cannot read, fix forward or restore a
checked backup on purpose.

Keep to one API process. Live updates and the expiry scheduler are in-process, so a second worker
would leave some phones without change hints.

Not built: a deploy job in CI (it needs the host and secrets above), scheduled backups, managed
PostgreSQL or any redundancy, and a least-privilege product role — the product API still connects
as the database's bootstrap role.

## Settings

| Setting | Used by | Rule |
|---|---|---|
| `PRODUCT_DB_PASSWORD` | `db`, `api` | product role only |
| `AUTOMATION_PUBLISH_KEY` | `api`, `automatic`, simulator CLI | server-side only; never the collector or an Expo public value |
| `API_BIND`, `API_PORT` | `api` | `127.0.0.1` on a public host |
| `VALHALLA_URL`, `VALHALLA_IMAGE` | `api`, `valhalla` | empty URL means fixed example routes |
| `PRODUCT_HOSTNAME`, `CADDY_IMAGE` | `caddy` | hostname must resolve to the host |
| `OBSERVATIONS_DB_PASSWORD` | `db` init, `automatic` | different from the product password |
| `PRODUCT_API_URL` | `automatic` | where the worker publishes |
| `OBSERVATION_HOSTNAME`, `AUTOMATION_BIND`, `AUTOMATION_PORT` | `caddy`, `automatic` | only with the automation profile |
| `DEMO_MODE` | `automatic` | off by default |
| `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_AUTOMATION_API_URL` | the apps | public URLs only |
