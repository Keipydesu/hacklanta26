# Observation service · stage 0

An independent FastAPI service with no product imports or product DB credentials. Two modes:

- **`AUTOMATION_DATABASE_URL` set** (own PostGIS database, never the product one): durable atomic UUID
  ingestion (`events`, `points`), a serialized worker that clusters hard brakes/bumps (DBSCAN 12 m,
  >=3 events, >=2 rides, EPSG:32616 so Atlanta-scoped), scores with 7-day decay, keeps stable hazard
  identities across evaluations, and writes derived state plus an **outbox** in one transaction. The outbox
  delivers full publications to `PRODUCT_API_URL` with `AUTOMATION_PUBLISH_KEY` (server-side only), in
  revision order per hazard, with capped jittered backoff; 401/409/422 block that hazard until an operator
  runs `outbox.release_blocked` after reconciling. Migrations apply at startup under an advisory lock.
  `/healthz` reports worker state and outbox backlog (pending, blocked, oldest age).
- **Unset**: the stage 0 nonpersistent in-memory stub (no worker).

**Abandonment** (`app/abandonment.py`): H3 res-10 cells from `points` (rides/day in rolling 24 h windows:
recent = last 48 h, baseline = days 2-13, zero days counted). A cell with baseline >= 5 rides/day whose
recent rate is < 30% of baseline, with a neighbor within 2 rings that gained > 130% (zero-baseline or
unseen neighbors are never evidence), is flagged; touching flagged cells become one Polygon
(`kind: abandoned`, score 0.7, `event_count` 0, `ride_count` = baseline rides). Disconnected parts are
separate publications; no convex hulls. Latest per-cell rates are kept in the private `cells` table.
Resolution and window boundaries are internal tuning to agree with Lane F's closure scenario.

**Operator**: `AUTOMATION_DATABASE_URL=... uv run --project automatic/service python -m app.cli status|blocked|release <id>`
(run from `automatic/service`). `rebase` is for a 409 where the product holds a higher revision than ours (e.g. restored backup): it renumbers the
undelivered rows above the revision the operator supplies and re-queues them. It takes the evaluator's advisory lock (waiting for a running evaluation) and refuses while a delivery of that hazard is in flight, so it is safe to run while the service is up. **Acceptance probe** (live processes, HTTP only):
`PRODUCT_API_URL=... OBSERVATION_API_URL=... python3 automatic/tests/acceptance_probe.py` posts a manual report and
simulated brakes at a fresh location, then waits for an automatic hazard attributable to this run (on that location, and new or changed since the pre-ingest feed; an old matching hazard never passes), and checks the manual hazard is unchanged.

Run exactly one process. Tunables live at the top of `app/worker.py` (`MIN_SCORE`, `SCORE_DELTA`,
`REFRESH_MARGIN`, `MATCH_DISTANCE_M`). The product API can be completely stopped (observations keep
landing; the outbox retries) and this service can be stopped without affecting manual reporting.
DB tests: `TEST_AUTOMATION_DATABASE_URL=postgresql://... uv run --project automatic/service pytest ...`
(the tables are dropped); without it `tests/test_durable.py` is skipped.

From the repository root:

```sh
uv sync --project automatic/service --frozen
uv run --project automatic/service uvicorn app.main:app --app-dir automatic/service --host 0.0.0.0 --port 8001
uv run --project automatic/service pytest -c automatic/service/pyproject.toml automatic/tests -q
```

The service's `/docs` serves the separate observation OpenAPI contract. No authentication is
specified for this private development ingress; do not expose the stub publicly.

`app/publisher.py` validates outgoing publication payloads against the product contract and sends
them using HTTP and server-side `PRODUCT_API_URL`/`AUTOMATION_PUBLISH_KEY`. It is a boundary client,
not a durable publisher; the caller must handle failures. Lane D supplies outbox/retry behavior.
`product-api.d.ts` is the generated product contract for TypeScript tooling at this boundary;
the Python publisher validates the same checked-in OpenAPI directly.

The [fixture publisher](../../contracts/README.md) can exercise the product boundary independently
before this service generates any hazards. Never give the collector its publication credential.
