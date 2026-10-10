# Collector iPhone validation record

- Date/operator:
- Commit / branch:
- Phone model / iOS version:
- Xcode version / macOS version:
- Build configuration / test plan / `.xcresult` path:
- Detector settings and any changes from defaults:
- Observation endpoint: none / isolated local stub / isolated service (no private host in shared artifacts):

| Check | Result (pass / fail / unverified) | Measured observation or redacted evidence | Limitation / follow-up |
| --- | --- | --- | --- |
| Signed native smoke | unverified | | |
| Real motion prompt / denial | unverified | | |
| Real location prompt / denial | unverified | | |
| Foreground stop / keep-awake | unverified | | |
| Motion requested ~50 Hz / observed rate | unverified | | |
| GPS requested ~1 Hz / observed rate | unverified | | |
| Acceleration units / gravity / orientation | unverified | | |
| Stationary rejection | unverified | | |
| Indoor demo, one simulated label | unverified | | |
| Consented route, endpoint trimming | unverified | | |
| Brake/bump detections versus labels | unverified | | |
| Unknown outcome retry / 409 / 422 | unverified | | |
| Raw motion absent from observation requests | unverified | | |

Record the count of missed/extra events and rate deviations explicitly. Keep raw recordings private; remove the first and last 100 m and their events before sharing any route evidence. List unavailable devices, missing rides, and skipped checks as **unverified**, not passes.
