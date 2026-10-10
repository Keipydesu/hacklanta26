# 017. Fiord dark basemap

- Status: Accepted
- Date: 2026-10-10
- Supersedes: Decision 011's Dark Matter style only.

At operator request, dark appearance selects bundled Fiord from openmaptiles/fiord-color-gl-style.
Retain Positron for light appearance and decision 016's unified appearance switch. Adapt tile and
font endpoints to OpenFreeMap, preserving Fiord colors and cartographic layers. No API key is
required. EXPO_PUBLIC_MAP_DARK_STYLE_URL still overrides the default.

The pinned upstream revision, changes and licenses are recorded in
[map assets](../../mobile/assets/maps/README.md). Credits remain accessible through map attribution.
The original Fiord sprite is fetched from GitHub Pages; tiles and glyphs remain on OpenFreeMap.
Camera, markers, hazard/route layers and offline fallback retain the existing map bridge behavior.
