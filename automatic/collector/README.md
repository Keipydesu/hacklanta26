# Collector · stage 0

A separate Expo fixture sender, visibly labeled DEMO STUB. No actual sensing, location permission,
ride recording, trimming, detector invocation or persistent queue. Sends simulated, already-trimmed
historical GSU observations with fixed IDs/bodies to demonstrate retryable ingestion. It cannot
publish product hazards and contains no publisher credential.

From the repository root (Node 22 LTS recommended):

```sh
npm ci --prefix automatic/collector
npm run typecheck --prefix automatic/collector
npm run build --prefix automatic/collector
EXPO_PUBLIC_AUTOMATION_API_URL=http://YOUR_LAN_IP:8001 npm start --prefix automatic/collector
```

Use SDK-55-compatible Expo Go or a development build. Both iOS/Android exports and typechecking
passed; physical-device interaction is not yet verified. `build` exports bundles, not native
binaries. Without the URL the send button is disabled. This app runs independently of `mobile/`.
Generated observation types live in `src/api/schema.d.ts`.

Lane B implements opt-in sensors, privacy trimming, recorder and durable upload queue in milestone 3.
