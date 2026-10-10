# Vultr AI reporting and route explanations

Optional AI uses **Vultr Serverless Inference**, not a downloaded model or an OpenAI account.
The default `qwen3.8-27b` was checked against Vultr's live catalog on 2026-10-10: image and text
input, text output, JPEG/base64 input and JSON-schema structured output are advertised.
This is capability verification, not a completed inference or accuracy evaluation.
The model is configurable because the catalog can change.

## Enable

1. Enable [Serverless Inference in Vultr](https://docs.vultr.com/product-overviews/serverless-inference)
   and obtain its **Inference API key**. The infrastructure/account API key is different.
2. Put `VULTR_INFERENCE_API_KEY` in your uncommitted `infra/.env`, alongside
   `VULTR_INFERENCE_MODEL=qwen3.8-27b`. Never use `EXPO_PUBLIC_` for this key.
3. Rebuild the API using your normal Compose deployment, then point the app's
   `EXPO_PUBLIC_API_URL` at the product API. No GPU instance or automation container is required.
   For a local stack:

   ```sh
   docker compose --env-file infra/.env -f infra/docker-compose.yml up -d --build api
   ```

   With the backend outside Compose, load the same environment:

   ```sh
   uv run --env-file infra/.env --project backend uvicorn app.main:app --app-dir backend --host 0.0.0.0 --port 8000
   ```

4. Check `/v1/ai/status`. `available=true` means configured; it is not a provider health check.
   Empty key disables AI controls after the next foreground/status probe. Product health,
   reporting, hazard reads and routes never depend on Vultr availability.

No user credentials were available during implementation; no Vultr resource was provisioned,
key issued, model downloaded or live inference claimed. Serverless calls use the account's
inference billing. The app does not ask riders for a provider key.

## Verify the model and connection

From the repository root:

```sh
# Public capability lookup only; no key or inference charge.
uv run --project backend python backend/scripts/check_vultr_ai.py --catalog-only
# Real text inference, using the private environment. This makes a paid request.
uv run --env-file infra/.env --project backend python backend/scripts/check_vultr_ai.py
# Real vision inference. Use a JPEG under 3 MB; this sends the image to Vultr.
uv run --env-file infra/.env --project backend python backend/scripts/check_vultr_ai.py --photo /path/to/hazard.jpg
```

Inference uses `https://api.vultrinference.com/v1/chat/completions`, authenticated with a
server-side bearer key. Redirects are disabled; there is no client-selected URL or model.
The default model supports disabling reasoning; calls disable thinking and cap completion at
1024 tokens. All outputs validate against local Pydantic models, including after provider schema
validation. Truncated, invalid and unavailable results become a generic 503, never a fabricated success.

## Rider flow

- Open Report, stop, and choose **Take photo** or **Choose photo**. Camera permission is requested
  only for camera use. Photo-library selection uses the system picker; microphone and broad Android
  media access are blocked. Permission changes require a new native build; use compatible Expo Go
  or rebuild the development app. Settings/permission behavior still needs device verification.
- **Analyze photo** sends the selected JPEG to Vultr through the backend. Header EXIF/GPS, XMP,
  IPTC and comment segments are removed before forwarding. JPEG size is capped at 3 MB and frame
  size at 25 million pixels. The server does not decode pixels, store or publish the photo, or send
  a location, device identity or report text to the model. This is not face/license-plate redaction:
  visible content still goes to the provider. Provider processing/retention follows Vultr's terms.
- Review the AI suggestion. **Use suggestion** fills the category and description; both remain
  editable. Unclear/no-hazard outputs do not fill a report. **Submit** is still a separate action
  requiring a fresh device location. Report only a hazard at that location; gallery EXIF never
  places the hazard. Saving uses the existing durable manual queue and source=manual. Only the
  confirmed report text/location is queued; images and AI metadata never enter the queue.
- On a real, current route comparison choose **Explain route choice**. Only the displayed route
  distances, durations, report counts and alternative-availability flag go to Vultr. The model
  chooses whether to emphasize time, distance or reports; the server renders the factual sentences
  from those numbers. It cannot invent route facts or assurances. Endpoints, polylines and hazard
  labels are omitted. Explanation is discarded on changed comparison, staleness or unavailable
  state; it never changes routing, hazard scores or geometry.

AI requests have a 28-second overall deadline, 25-second I/O timeout and 64 KB response limit.
Client deadline is 35 seconds. Payload reads are bounded even without Content-Length. One API
process permits at most two simultaneous inferences and 20 starts/minute across riders; excess
returns 429 with Retry-After=60. This is a demo-wide limiter, not authentication or durable account
quota; keep the existing single-process deployment. Public deployment needs account-level billing
controls and, if scaling, a shared limiter. No automatic retries create hidden paid calls.

## Tests and limits

Mocked provider tests exercise image validation, metadata removal, structured/truncated output,
provider failure isolation, unchanged manual source, budget limits, schema parity, numeric route
grounding and late-response suppression. Native typecheck and bundle export validate packaging,
not permissions, vision accuracy, provider availability or real route behavior. Rehearse on iOS
and Android with a real key, a clear hazard, no hazard, a blurry photo, denial/cancel, background
return, expired report location, network outage, and changed route/removed photo during inference.

## Dependency review — 2026-10-10

Added and pinned `expo-image-picker@57.0.14`, matching Expo 57.0.17's bundled recommendation
(`~57.0.14`). Reviewed npm metadata, official repository/package identity, registry signing metadata,
maintainers, published tarball/changelog, install scripts and new dependency `expo-image-loader@57.0.1`
(no runtime dependencies). Neither package has lifecycle install scripts. SDK-57 changes include
the iOS base64-to-JPEG fix (57.0.9), iOS permission crash fix (57.0.14), and the prior crop-activity
export security fix (55.0.20). Reviewed Android's pinned native dependencies and official
Expo security page; no published Expo advisories or npm advisories for the added packages were
found. Existing unrelated audit findings are not remediated by this feature. A native security
scan/device build remains separate from the JS bundle export. No Python dependency was added.

Sources: [Expo ImagePicker](https://docs.expo.dev/versions/latest/sdk/imagepicker/),
[Expo security](https://github.com/expo/expo/security),
[published package metadata](https://registry.npmjs.org/expo-image-picker/57.0.14),
[package source at its published revision](https://github.com/expo/expo/tree/c300d2cc60c9e684e64f48d9bc90ea18a571d01d/packages/expo-image-picker),
[Vultr API](https://api.vultrinference.com/), [live model catalog](https://api.vultrinference.com/v1/models).
