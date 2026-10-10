# Lane G: Infra and Vultr

Makes the whole thing run with one command locally and one command on Vultr. Self-hosting the routing engine here is the Vultr story for the prize, so Valhalla is the priority, not an afterthought.

**Owns:** `infra/`, `backend/Dockerfile`, `README.md`, `.github/`.

## What to build

1. **Compose stack** (`infra/docker-compose.yml`), extending the phase 0 file:

   | Service | Image | Notes |
   |---|---|---|
   | `db` | `postgis/postgis:16-3.4` | Named volume, health check with `pg_isready` |
   | `api` | built from `backend/Dockerfile` | Waits for `db` to be healthy; port 8000 |
   | `valhalla` | `ghcr.io/valhalla/valhalla-scripted:latest` | Mount `infra/valhalla/custom_files` at `/custom_files`; port 8002 |
   | `caddy` | `caddy:2` | Ports 80 and 443; serves the dashboard and proxies the API |

2. **Backend image** (`backend/Dockerfile`). Slim Python base, install from `pyproject.toml`, run `uvicorn app.main:app --host 0.0.0.0 --port 8000`.
3. **Valhalla tiles** (`infra/valhalla/build_tiles.sh`).
   - Download the Georgia extract: `https://download.geofabrik.de/north-america/us/georgia-latest.osm.pbf`.
   - Clip to metro Atlanta so the build takes minutes: `osmium extract -b -84.55,33.60,-84.20,33.95 georgia-latest.osm.pbf -o custom_files/atlanta.osm.pbf`.
   - Start the container. The scripted image builds tiles from any `.osm.pbf` in `/custom_files` and serves on 8002.
   - Set `build_admins=False` and `build_time_zones=False` to shorten the build. Set `force_rebuild=True` once if the extract changes.
   - Check with a real request between two GSU points and hand the working `curl` to Lane D.
4. **Caddy** (`infra/Caddyfile`).
   - Proxy `/v1/*` and `/healthz` to `api:8000`. WebSockets pass through without extra config.
   - Serve `dashboard/dist` for everything else, falling back to `index.html`.
   - Use a real domain if the team has one. Otherwise use `<server-ip>.sslip.io` as the hostname so Caddy can obtain a certificate.
5. **Vultr deploy** (`infra/vultr/`).
   - `cloud-init.yaml`: install Docker and the compose plugin, create a deploy user, open ports 22, 80, 443.
   - Create one compute instance: Ubuntu 24.04, 2 vCPU and 4 GB RAM is enough for metro Atlanta tiles plus Postgres. Do it in the Vultr console or with `vultr-cli`.
   - `deploy.sh <host>`: copy the repo and `.env`, build the dashboard, run `docker compose up -d --build`, then call `/healthz`.
   - Write the public URL into `README.md` once it is live.
6. **Operations scripts.**
   - `infra/reset_db.sh`: truncate `events`, `points`, `hazards`, `cells`. The API has no delete endpoint on purpose.
   - `infra/seed_demo.sh`: reset, then run the simulator's `baseline`, `pothole`, `closure`, and `demo_seed` scenarios in order.
   - `infra/.env.example` with every variable from ARCHITECTURE.md section 9.
7. **README.** Quick start for local development, the deploy command, and how the phones get their API URL.
8. **Stretch.**
   - Vultr Object Storage (S3 compatible) for the raw recorded rides.
   - Vultr managed Postgres in place of the `db` container.
   - `.github/workflows/ci.yml` running backend tests and the detection tests.

## Watch out for

- Vultr product names and plan sizes change. Confirm them in the console instead of trusting this file.
- Never commit `.env` or any Vultr API key.
- Valhalla keeps tiles in the mounted folder. Add its output to `.gitignore`; only the build script belongs in git.
- Phones need HTTPS. Get TLS working before anyone tries the app against the server.
- Run `seed_demo.sh` on the day of the demo, because the abandonment scenario is timed relative to now.

## Done when

- `docker compose up` brings up all four services locally and `/healthz` returns ok.
- Valhalla answers a route request between two GSU points.
- One command deploys to Vultr and the dashboard loads over HTTPS.
- `seed_demo.sh` leaves the map showing a pothole hazard and a closure hazard.
- The README lets a teammate get running without asking questions.
