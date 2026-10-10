# 018. Unified light and dark appearance

- Status: Accepted
- Date: 2026-10-10
- Supersedes: Decision 011's independent map switch and decision 016's system-only interface appearance.

The header sun/moon switch changes the interface, status bar and MapLibre style together.
Start with device appearance; a manual choice lasts for this app session. A new launch follows
the device again. Keep one theme context for all native controls and the map theme prop.

Light uses Positron and dark uses Dark Matter through the existing map bridge. Switching must
preserve camera, endpoint pins, report draft and overlays. The control exposes a Dark mode
switch with checked state. It remains available on Map, Trip and Report without expanding details.

Verified both directions on iPhone 17 Simulator with actual OSM styles and retained markers.
