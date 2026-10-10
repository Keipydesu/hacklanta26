# 011. Positron and Dark Matter map themes

- Status: Accepted
- Date: 2026-10-10
- Supersedes: Decision 010's Liberty default style; its MapLibre/WebView, OpenFreeMap, attribution, privacy and routing choices remain.

## Decision

The manual map starts with OpenFreeMap Positron (`https://tiles.openfreemap.org/styles/positron`)
as its light theme. A map control switches to OpenFreeMap Dark (`https://tiles.openfreemap.org/styles/dark`),
which [OpenFreeMap describes as a fork](https://github.com/hyperknot/openfreemap-styles) of the OpenMapTiles Dark Matter style. This keeps both themes
on the same OSM-derived tile service; neither changes the Valhalla routing graph or API.

The choice lasts for the current app session and defaults to Positron on the next launch. The
existing `EXPO_PUBLIC_MAP_STYLE_URL` overrides the light style; `EXPO_PUBLIC_MAP_DARK_STYLE_URL`
overrides the dark style. Both are public URLs, never credentials.

Switch styles on the existing map with `setStyle(url, { diff: false })`, keeping its camera and DOM
markers. Re-add hazard and route layers after each `style.load`, including the theme-colored local
blank fallback when a style cannot load. A new switch invalidates the previous style timeout and
event callbacks. Re-send the chosen theme after a WebView reload, before its latest overlay. The
dark theme uses lighter hazard and route colors so those overlays remain distinguishable.

## Verification and limits

Mobile tests cover theme validation, reload messages, style switching, overlay restoration, dark
fallback and stale callbacks. In headless Chrome, the real page switched Positron to Dark with all
overlays restored, ignored a stale dark load when toggled back immediately, and fell back to the
dark blank style when the dark style was unreachable. OpenFreeMap Dark logs a missing
`wood-pattern` sprite image; that is upstream and cosmetic. A physical Expo Go check on iOS and Android remains required before
merging the map change, including both themes, attribution, pin interactions and offline fallback.

## Rejected alternatives

- A second CARTO tile provider: OpenFreeMap already serves a Dark Matter fork and keeps the existing
  provider, attribution and privacy boundary.
- Rebuilding the WebView on each toggle: it would reset the map camera and marker interactions.
