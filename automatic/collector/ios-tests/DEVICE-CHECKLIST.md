# Physical iPhone validation (operator-assisted)

This is a hardware gate, separate from `CollectorDevice` XCTest. A simulator or an injected motion fixture cannot complete it. Record each result in [EVIDENCE-TEMPLATE.md](EVIDENCE-TEMPLATE.md); leave unavailable steps as **unverified**.

## Prerequisites

- Paired iPhone with Developer Mode on, full Xcode, CocoaPods, and a signing team. Build `CollectorDevice` with `EXPO_PUBLIC_COLLECTOR_UI_TEST=0` through `scripts/test-ios.sh`; confirm the **ISOLATED UI TEST BUILD** panel is absent.
- Point `EXPO_PUBLIC_AUTOMATION_API_URL` only at an isolated observation service or omit it to keep eligible batches queued. Never use a shared service for synthetic tests.
- Note phone model, iOS and Xcode versions, commit SHA, build configuration, detector configuration, and observation service URL classification (local/isolated/none; redact host if private).

## Checks

1. **Native smoke:** record the `CollectorDevice` `.xcresult` result. Its automated check establishes launch and consent gating only.
2. **Permissions:** on a fresh install, observe the real motion and foreground location prompts. Test denial and retry through iOS Settings. During a prompt, background the app and confirm it never starts a ride on return. These prompts are not the mocked simulator outcomes.
3. **Lifecycle:** start only after deliberate consent, verify keep-awake while collecting, stop and verify the screen can sleep, background and relaunch, and confirm sensing stays stopped. A new ride needs new consent.
4. **Rates and units:** record measured motion Hz and GPS fix counts/timestamps during a timed outdoor interval. Compare with requests of about 50 Hz and 1 Hz; record deviations. Review raw acceleration and gravity on stationary/rotated phone in m/s². Validate gravity separation and sign/orientation with a labeled maneuver; do not infer this from Node tests.
5. **Rejection and demo:** check stationary handling, then run one labeled indoor demo. The DEMO badge must show and its event source must be `simulated`. Do not submit its evidence as a device observation.
6. **Consented controlled ride:** if a safe route and operator are available, record local diagnostics with explicit consent. Label brakes and bumps, compare detected event count/position to labels, and review first/last 100 m trimming before any share. Measure false positives and missed events. If no ride is available, mark tuning **unverified**.
7. **Upload recovery:** only with an isolated observation service, induce an unknown HTTP outcome, relaunch, and compare UUIDs, paths, and bodies. Check visible 409/422 terminal states. Confirm no raw motion is posted.

Keep original `recordings/` on the phone. Share only reviewed, redacted results and endpoint-trimmed traces. Ordinary hosted simulator CI does not satisfy any hardware check above.
