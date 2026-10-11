# 029. Destination-first map home without task tabs

- Status: Accepted
- Date: 2026-10-10
- Supersedes: Decision 015's Map / Trip / Report controls and Where to button.

The operator requested an Apple Maps-like collapsed home: one destination text input, floating
recenter and hazard-report icons, and no Map selection. The map is the default view. Destination
focus opens decision 027's expanded search; report opens the existing hazard form. Done returns
to the map. Preserve fixture, pending, failure and source/evidence labels when relevant.

On the map home, Recenter obtains a single foreground fix after the explicit tap, displays a circular marker and
moves the map camera. It does not change trip endpoints or grant a new report location. Denied or
unavailable location displays retry guidance. In Trip, the floating recenter control resumes the
existing live following from decision 024. Routine live-location details are expanded-only; denial
and watch errors remain visible. No new location watcher or dependency is introduced.
