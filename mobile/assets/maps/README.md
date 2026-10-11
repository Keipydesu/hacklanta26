# Dark map: Bypass Night, generated from Fiord

`bypass-night.json` is the dark basemap ([decision 026](../../../docs/decisions/026-bypass-film-theme.md)).
`npm run map:night` generates it from `fiord.json` by replacing colours, opacities and street-label
spacing; sources, layer order, filters and credits are Fiord's. Edit the script, not the output.
The notes below describe the bundled Fiord source file.

Adapted from [openmaptiles/fiord-color-gl-style](https://github.com/openmaptiles/fiord-color-gl-style)
commit `a7faefb06d6bed62c1fa05b45ac20d90051067ed`, retrieved 2026-10-10.
The original colors, layer ordering and cartographic rules are preserved. Changes:

- TileJSON uses the existing OpenFreeMap planet endpoint instead of keyed MapTiler tiles.
- Glyphs use OpenFreeMap Noto Sans Regular/Italic in place of the Metropolis stacks.
- Attribution credits the design and data providers in the map control.

The original public Fiord sprite remains hosted on openmaptiles.github.io. Map viewing therefore
requests its small sprite assets from GitHub Pages; viewed tile coordinates still go to OpenFreeMap.
No keys, executable code or new packages are included. See [upstream license](FIORD-LICENSE.md)
for BSD-3-Clause code and CC-BY-4.0 design terms and original credits.
