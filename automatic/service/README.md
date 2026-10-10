# Observation service · stage 0

An independent FastAPI **nonpersistent in-memory stub**, with no product imports or product DB
credentials. Ingests fixture observations, enforces atomic UUID retries/conflicts and limits;
no clustering, decay worker, outbox, database or automatic publication runs on ingestion.
Use one worker only. Restarting loses all observations.

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
