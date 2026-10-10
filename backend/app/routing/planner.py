"""Route comparison: baseline vs. a route that avoids eligible hazards, scored against all hazards.

Receives product hazards only; never touches the automatic service.
"""
from dataclasses import dataclass
import math

from shapely.affinity import scale
from shapely.geometry import LineString, Point

from .valhalla import NoPath, Rejected, Unavailable

EXCLUDE_SCORE = 0.4
MAX_EXCLUSIONS = 20
SEARCH_MARGIN_DEG = 0.004  # ~450 m around the trip; widened once if a candidate leaves it

@dataclass
class Hazard:
    id: str
    score: float
    polygon: object  # shapely Polygon, WGS84

def hazard_from_feature(feature):
    from shapely.geometry import shape
    return Hazard(str(feature['properties']['id']), float(feature['properties']['score']), shape(feature['geometry']))

def trip_bounds(points, margin=SEARCH_MARGIN_DEG):
    xs, ys = [p[0] for p in points], [p[1] for p in points]
    return (min(xs) - margin, min(ys) - margin, max(xs) + margin, max(ys) + margin)

def covers(outer, inner):
    return outer[0] <= inner[0] and outer[1] <= inner[1] and outer[2] >= inner[2] and outer[3] >= inner[3]

def select_exclusions(hazards, origin, destination, baseline_coordinates=None):
    """Rings of at most 20 eligible hazards nearest the baseline route (else the straight trip line),
    never ones that touch an endpoint."""
    endpoints = [Point(origin.lon, origin.lat), Point(destination.lon, destination.lat)]
    line = LineString(baseline_coordinates or [(origin.lon, origin.lat), (destination.lon, destination.lat)])
    cos = math.cos(math.radians((origin.lat + destination.lat) / 2))  # longitude degrees shrink with latitude
    def distance(hazard):
        return scale(hazard.polygon, xfact=cos, yfact=1, origin=(0, 0)).distance(scale(line, xfact=cos, yfact=1, origin=(0, 0)))
    eligible = [h for h in hazards if h.score >= EXCLUDE_SCORE
                and not any(h.polygon.intersects(p) for p in endpoints)]
    eligible.sort(key=lambda h: (distance(h), h.id))
    return [[list(c) for c in h.polygon.exterior.coords] for h in eligible[:MAX_EXCLUSIONS]]

def score_route(coordinates, hazards):
    line = LineString(coordinates)
    hit = [h for h in hazards if h.polygon.intersects(line)]
    keep = 1.0
    for h in hit:
        keep *= 1 - h.score
    return 1 - keep, sorted({h.id for h in hit})

def route_json(kind, candidate, hazards):
    risk, ids = score_route(candidate.coordinates, hazards)
    return {'kind': kind, 'geometry': {'type': 'LineString', 'coordinates': candidate.coordinates},
            'distance_m': candidate.distance_m, 'duration_s': candidate.duration_s,
            'risk_score': round(max(0.0, min(1.0, risk)), 6), 'hazard_ids': ids}

def union(a, b):
    return (min(a[0], b[0]), min(a[1], b[1]), max(a[2], b[2]), max(a[3], b[3]))

async def plan(client, origin, destination, load_hazards):
    """load_hazards(bounds) -> list[Hazard]: active, unexpired hazards intersecting bounds.

    Raises NoPath/Rejected when the baseline itself is unroutable (a rider-facing problem), and
    Unavailable when no honest answer is possible: an engine outage, or a detour that still leaves
    the area we loaded hazards for after one widening (never score unseen area as zero).
    """
    covered = trip_bounds([(origin.lon, origin.lat), (destination.lon, destination.lat)])
    hazards = {h.id: h for h in await load_hazards(covered)}
    baseline = await client.route(origin, destination)
    safest, safest_available = baseline, True
    for attempt in range(2):
        covered = await widen(covered, baseline.coordinates, hazards, load_hazards)
        exclusions = select_exclusions(list(hazards.values()), origin, destination, baseline.coordinates)
        safest, safest_available = baseline, True
        if exclusions:
            try:
                safest = await client.route(origin, destination, exclusions)
            except (NoPath, Rejected):  # the optional route failed: keep the baseline rather than lose the trip
                safest, safest_available = baseline, False
        needed = trip_bounds(safest.coordinates, margin=0)
        if covers(covered, needed):
            break
        if attempt == 1:
            raise Unavailable('route leaves the area covered by loaded hazards')
        covered = union(covered, trip_bounds([(needed[0], needed[1]), (needed[2], needed[3])]))
        hazards.update({h.id: h for h in await load_hazards(covered)})
    everything = list(hazards.values())
    shortest_json = route_json('shortest', baseline, everything)
    safest_json = route_json('safest', safest, everything)
    if safest_json['risk_score'] > shortest_json['risk_score']:  # a detour that is riskier is not "safest"
        safest_json, safest_available = dict(shortest_json, kind='safest'), False
    return {'routes': [shortest_json, safest_json], 'safest_available': safest_available}

async def widen(covered, coordinates, hazards, load_hazards):
    """Make sure the baseline route itself is inside the loaded area before choosing exclusions."""
    needed = trip_bounds(coordinates, margin=0)
    if covers(covered, needed):
        return covered
    covered = union(covered, trip_bounds([(needed[0], needed[1]), (needed[2], needed[3])]))
    hazards.update({h.id: h for h in await load_hazards(covered)})
    return covered
