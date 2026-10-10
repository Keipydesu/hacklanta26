# 015. Map first, visual controls before explanatory copy

- Status: Accepted
- Date: 2026-10-10

## Decision

Operator review rejected the initial small map and text-heavy UI concept. The map now fills
the working screen, with compact supporting controls and an expandable bottom task panel.
Use short labels, shared icons and concise route metrics; move supporting explanation into
details while preserving visible errors, source/evidence, expiry and delivery states.

Adapt the supplied Exhibitionist guide's consistency and state principles to native mobile.
Do not copy its web palette, typography, desktop control density or product theme. Preserve
mobile touch targets and the app's scooter/bike identity. The renderer migration stays in #27.
See the [mobile UI guide](../../mobile/docs/UI-GUIDE.md).

## Supersedes

The initial stacked header/map/large-card layout documented in the working UI brief.
Refines decision 010's trip-first direction; no API, routing mode or delivery-order changes.
