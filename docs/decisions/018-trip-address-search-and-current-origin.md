# 018. Trip address search and Current location origin

- Status: Accepted
- Date: 2026-10-10
- Supersedes: decision 012's exclusion of geocoding, and Lane A's pin-first trip endpoints. Map
  points remain available as a secondary way to choose an endpoint.

## Decision

Operator direction for issues #37 and #38: plan trips the way familiar map apps do. Search for a
destination, start from Current location by default, and edit either endpoint by searching.

**Search.** The product API adds `GET /v1/places?q=&near=lat,lon`, which returns up to five places
(`id`, `name`, `address`, `lat`, `lon`). It proxies Photon, an OpenStreetMap geocoder that needs
no key (`PHOTON_URL`, default `https://photon.komoot.io`; empty disables search with 503).
- Results are limited to the metro-Atlanta box that Valhalla routes over.
- `near` only ranks results and is rounded to about 100 m before it is sent.
- Queries must be 3–100 characters after trimming (422).
- Answers are cached for 10 minutes.
- Provider errors return 503, and the app offers retry or a map point.

The app never calls Photon directly, so rider IPs and queries stay with our API and the provider
can be replaced. Route requests are unchanged: they still send `origin` and `destination` lat/lon.

**Provider.** Photon's public instance is free and allows fair use. It may throttle heavy use and
has no availability guarantee, which suits the demo. A deployment that needs reliability should
self-host Photon on the same Georgia extract as Valhalla, as a Lane G follow-up. OSM data use is
credited under the result list ("Search: Photon · © OpenStreetMap contributors"). The map's
attribution control already credits the basemap.
- **Coverage, checked live on 2026-10-10:** Georgia State University, 55 Park Place NE, the
  Klaus Advanced Computing Building, John Lewis Student Center and Centennial Olympic Park all
  resolve with readable addresses.
- **Known gap:** informal names such as "Georgia Tech Student Center" do not find the official
  "John Lewis Student Center".

**Origin.** A new trip's From field is Current location. Opening Trip, through Where to? or the
Trip tab, resolves it with one foreground fix (`locateOnce`); permission is requested only in this
trip context, never for browsing. There is no watching or background location. A late fix never
replaces an origin the rider chose meanwhile. If location is denied or unavailable, the From field
says so and offers "Try again" and "Search for a start". The app never substitutes a fixture
point or the map centre as the rider's position. The map centre only biases search ranking when
no origin is known.

**Flow.** Typing in a field clears its resolved point until a result is chosen. Late search
answers are discarded. Choosing a result dismisses the keyboard, and once both endpoints are valid
and distinct the comparison loads automatically. Editing either endpoint invalidates the shown
routes, as the existing route model already does. Swap exchanges endpoints and labels together
and is disabled while a fix is pending. Clear resets the trip to Current location and an empty
destination. The pin-mode buttons and the "Tap map to set start" and "Set two different points to
compare" lines are gone. "Choose on map" in an open field sets that endpoint from the next map
tap.

## Limits and follow-ups

- #39 removes the Where to? gateway and moves the destination field onto the map home. The fields
  here are reusable components for that.
- #34 adds alternative routes; result presentation is unchanged here.
- Report location (#23, #40) is separate. This decision changes trip origins only.
- Physical-device checks of permission prompts and keyboard behaviour are still required.
