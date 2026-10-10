"""Valhalla pedestrian routing client.

Costing decision (C4): start with `pedestrian` at scooter pace (16 km/h) plus a heavy step penalty.
GSU walkways are mapped as footways, and `bicycle` costing only uses ways with bicycle access. Fixtures in
tests/routing/fixtures were recorded on 2026-10-10 from a local ghcr.io/valhalla/valhalla:latest
(3.9.1) built from an Overpass extract of bbox -84.40,33.74,-84.37,33.77 (see backend/README.md).

Evidence (same engine, three GSU trips, 16 km/h each): pedestrian vs bicycle length was 0.588 vs
1.459 km, 1.197 vs 1.180 km, 0.501 vs 0.506 km. Bicycle costing was ~2.5x longer on trip a and no
better elsewhere, so pedestrian stays. Re-run on the deployed engine before launch.
"""
from dataclasses import dataclass
import math

import httpx

COSTING = {'pedestrian': {'walking_speed': 16, 'step_penalty': 600}}
NO_PATH_CODE = 442  # Valhalla: "No path could be found for input"

class NoPath(Exception):
    """Valhalla ran and found no route (HTTP 400, error_code 442)."""

class Unavailable(Exception):
    """Outage, timeout, malformed response: nothing the rider can fix."""

@dataclass
class Candidate:
    coordinates: list  # [lon, lat] pairs
    distance_m: float
    duration_s: float

def decode_polyline6(encoded):
    """Decode an encoded polyline with 6 decimal digits into [lon, lat] pairs."""
    lat = lon = index = 0
    points = []
    while index < len(encoded):
        for axis in (0, 1):
            shift = result = 0
            while True:
                byte = ord(encoded[index]) - 63
                index += 1
                result |= (byte & 0x1F) << shift
                shift += 5
                if byte < 0x20:
                    break
            delta = ~(result >> 1) if result & 1 else result >> 1
            if axis == 0:
                lat += delta
            else:
                lon += delta
        points.append([lon / 1e6, lat / 1e6])
    return points

def parse_trip(payload):
    """The main trip only; see parse_alternates for the others."""
    try:
        trip = payload['trip']
        coordinates = []
        for leg in trip['legs']:
            points = decode_polyline6(leg['shape'])
            coordinates.extend(points[1:] if coordinates and points and coordinates[-1] == points[0] else points)
        distance_m = float(trip['summary']['length']) * 1000
        duration_s = float(trip['summary']['time'])
        if len(coordinates) < 2 or not all(abs(c[0]) <= 180 and abs(c[1]) <= 90 for c in coordinates) \
                or not all(math.isfinite(value) and value >= 0 for value in (distance_m, duration_s)):
            raise ValueError('implausible route')
    except (KeyError, TypeError, ValueError, IndexError) as error:
        raise Unavailable(f'invalid Valhalla response: {error}') from error
    return Candidate(coordinates, distance_m, duration_s)

def parse_alternates(payload):
    """Valhalla lists other routes as {"alternates": [{"trip": ...}, ...]}; absent means none."""
    alternates = payload.get('alternates', [])
    if not isinstance(alternates, list):
        raise Unavailable('invalid Valhalla response: alternates is not a list')
    return [parse_trip(item) for item in alternates]

class ValhallaClient:
    def __init__(self, base_url, http: httpx.AsyncClient | None = None):
        self.base_url = base_url.rstrip('/')
        self.http = http or httpx.AsyncClient(timeout=httpx.Timeout(8, connect=2))

    async def close(self):
        await self.http.aclose()

    async def route(self, origin, destination, exclusions=()):
        """origin/destination: objects with lat/lon. exclusions: exterior rings in [lon, lat] order."""
        return (await self.routes(origin, destination, exclusions))[0]

    async def routes(self, origin, destination, exclusions=(), alternates=0):
        """The best route followed by up to `alternates` other routes Valhalla found."""
        body = {'locations': [{'lat': origin.lat, 'lon': origin.lon}, {'lat': destination.lat, 'lon': destination.lon}],
                'costing': 'pedestrian', 'costing_options': COSTING, 'units': 'kilometers'}
        if exclusions:
            body['exclude_polygons'] = [list(ring) for ring in exclusions]
        if alternates:
            body['alternates'] = alternates
        try:
            response = await self.http.post(f'{self.base_url}/route', json=body)
        except httpx.HTTPError as error:
            raise Unavailable(f'Valhalla unreachable: {error!r}') from error
        if response.status_code == 400:
            try:
                error = response.json()
                code = error.get('error_code') if isinstance(error, dict) else None
            except ValueError:
                code = None
            if type(code) is int and code == NO_PATH_CODE:
                raise NoPath()
            # Unknown/malformed request errors can reflect adapter or engine configuration;
            # never tell the rider that changing pins will fix them.
            raise Unavailable(f'Valhalla rejected the request ({code}): {response.text[:200]}')
        if response.status_code != 200:
            raise Unavailable(f'Valhalla returned HTTP {response.status_code}')
        try:
            payload = response.json()
        except ValueError as error:
            raise Unavailable('Valhalla returned non-JSON') from error
        if not isinstance(payload, dict):
            raise Unavailable('invalid Valhalla response: not an object')
        return [parse_trip(payload), *parse_alternates(payload)]
