# Font loader review — 2026-10-10

Added exact `expo-font@57.0.1`, matching the installed Expo 57.0.17 compatibility table
(`~57.0.1`), rather than selecting the newest release. Expo's [font documentation](https://docs.expo.dev/versions/v57.0.0/sdk/font/)
confirms native runtime loading and Expo Go support.

Reviewed npm package metadata, registry signature/integrity, official Expo repository link,
package contents, changelog and native asset loader. 57.0.1 was released 2026-07-15; its
`src/` files are identical to the downloaded 57.0.0 package. Package metadata lists the Expo
maintainer team for both versions (not independent proof of historical account ownership).
No install lifecycle scripts are present. The single declared dependency, fontfaceobserver,
was already locked at 2.3.0; there are no new transitive packages. Its metadata points to
bramstein/fontfaceobserver and has no install lifecycle scripts.

`npm audit` after installation reports no expo-font or fontfaceobserver advisory. The existing
22 findings remain (7 moderate, 15 high); no unrelated upgrades were made. Registry integrity
is pinned in package-lock.json. No compromise indicators were observed in this scoped review;
this is not a guarantee of supply-chain safety.

Update for decision 026 (2026-10-10): the Satoshi faces and the Fontshare fetch script are removed.
The app now bundles Barlow Condensed, Overpass and Overpass Mono, committed with their SIL OFL 1.1
licences; sources, the pinned google/fonts commit and SHA-256 values are in the fonts README.
No package was added or upgraded: `expo-font` stays at 57.0.1. Native font loading still uses
bundled assets and falls back to system text if loading fails, without blocking map/report access.
