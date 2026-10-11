# 024. Expanded trip search above the keyboard

- Status: Accepted
- Date: 2026-10-10
- Supersedes: Decision 015's compact-panel height limits while editing trip endpoints only.

At the operator's request, follow the supplied Apple Maps reference for search layout:
editing either endpoint automatically fills the available safe-area height above the keyboard.
Do not apply the resting 36% or expanded 65% height caps to search. Keep the active input pinned
above independently scrolling results; hide the other endpoint, route cards and task tabs until
search closes. Preserve the existing palette, fonts, fixture label and provider attribution.

Choosing a place, Done, Cancel, Current location or Choose on map dismisses the keyboard and
restores the previous trip-panel expansion state. Keyboard dismissal alone does not collapse
search or erase the query. Keep the map mounted and retain its resting layout beneath the sheet.
No API, dependency, location-permission or route-selection changes.

Verification: TypeScript and 13 trip/search behavior tests passed. No simulator was running;
native keyboard layout, small screens and larger text still require visual verification.
