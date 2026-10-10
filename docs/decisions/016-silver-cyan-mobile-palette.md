# 016. Silver and cyan-blue accents across light and dark appearance

- Status: Accepted
- Date: 2026-10-10

## Decision

Use the [operator-selected palette](https://coolors.co/palette/353535-3c6e71-ffffff-d9d9d9-284b63):
charcoal `#353535`, teal/cyan `#3c6e71`, white `#ffffff`, metallic silver `#d9d9d9`,
and deep blue `#284b63`. Silver establishes quiet boundaries; cyan-blue marks selection;
deep blue marks the primary action. White and charcoal surfaces follow device appearance.
Metallic silver is a color role, not a requirement for gradients or decorative depth.

Preserve text/icon state cues and mobile touch targets. White foreground on cyan and blue
has calculated contrast of 5.74:1 and 9.22:1 respectively. Error reds remain semantic exceptions,
with a lighter error foreground in dark mode. Existing hazard-source colors remain pending
the separate OSM map integration; they are evidence encodings, not brand accents.

The UI follows system appearance without adding an unwired in-app toggle. The current native
map receives the corresponding appearance hint; final OSM light/dark style assets remain
the map workstream's responsibility.

## Supersedes

The initial forest-green/pale-lime visual treatment in the UI concept and mobile guide.
Decisions 014 and 015's trip-first, map-first and visual-first principles remain unchanged.
