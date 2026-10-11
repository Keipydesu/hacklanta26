# 028. Circular rider locations and hazard pictograms

- Status: Accepted
- Date: 2026-10-10

Operator direction replaces generic map pins for device locations with blue circular markers,
and generic hazard pins with category pictograms. A location circle represents an existing
device fix, never a searched or manually placed endpoint. Its halo is decorative, not a measured
accuracy radius. Device-derived endpoints are read-only; choosing a map point or search result
produces the existing draggable endpoint pin. Swapping endpoints preserves this distinction.

All seven hazard kinds have bundled vector icons, with an exclamation fallback. Keep source,
evidence, pending and selection semantics; icons do not assert verification or severity.
No new location collection, dependencies or public API changes.
