# Product live updates

Connect to `ws://localhost:8000/v1/live` locally, `wss://<product-host>/v1/live` when deployed.
Each text frame is JSON matching `HazardsChanged` in [openapi.yaml](openapi.yaml):

```json
{"type":"hazards.changed","data":{"hazard_id":"920740f0-0293-4495-b8e9-c1dccd5492be"}}
```

Emit after committed creates, updates, resolutions, and expiry; never before a write succeeds.
No raw observations or ride traces. Duplicate retries need not emit changes.
Clients debounce a refetch of their visible bounding box, and refetch on every reconnect.
Messages are hints, not a durable event log: missed frames must not make the map incorrect.
Clients also hide expired hazards locally. Reporting and browsing remain usable when live updates
or routing are unavailable. The stage 0 in-memory server has no database commit; a successful
memory mutation is its change boundary. Production persistence comes in milestone 1.
