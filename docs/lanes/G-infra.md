# Lane G: Infra and Vultr

Makes the whole thing run with one command locally and one command on Vultr. Self-hosting the routing engine here is the Vultr story for the prize, so Valhalla is the priority, not an afterthought.

**Owns:** `infra/`, `backend/Dockerfile`, `automatic/Dockerfile`, `README.md`, `.github/`.

## What to build

1. **Manual product Compose stack** (`infra/docker-compose.yml`), extending the phase 0 file:

   | Service | Image | Notes |
   |---|---|---|
   | `db` | `postgis/postgis:16-3.4` | Named volume, health check with `pg_isready` |
   | `api` | built from `backend/Dockerfile` | Waits for `db` to be healthy; port 8000 |
   | `valhalla` | `ghcr.io/valhalla/valhalla-scripted:latest` | Mount `infra/valhalla/custom_files` at `/custom_files`; port 8002 |
   | `caddy` | `caddy:2` | Ports 80 and 443; proxies the API over HTTPS |

   Automation is an optional Compose profile, off by default. Add an `automatic` service built from `automatic/Dockerfile`, with its own health check, observation API, worker and database credentials. The manual API must not depend on that service. Create a separate observation database on the same local PostgreSQL server for demo convenience; it is a separate dataset, not a replica. Keep private DB credentials scoped to each service.

2. **Backend image** (`backend/Dockerfile`). Slim Python base, install from `pyproject.toml`, run `uvicorn app.main:app --host 0.0.0.0 --port 8000`.
3. **Valhalla tiles** (`infra/valhalla/build_tiles.sh`).
   - Download the Georgia extract: `https://download.geofabrik.de/north-america/us/georgia-latest.osm.pbf`.
   - Clip to metro Atlanta so the build takes minutes: `osmium extract -b -84.55,33.60,-84.20,33.95 georgia-latest.osm.pbf -o custom_files/atlanta.osm.pbf`.
   - Start the container. The scripted image builds tiles from any `.osm.pbf` in `/custom_files` and serves on 8002.
   - Set `build_admins=False` and `build_time_zones=False` to shorten the build. Set `force_rebuild=True` once if the extract changes.
   - Check with a real request between two GSU points and hand the working `curl` to Lane C.
4. **Caddy** (`infra/Caddyfile`).
   - Proxy `/v1/*` and `/healthz` to `api:8000`. WebSockets pass through without extra config.
   - Enable its proxy configuration only with the automation profile; use a separate HTTPS hostname for the optional observation API. Proxy it to the automatic service without changing the product API paths.
   - No static web app is served; return 404 for unmatched paths.
   - Use a real domain if the team has one. Otherwise use `<server-ip>.sslip.io` as the hostname so Caddy can obtain a certificate.
5. **Vultr deploy** (`infra/vultr/`).
   - `cloud-init.yaml`: install Docker and the compose plugin, create a deploy user, open ports 22, 80, 443.
   - Create one compute instance: Ubuntu 24.04, size it after checking current resource requirements for the manual stack and optional automation. Do it in the Vultr console or with `vultr-cli`.
   - `deploy.sh <host>`: copy the repo and `.env`, run `docker compose up -d --build`, then call `/healthz`.
   - Write the public URL into `README.md` once it is live.
6. **Operations scripts.**
   - `infra/reset_db.sh`: reset explicitly selected demo databases only: product reports/hazards, or automation observations/derived hazards/outbox. Never reset a production database; document which dataset is affected.
   - `infra/seed_demo.sh`: default to manual report fixtures against the product API. An explicit automatic-demo option seeds observation scenarios and publication fixtures against the correct separate base URLs.
   - `infra/.env.example` with every variable from ARCHITECTURE.md section 9. Keep the publication key only in API/worker environments; never use an Expo public variable for it.
7. **README.** Quick start for local development, the deploy command, and how the phones get their API URL.
8. **CI, early, as manifests arrive — not stretch.** `.github/workflows/ci.yml` with one path-filtered
   job per lane, including shared contract dependencies, as that lane's manifest/build lands (start with lane 0's contract/fixture check),
   superseded runs auto-cancelling on the same branch. Per [decision
   001](../decisions/001-mvp-delivery-workflow.md) and the [roadmap](../ROADMAP.md), CI is the
   routine validation gate — get it running early rather than deferring it. Add deploy-from-`main`
   to the workflow once step 5 above is working and `main` is passing; never deploy a feature
   branch.
9. **Stretch.**
   - Vultr Object Storage (S3 compatible) for the raw recorded rides.
   - Database redundancy proposal: Vultr Managed PostgreSQL with a primary and failover replica, replacing the deployed `db` container. Keep local Compose unchanged. This option is not yet selected or provisioned; follow the checks in ARCHITECTURE.md section 9 before adopting it.

## Watch out for

- Vultr product names and plan sizes change. Confirm them in the console instead of trusting this file.
- Never commit `.env` or any Vultr API key.
- Valhalla keeps tiles in the mounted folder. Add its output to `.gitignore`; only the build script belongs in git.
- Phones need HTTPS. Get TLS working before anyone tries the app against the server.
- Run `seed_demo.sh` on the day of the demo, because the abandonment scenario is timed relative to now.

## Done when

- Default Compose brings up the manual product services and `/healthz` returns ok with automation absent.
- Valhalla answers a route request between two GSU points.
- One command deploys to Vultr and the phone can access the API over HTTPS.
- Default seed shows manual hazards; optional automation publishes labeled hazards through HTTPS.
- Stopping automation leaves manual report creation, hazard reads and routing operational.
- The README lets a teammate get running without asking questions.
