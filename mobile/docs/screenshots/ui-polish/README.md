# Map home and destination search

Captured on 2026-10-10 in Xcode's iPhone 17 Pro simulator, iOS 26.1, Expo Go SDK 57.
These show the labeled fixture preview, not production hazards or verified routing.
The blue gear on the search capture belongs to Expo Go development tools.

- [Collapsed map home](map-home.png): destination input, floating appearance/recenter/report controls, no task tabs.
- [Destination search with keyboard](destination-keyboard.png): expanded sheet, pinned input, readable results above the software keyboard.

Checked home → search → result selection and the floating report action. TypeScript, 69 scoped
map/trip/search/route tests, documentation links and whitespace checks pass after rebasing onto
main. Physical-device GPS/recenter, Android, larger text and screen-reader checks remain pending.

Run `npm ci --prefix mobile` then `npm start --prefix mobile` for fixture preview; a reachable
product API with Valhalla is required for real route comparison. No dependencies added.
