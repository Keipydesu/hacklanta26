# 012. Scooter and bike trips lead the UI

- Status: Accepted
- Date: 2026-10-10

## Decision

At the operator's request, position the rider experience around getting around by scooter or
bike, with hazard mapping as an added benefit. Prioritize trip planning and route comparison
in the home-screen hierarchy while keeping reporting and hazard inspection easy to reach.
Use Lime as the primary trip-experience reference and Waze for community hazard interactions.
The working analysis lives in [UI inspiration](../UI-INSPIRATION.md).

This sets product emphasis, not final layouts, colors or new API capabilities. The existing
manual-first delivery sequence still applies. It does not introduce vehicle rental, ride tracking,
public-transit integration, geocoding or separate scooter/bicycle routing modes. In particular,
decision 005's pedestrian costing at scooter pace is not validated bicycle routing; do not
present a mode switch or bicycle-specific estimates without coordinated routing work.

## Why

The app should be useful for planning a trip even when there are no hazards. Hazard awareness
enriches the travel decision rather than making a report feed the primary destination.

## Supersedes

No numbered decision. Refines the initial hazard-first hierarchy in the working UI brief;
existing reporting, source/evidence, expiry, retry and lower-risk language requirements remain.
