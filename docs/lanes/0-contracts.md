# Lane 0: Contracts and independent skeletons

Run first. Freeze the integration boundary before the manual and automatic tracks build independently.

**Owns:** `contracts/`, `backend/app/schemas.py`, initial skeletons in other lanes until handoff.

## What to build

1. **Product specification.** `contracts/openapi.yaml` covers ARCHITECTURE.md section 5: manual submissions, revisioned automatic publication, combined hazard reads, routing, health. Define validation, all status codes, bearer auth for publication, report idempotency, hazard lifecycle, sources and evidence labels. `ws-messages.md` defines `hazards.changed` and refetch-on-reconnect behavior.
2. **Automation specification.** `contracts/automatic.openapi.yaml` covers section 6 on a separate base URL: events, ride points (including UUIDs and source), health. Define internal detector types under `automatic/detector/`. No manual-product dependency on these types.
3. **Fixtures.** Around GSU, include `manual-report.json`, `automatic-hazard.json`, `hazards.geojson` (one of each source), `route.json`, `events.json`, and `points.json`. Include retry, stale-revision, resolved, expired and invalid examples. GeoJSON is longitude first. Provide a one-command fixture publisher with a placeholder environment credential, never a real key.
4. **Independent skeletons.** Product FastAPI stub accepts manual reports and automatic fixtures into clearly nonpersistent memory, and returns the combined feed. Expo mobile skeleton has map/report/route screens, without sensors. Separate automatic detector, collector, service and publication client skeletons consume their own contract. Product routing stub returns a route fixture; there is no product-side risk worker.
5. **Development startup.** Compose starts product API and product DB only; generate product API types for mobile and automation publication, and observation API types for the collector. Document separate startup of automation stubs. Add manifests in the owning directories, ignore generated runtime data and secrets, and hand off ownership.

## Done when

- Mobile renders fixtures without any automatic process running.
- A manual POST creates a fixture hazard; a standalone authenticated PUT creates a separately labeled automatic hazard in the same feed.
- The shared schema includes expiry, source/evidence labels and revision/idempotency semantics.
- Product and observation APIs have distinct base URLs and independently generated clients.
- Stubs are runnable and clearly marked as nonpersistent before handoff.
