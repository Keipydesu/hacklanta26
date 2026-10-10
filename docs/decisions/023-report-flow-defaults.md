# 023. Report flow: automatic location, category first, Submit on selection

- Status: Accepted
- Date: 2026-10-10
- Supersedes: decision 021's "requested by an explicit user action". Location is now requested
  automatically when the reporting flow opens. Decisions 021 and 022's other rules stand: a fresh
  device fix is required, no manual report pin, 60 s expiry, a 20 s lookup deadline, and saved
  reports keep their original body.

## Decision

Operator direction for issue #40. This integrates PR #31 (required report location, #23) and
PR #36 (categories, #24) on the PR #30 UI.

- **Location.** Opening Report, or returning to the app while on Report, requests one foreground
  fix when none is ready or in progress. Browsing the map never triggers this request. There is
  no watching or background tracking.
- **Category.** No category is preselected. The four API kinds appear with readable labels (#36),
  and each hint is the control's accessibility label.
- **Submit.** One primary button labeled "Submit" appears only after a category is chosen. It is
  enabled only with a fresh fix, outside fixture mode, and while no save is in progress. After a
  report is queued, the category resets and Submit hides again. A failed draft stays recoverable
  through the queue's retry and dismiss controls.
- **Copy.** The "Tap to place · drag to adjust" line, the location-required explanation, the raw
  coordinates and the "Demo · submitting is unavailable" caption are removed. Demo status stays
  in the panel heading ("DEMO · Report hazard"). Actionable states remain: "Getting your current
  location…", the denied, unavailable and expired messages, "Retry location", and "Open location
  settings". Queued, sending, submitted and failed states are unchanged.

The rules live in `mobile/src/reports/reportFlow.ts` and are covered by Node tests.

## Limits

- Physical-device checks of the automatic permission prompt, Settings return and foreground
  return are still required.
- The merged nearby hazard prompt (decision 013) still asks for location at app launch. Whether
  it should instead wait for permission granted in a trip or report context is an open operator
  decision.
