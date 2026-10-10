# C3 two-phone rehearsal

Status: pending device evidence. Backend checks pass; do not mark C3 complete until the phone
steps below have recorded results. Track failures and evidence in
[issue #19](https://github.com/Keipydesu/hacklanta26/issues/19).

## Setup

Use a dedicated demo PostGIS database and one API process. Stop the automatic service, collector,
detector and simulator. Do not use the disposable test database for phone evidence: the DB test
fixture drops its tables. Install dependencies using the backend and
[mobile README](../mobile/README.md) commands, then launch from the repository root:

```sh
DATABASE_URL=postgresql://USER:PASSWORD@HOST:PORT/DEMO_DB uv run --project backend uvicorn app.main:app --app-dir backend --host 0.0.0.0 --port 8000
# In another terminal; replace YOUR_LAN_IP with the API computer's reachable address:
EXPO_PUBLIC_API_URL=http://YOUR_LAN_IP:8000 npm start --prefix mobile
```

Open on two physical phones using SDK-55-compatible Expo Go/development builds. Both phones must
reach the API; localhost on a phone is not the API computer. Verify `/healthz` reports
`storage: postgis` and `persistent: true`. Leave routing visibly stubbed if `VALHALLA_URL` is unset;
C3 does not require real routes. Use G's HTTPS endpoint for the separate hosted A4/C5 rehearsal.

## Phone checks (automation remains stopped)

1. Record the API/app commit, API URL, phone models, OS/app versions, network and UTC start time.
   On both phones view the same campus bounds. Deny location permission and place a report pin
   manually on phone A. Submit once; record its receipt/hazard ID using the API feed or debugger.
   Phone B must display the accepted manual hazard without a manual reload. Verify the manual
   source label and expiry, and confirm one hazard exists in the bbox feed.
2. Disconnect phone A from the network, submit another report and verify it is queued locally,
   not displayed as an accepted hazard on B. Kill/relaunch A, restore connectivity and foreground
   it. Verify submission completes once and B receives one new hazard. Record the original/retried
   submission IDs and bodies from the debugger/API logs; they must match. If retries exhaust,
   use “Retry original report” and verify identity stays unchanged.
3. Disconnect B; submit a third report on A. Reconnect/foreground B and verify its visible bbox
   catches up without another report being submitted. Record the reconnect/refetch result.
4. Stop and restart only the API using the same database. Both phones must recover and retain
   previously accepted hazards. Queue a report while the API is down and verify recovery produces
   one accepted hazard. Cached results must be labeled stale during an unsuccessful refresh.
5. Exercise expiry without waiting 24 hours: from the API computer, submit a uniquely identified
   manual report through `/docs` using an observation time 23 h 59 min ago and coordinates in both
   phones' bounds. Verify it appears, then disappears after its 24-hour expiry on both phones and
   from the bbox feed. Retry the exact original JSON: expect the original IDs with `duplicate: true`
   and no reappearance. Do not change device clocks or mutate database lifecycle fields.

Manual reports cannot be reactivated by changing a retry body. Publication reactivation is covered
by the focused DB test below. For an additional on-device lifecycle check, use a standalone fixture
publisher from the API computer (not the automatic service), a unique external ID and a short
`expires_at`; after expiry publish revision 2 with a later expiry. Verify the same hazard UUID
reappears with its automatic/simulated evidence label. Keep the publication credential server-side,
never in Expo settings. This optional fixture step is separate from the manual-only steps above.

## Backend evidence and recording

Against a **disposable** PostGIS database, run:

```sh
TEST_DATABASE_URL=postgresql://USER:PASSWORD@HOST:PORT/TEST_DB uv run --project backend pytest -c backend/pyproject.toml backend/tests/test_postgres.py -k 'live_hint or manual_report_survives or expired_queued or expiry_scan or health_is' -q
```

Verified 2026-10-10: **5 passed**, with existing dependency deprecation warnings. This includes
the corrected slow-socket test: a stalled socket is closed, the writer completes within three
seconds, and the healthy socket observes the already-committed hazard. Its sockets are test doubles;
this is not evidence that either physical phone was exercised. Expiry/reactivation checks use the
real database and a standalone publication fixture with no running automatic service.

Record each phone step as pass/fail with IDs, timestamps and observed behavior, plus any remaining
stub or failure. Link the evidence in issue #19. C3 completion requires the two-phone results;
hosted HTTPS/real route comparison must still be recorded separately for A4/C5.
