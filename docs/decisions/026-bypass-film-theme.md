# 026. Bypass film theme for the mobile app

- Status: Accepted
- Date: 2026-10-10
- Supersedes: decision 016's silver/cyan palette, decision 017's metallic texture, decision 019's
  choice of Fiord as the dark basemap, and the Satoshi typography in the mobile UI guide.

At operator request the app adopts the look of the Bypass demo film: night-blue map and panels,
amber primary actions, one hazard red, a mint lower-risk route, condensed capital headings and
small mono kickers. Decision 018's unified light/dark switch stays; light appearance uses the
film's day palette over Positron. Decisions 014 and 015 (trip-first, map-first layout) are unchanged.

- **Palette.** `mobile/src/ui/mapColors.ts` holds the values and `theme.ts` the roles. Primary
  actions are amber with dark ink; a selected control is a light pill (dark pill in light
  appearance); other controls are raised panels with a hairline edge. No texture layer.
- **Type.** Barlow Condensed (headings, button labels, route metrics, in capitals), Overpass
  (body) and Overpass Mono (kickers, source labels, facts). All are SIL OFL 1.1 and are committed
  under `mobile/assets/fonts/` with their licences; the Fontshare fetch step is removed. Each face
  is its own file: do not synthesize weights. System text remains the fallback until fonts load.
- **Dark basemap.** `assets/maps/bypass-night.json` is generated from the bundled Fiord style by
  `scripts/build-night-style.mjs`, which changes colours, opacities and street-label spacing only.
  Fiord's sources, layers, filters and credits are kept, so decision 019's licence notes still
  apply. `npm run map:night:check` (part of `pretest`) fails if the committed file is stale.
- **Hazards on the map.** Both sources use the same hazard red for the zone, with a soft halo.
  Source is carried by the marker glyph and by text, never by hue alone: a diamond with an
  exclamation mark is a community report, a pulsing ring is an automatic hazard. Titles and the
  selected-hazard sheet still read "Community report" or "Automatically detected · <evidence>".
  The selected marker turns amber.
- **Routes.** Lower-risk is solid mint (teal in light appearance) over a casing in the map's ground
  colour, with a glow; shortest is dashed straw (steel in light appearance). Trip endpoints are
  lettered A and B. Bike-lane colours from decision 025 are unchanged and stay distinct from both
  routes (covered by the existing colour-distance test).

Rejected: hue-coding hazard source on the map (the film uses one hazard colour, and hue alone is
not accessible); restyling the map at runtime with paint overrides (harder to test than a
generated style); keeping a second, separately themed dark mode.

Not verified on a device or simulator: this change was made without an Expo runtime. The Node test
suite and a stand-in type-check passed; screenshots under `mobile/docs/screenshots/` predate it.
