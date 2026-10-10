# Stage 0 contracts

The checked-in OpenAPI 3.1 files are the shared API boundary. Product port 8000 and observation
port 8001 are separate services. After stage 0 review, changes require coordinated approval.

From the repository root, install Python 3.11+ and uv, then:

```sh
uv sync --project contracts
uv run --project contracts python contracts/scripts/validate.py
python3 contracts/scripts/publish_fixture.py --dry-run
```

The validator checks both OpenAPI documents and all fixture payloads (invalid fixtures must fail).
Cross-field geometry, time ordering, future timestamps, lifecycle, and idempotency require the
stub behavior tests in the next stage 0 checkpoint; JSON Schema alone cannot enforce them.

Fixtures use a fixed clock of `2026-10-10T01:23:45Z`. They are illustrative GSU demo data, never
real rides. When displaying offline, shift timestamps together to the current time. Never shift
an in-flight retry's body. The live publisher shifts its timestamps once per invocation.

The fixture hazard IDs are examples, not IDs clients can dictate for real server writes. Route
fixtures are fixed illustrations, not computed navigation or evidence that a route avoids hazards.

## Live publication probe

Start the product stub with a development-only `AUTOMATION_PUBLISH_KEY` set in its environment.
Set the same key in this CLI's environment, then run from the repository root:

```sh
python3 contracts/scripts/publish_fixture.py --lifecycle
```

This performs create → identical retry → update → stale rejection → resolution through HTTP.
Use a fresh `--id <uuid>` or restart the nonpersistent stub before repeating. Omit `--lifecycle`
to leave revision 1 visible on the map. Override `--url` or `PRODUCT_API_URL` for a dedicated demo
server. Never place this key in Expo variables or the collector; never run demo writes in production.

## Cases

- `manual-retry` repeats `manual-report`; `manual-conflict` reuses the ID with a different description.
- `automatic-retry` repeats revision 1; `automatic-update` advances to 2; `automatic-stale`
  replays revision 1 after that update; `automatic-conflict` changes revision 1's body.
- `automatic-resolved` advances to revision 3. `*-expired` are valid but omitted from active reads.
- `events-conflict` and `points-conflict` reuse their baseline observation IDs with different data.
  Identical observation retries use the baseline fixtures unchanged.
- `*-invalid` fail schema validation. Empty observation batches are valid no-ops.
- Points belong to ride `e50b27da-d972-430e-b5f8-9c6b20fd4151` in the URL path.

Coordinates are `lat`/`lon` in objects, `[lon, lat]` in GeoJSON. No cross-source merging.
