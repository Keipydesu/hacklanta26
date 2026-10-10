# Lane E: Dashboard

The web view. It has two audiences: judges watching the projector, and campus facilities staff deciding what to fix.

**Owns:** `dashboard/`.
**Uses:** the REST API and the WebSocket.

## What to build

1. **Map base** (`src/LiveMap.tsx`). MapLibre GL JS, centered on GSU (33.7531, -84.3853) at zoom 16. A no-key basemap style works for the weekend, for example `https://tiles.openfreemap.org/styles/liberty`. Keep the style URL in one constant so it can be swapped.
2. **Data sources and layers.**
   - Events: GeoJSON source from `/v1/events`, drawn as a `heatmap` layer weighted by `peak_g`.
   - Hazards: GeoJSON source from `/v1/hazards`, drawn as fill plus outline. Color by `kind`, opacity by `score`. Add a text label so color is not the only signal.
   - Cells: GeoJSON source from `/v1/cells`, off by default, with abandoned cells hatched or outlined.
   - Refetch on map move, debounced, using the visible bounds as `bbox`.
3. **Live updates** (`src/api/live.ts`). WebSocket client with automatic reconnect and backoff.
   - `event.created`: add the point to the events source and show a pulsing marker for about 10 seconds.
   - `hazards.updated`: replace the hazards source and refresh the table.
4. **Hazard table** (`src/HazardTable.tsx`). From `/v1/report/top?limit=10`: rank, kind, label, event count, rider count, last seen. Clicking a row calls `map.flyTo` and highlights the polygon.
5. **Route comparison** (`src/RouteCompare.tsx`). Click two points on the map, call `POST /v1/route`, draw both lines. Shortest is dashed, lower-risk is solid. Show distance, time, and risk for each side by side, plus the extra distance of the lower-risk route as a plain sentence ("70 m longer, avoids 2 hazards").
6. **Projector mode.** `?mode=live` shows only the map and a large counter of events today. Large type, high contrast, no controls.
7. **Facilities view** (`src/Report.tsx`). The table plus a small static map per hazard, laid out to print on one page. This is the "someone can act on it" part of the social good pitch.
8. **Build.** Read the API base from `VITE_API_URL`. `npm run build` outputs `dashboard/dist`, which Lane G serves.

## Watch out for

- Derive the WebSocket URL from `VITE_API_URL` by swapping `https` for `wss`. A page served over HTTPS cannot open a plain `ws` connection.
- Use the generated types in `src/api/types.gen.ts`. Do not hand-write response shapes.
- A week of events is a few thousand points. Load once, then append from the socket. Do not refetch everything on each message.
- Develop against `contracts/fixtures/` first. Every view should render from fixtures before the real backend exists.
- Copy says "lower-risk route", never "safe route".

## Done when

- A posted event shows a pin within a second, readable from the back of the room.
- A new hazard appears on the map and in the table without a page reload.
- Clicking a table row flies to that hazard.
- Two clicks draw both routes with stats.
- The facilities view prints cleanly on one page.
