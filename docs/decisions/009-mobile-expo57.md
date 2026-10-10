# 009. Match the manual app to SDK 57 Expo Go

- Status: Accepted
- Date: 2026-10-10

## Decision

Upgrade only `mobile/` from SDK 55 through 56 to SDK 57, at the operator's request after
an iPhone running Expo Go for SDK 57 rejected the project. Pin the reviewed direct runtime
versions and commit the resolved lockfile. Preserve the separate collector's SDK and all
product API contracts.

Use Expo 57.0.17 / React Native 0.86.3, which include the documented Hermes memory/startup
fixes. Keep the existing tested TypeScript 5.9 compiler for this runtime upgrade. Do not
silence Expo's newer-patch recommendations with validation exclusions.

The updated location plugin adds an iOS motion usage description by default. Explicitly set
`motionUsagePermission: false` and `isAndroidMotionActivityEnabled: false`; the manual product
must retain its no-motion-permission requirement. No motion API is called.

## Verification and limits

See the [dependency review and handoff](../../mobile/SDK57-REVIEW.md), including unresolved
tooling advisories and the online version-check warning. iPhone launch and foreground-location,
map, and offline queue smoke checks remain required; bundle export is not device verification.

## Supersedes

SDK-55 launch guidance for the manual mobile app only. No earlier numbered decision changes.
