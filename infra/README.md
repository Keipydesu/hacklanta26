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
| `db` | always | Compose network only, no published port | PostGIS; named volume `campus_product-data` |
| `api` | always | `API_BIND:API_PORT` (default `0.0.0.0:8000` for LAN development) | one worker; health checks the product only |
| `valhalla` | `routing` | internal `8002` | serves prebuilt tiles mounted read-only |
| `caddy` | `https` | 80, 443 | proxies `/v1/*` and `/healthz`, everything else 404 |
| `automatic` | `automation` | `AUTOMATION_BIND:AUTOMATION_PORT` (default `0.0.0.0:8001`) | observation API + worker; own database role; not a dependency of anything |

## What has actually been run

| Piece | Status |
|---|---|
| Compose file, all profiles parse | run locally (`docker compose config`) and in CI |
| Images build from locked manifests; manual stack starts healthy; `check_stack.sh`; `backup.sh` → `restore_check.sh`; observation role isolation; automation start/stop independence; `reset_db.sh`; Caddyfile validation | exercised by the CI `stack` job on every change under `infra/` — see that job's result on the PR, not this table, for the current state |
| `valhalla/build_tiles.sh`, the `routing` profile serving real tiles | **not run** |
| `vultr/cloud-init.yaml`, `vultr/deploy.sh`, `vultr/rollback.sh`, real TLS issuance | **not run** against a real host — no host, hostname or credentials existed. The remote deploy/rollback logic was exercised locally with mocked `docker`/`flock` for: A/B/C failed rollout restarts B; first-upgrade failure restarts the only release; successful-then-bad release rolls back to `previous`; failed route or write probes leave `current` untouched. `--probe-route` and `--probe-report` were run against the stage 0 backend (fixture rejected, report probe passed). |
| `seed_demo.sh`, `check_stack.sh --write-demo` | **not run** against a real stack (they call Lane F's simulator) |

Nothing is deployed. There is no public URL yet.

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

The Compose project is now named `campus`, so volumes are `campus_*`. A stage 0 volume named
`infra_product-data` is no longer used (the stage 0 API never wrote to it).

### Routing (optional)

```sh
infra/valhalla/build_tiles.sh path/to/extract.osm.pbf   # or --geofabrik (needs osmium)
# then in infra/.env:  VALHALLA_URL=http://valhalla:8002
docker compose --env-file infra/.env -f infra/docker-compose.yml --profile routing up -d --wait
infra/check_stack.sh http://localhost:8000 --expect-routing valhalla
```

The script builds in a temporary directory, serves the new tiles on a private port, requests a
real pedestrian route across GSU (16 km/h, step penalty 600), and only then replaces
`valhalla/custom_files/`, keeping the previous set in `previous/`. It writes `manifest.json` with
the extract checksum, bounding box, date and engine image digest. Extracts, tiles and logs are
ignored by git.

Unverified until someone runs it: that the `ghcr.io/valhalla/valhalla:3.9.1` tag is the right
engine (it is the version Lane C recorded its fixtures with; CI only checks that the tag exists),
the `valhalla_build_config` flags, and memory, disk and time for the metro Atlanta extract. Record
those here on first use, and pin the image digest from `manifest.json`. With an empty
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
The flags override that choice. Pass the same `--profile` flags as the deploy. **It does not roll the
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
