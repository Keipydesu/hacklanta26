# SDK 57 dependency review and handoff

Review date: 2026-10-10. Scope: the manual mobile app; no backend, contract, or collector changes.

## Selected versions

| Package | Version | Reason |
| --- | --- | --- |
| expo | 57.0.17 | August 26 patch with the SDK 57 Hermes fixes; avoids selecting a patch solely because it is newest |
| react-native | 0.86.3 | Exact native runtime in Expo 57.0.17's bundled compatibility manifest |
| react | 19.2.3 | Same bundled compatibility manifest |
| expo-crypto | 57.0.2 | August 24 release; matches bundled manifest and preserves randomUUID API |
| expo-location | 57.0.14 | August 26 release; matches bundled manifest and preserves foreground location APIs |
| react-native-maps | 1.27.2 | Unchanged; still the bundled compatible version |
| @react-native-async-storage/async-storage | 2.2.0 | Unchanged; still the bundled compatible version |

TypeScript remains locked to 5.9.3 and React types to 19.2.18. Runtime dependencies changed here
use exact manifest pins; the complete transitive tree is fixed by package-lock.json.

Reviewed the [SDK 56 release notes](https://expo.dev/changelog/sdk-56),
[SDK 57 release notes](https://expo.dev/changelog/sdk-57),
[Expo changelog](https://github.com/expo/expo/blob/sdk-57/packages/expo/CHANGELOG.md),
[crypto changelog](https://github.com/expo/expo/blob/sdk-57/packages/expo-crypto/CHANGELOG.md), and
[location changelog](https://github.com/expo/expo/blob/sdk-57/packages/expo-location/CHANGELOG.md).
SDK 56 raises the minimum iOS version to 16.4 and native-build Xcode to 26.4, and switches the
global fetch implementation. SDK 57.0.17 includes the earlier fetch stream/abort fixes and
Hermes regression fixes. Existing stalled-body timeout and retry tests pass, but actual iOS
network behavior still needs device validation.

Published source diffs for crypto and location were inspected: the UUID API remains unchanged;
location adds motion APIs and changes permission imports. Inspected the installed location
config plugin and Android manifest. Disable the new iOS motion description explicitly and leave
Android motion recognition disabled. No app motion API or background collection is introduced.

## Supply-chain checks

Resolved both upgrade steps with `--ignore-scripts`. The final lockfile has no packages marked
with install lifecycle scripts. Reviewed registry metadata for all direct runtime packages and
all newly introduced lockfile paths: repository identity, release dates, publisher/maintainers,
install scripts, dependency lists and available attestations. The Expo packages retain the
same publisher (`alanhughes`) as the previous direct releases. React retains `react-bot`;
React Native moves from its bot account to GitHub Actions trusted publishing with provenance.
Registry metadata alone cannot establish complete maintainer history or absence of compromise.

`npm audit signatures`: 473 registry signatures and 122 available provenance attestations verified.
Several Expo packages do not publish provenance; registry signatures are not source-build proof.

The new lockfile has 13 added paths and removes 123. These include Expo's macro plugin,
inline modules, Metro file map, prebuild config, DOM webview, JSI package and WS tunnel;
React Native virtualized lists; sandbox-cli-detector; and tinyglobby/fdir/picomatch (some entries
are moved/nested copies). The lockfile records exact versions/integrities. Reviewed their registry
repository and dependency metadata. Inspected sandbox-cli-detector's implementation (environment
presence checks, no subprocess or network calls) and the JSI JS entry point (native support package).
The WS tunnel package has no repository metadata or provenance; its publisher is Expo maintainer
`philpl` and its registry signature verifies. The documented launch uses LAN, not tunnel mode.
This is a targeted dependency review, not a full audit of upstream source or native binaries.

## Known advisories

`npm audit` exits nonzero: 23 affected dependency entries (16 high, 7 moderate), arising from
three underlying advisories, including propagation through Expo/Metro and React Native tooling.
These remain visible; no audit exclusions or automatic forced downgrade were added.

- [braces stack exhaustion](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm): no patched version
  listed. Used by build-time file globbing; do not pass untrusted patterns into Metro/build tooling.
- [node-forge signature verification](https://github.com/advisories/GHSA-86w9-cpqp-85rv): audit
  flags versions through 1.4.0. Expo's code-signing tooling imports it. This project does not
  configure OTA update signing; reassess before enabling signing or processing untrusted certificates.
- [uuid buffer bounds](https://github.com/advisories/GHSA-w5hq-g745-h8pq): affects v3/v5/v6 with
  caller-provided buffers, patched in 11.1.1. The installed xcode package calls v4 without a buffer;
  app submission IDs use expo-crypto. A forced major override is not justified for that call site.

These are assessed as tooling risks outside the app's report/map/route input paths, not a clean
security scan. Use a trusted development network and revisit upstream patches before deployment.

## Validation and operation

- SDK 56 intermediate: typecheck and all 39 Node behavior tests passed.
- SDK 57: typecheck, all 39 tests, and iOS/Android Hermes bundle export passed (Node 25.8.1).
- Config introspection verifies no iOS motion usage description, no location background mode,
  and no Android motion/background/foreground-service permission additions.
- Offline Expo dependency check matches the bundled manifest. The online check exits 1 and
  recommends Expo 57.0.27, crypto 57.0.3, location 57.0.20 and TypeScript 6.0.3. These newer-patch
  recommendations are deliberately left visible; the selected native runtime is still SDK 57.
- Physical iPhone/Android checks, signed native builds and hosted rehearsal remain outstanding.

From the repository root, stop the previous Metro process and run:

```sh
npm ci --prefix mobile
EXPO_PUBLIC_API_URL=http://YOUR_LAN_IP:8000 npm start --prefix mobile -- --clear
```

Use Expo Go for SDK 57 on the same network. Verify denied-location pin reporting, submission,
map display, optional foreground location and offline restart/retry. With no API URL the app
still shows fixture previews; without Valhalla the backend still returns example routes.
