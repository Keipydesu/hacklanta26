# Stage 0 local stack

Docker with Compose required. From the repository root:

```sh
cp infra/.env.example infra/.env
# Replace the two development credential placeholders in infra/.env.
docker compose --env-file infra/.env -f infra/docker-compose.yml up --build -d
docker compose --env-file infra/.env -f infra/docker-compose.yml ps
curl http://localhost:8000/healthz
docker compose --env-file infra/.env -f infra/docker-compose.yml down
```

Starts only `api` and `db` (PostgreSQL + PostGIS). Verified on local Docker, including health and
live product/publisher probes with automation absent. The PostGIS tag may use amd64 emulation on
Apple Silicon. No Valhalla, TLS, Vultr deployment or automatic services are configured at stage 0.

The API uses memory despite the healthy database: restarting the API loses reports/revisions.
The DB volume persists until explicitly removed; normal `down` preserves it. `DATABASE_URL` is
reserved for milestone 1. Health labels storage as memory rather than claiming DB-backed health.

The observation service starts separately using its own [README](../automatic/service/README.md).
It will later use a separate observation database/user; never the product credential.
