# 015. Textured metallic silver controls

- Status: Accepted
- Date: 2026-10-10
- Supersedes: Decision 014's flat-silver treatment only.

The operator supplied a metal-grain reference and requested visible texture. Bundle that
unaltered reference as `mobile/assets/silver-texture.png`; render it at 22% opacity over
silver secondary buttons and unselected hazard categories in both appearances. Use charcoal
foregrounds on these silver surfaces. Cyan selections and blue primary actions remain solid.

The shared decorative layer cannot intercept touches and is hidden from accessibility.
Do not texture map tiles, text, hairline separators or large panels. No dependencies or
runtime asset downloads are introduced. The asset was supplied by the operator for this UI.
