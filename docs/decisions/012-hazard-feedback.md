# 012. "Is this hazard still there?" feedback

- Status: Accepted
- Date: 2026-10-10
- Supersedes: the "community voting is a later feature" deferral in the architecture and lane plans,
  for this narrow still-there/gone feedback only. Cross-source merging and accounts stay deferred.

## Decision

Operator direction for issue #25. Riders answer "Still there" or "No longer there" about an active
hazard through `POST /v1/hazards/{hazard_id}/feedback` with `{id, response}`. The client UUID makes
retries idempotent, exactly like reports: an identical retry gets 200 with `duplicate: true`, even
after the hazard changed. Reusing the UUID for another hazard or answer gets 409. An unknown,
resolved, expired or hidden hazard gets 404. Answers carry no location, account or device ID.
Feedback is stored apart from reports and never edits source or evidence labels.

The effect is one pure function, `backend/app/feedback.py`:

- **Manual hazards.** "Still there" sets `last_seen` to now and extends expiry to now + 24 h, never
  shortening either. Two consecutive "No longer there" answers resolve the hazard; a "Still there"
  in between resets the count.
- **Automatic hazards.** Two consecutive "No longer there" answers at the current publication
  revision hide the hazard from the feed and from routing (`hazards.hidden_at_revision`). The
  publisher's payload, revision and expiry are never edited. Its next newer revision shows the
  hazard again, and only answers given at that revision count afterwards. "Still there" has no
  effect, because the publisher owns automatic expiry.
- One answer never removes a hazard. An ignored or dismissed prompt is not an answer.
- The store reads only the latest two answers, so each request costs the same however many
  answers a hazard has. Answers are ordered by an insert sequence assigned under the hazard's row
  lock, so processing order decides which answer is latest, not a request's clock.

Any change sends the existing `hazards.changed` live hint, so phones refetch.

**Where riders answer.** Tapping a hazard pin opens a panel under the map. It shows the source,
category, label and expiry with the two answers, and it never marks an answer received before
the server's matching receipt. The panel keeps the hazard's details, so the acknowledgement stays
visible after the hazard is removed. While the app is open with location permission, coming
within 40 m of a hazard opens its panel, at most once per hazard per session. The prompt uses its
own hazard lookup, not the map viewport, and re-checks the latest position whenever that lookup
returns. The lookup asks `GET /v1/hazards` for the 3x3 block of ~500 m grid cells around the
rider. It refreshes on entering a new cell, on a later position fix after 60 s, or on a live
change. The server therefore learns only which block is checked, as when someone browses the map,
never the exact position.
This uses foreground location only. It never runs in the background, never records or uploads
precise positions, and never sends coordinates with an answer, so it is not ride tracking. The
permission text says so.
Fixture mode shows the question with sending disabled.

## Limits

There are no accounts or persistent device IDs, so the server cannot count distinct riders. One
person could answer twice. The app allows one answer per hazard per session, which deters
casual repeats but not determined abuse. Raise the threshold or add identity if that becomes a
problem.

The operator also asked for location to become a prerequisite for using the app. That reverses
the standing rule that reporting works with location denied (AGENTS.md, ARCHITECTURE.md section 8,
README) and is the scope of issue #23. It needs its own decision and PR, so this decision does not
change it.

## Rejected alternatives

- Treating unanswered prompts as "gone": riders often can't tap while riding, so real hazards
  would vanish.
- Editing or resolving automatic publications from the product API: the next revision would
  overwrite or resurrect them, breaking revision semantics.
- Feedback buttons on the list under the map: the operator asked for answers at the map pins.
