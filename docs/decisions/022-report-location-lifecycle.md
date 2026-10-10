# 022. Report location expiry and permission lifecycle

- Status: Accepted
- Date: 2026-10-10
- Supersedes: Draft clearing and lookup timeout details in [required report location](021-required-report-location.md).

PR #31 review identified first-use permission and expiry failures. The report controller owns a
60-second fix-expiry timer and publishes an explicit expired state. Saving rechecks freshness even
if timers were suspended. Use the native fix timestamp for both freshness and `observed_at`.

Start the 20-second deadline only after foreground permission is granted. OS permission dialogs
can produce Android background or iOS inactive events, so preserve in-flight lookups across those
events. Backgrounding with no lookup in flight clears the draft fix; foreground return rechecks
expiry. This is still one-shot foreground location, not background tracking.

Switching tabs preserves a fresh fix. Saving or refreshing clears it. Fixture mode disables the
report location action because it cannot submit. Expired/absent fixes have no map marker; report
markers are read-only while route endpoint pins remain draggable. Persisted retry bodies do not
change. Device permission dialogs and Settings return still require physical verification.
