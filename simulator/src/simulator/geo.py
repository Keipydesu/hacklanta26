"""Small-distance geometry helpers. Objects use lat/lon; GeoJSON positions are [lon, lat]."""
import math

EARTH_RADIUS_M = 6_371_008.8
METERS_PER_DEGREE = 111_320.0


def offset(lat: float, lon: float, north_m: float, east_m: float) -> tuple[float, float]:
    return (lat + north_m / METERS_PER_DEGREE,
            lon + east_m / (METERS_PER_DEGREE * math.cos(math.radians(lat))))


def distance_m(a_lat: float, a_lon: float, b_lat: float, b_lon: float) -> float:
    d_lat, d_lon = math.radians(b_lat - a_lat), math.radians(b_lon - a_lon)
    h = math.sin(d_lat / 2) ** 2 + math.cos(math.radians(a_lat)) * math.cos(math.radians(b_lat)) * math.sin(d_lon / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(min(1.0, math.sqrt(h)))


def ring_center(ring: list[list[float]]) -> tuple[float, float]:
    """Mean of a polygon ring's vertices as (lat, lon). Good enough to say "near" for small hazards."""
    points = ring[:-1] if len(ring) > 1 and ring[0] == ring[-1] else ring
    return (sum(p[1] for p in points) / len(points), sum(p[0] for p in points) / len(points))


def square(lat: float, lon: float, half_m: float) -> list[list[list[float]]]:
    """Closed polygon ring around a point, longitude first."""
    corners = [(-half_m, -half_m), (-half_m, half_m), (half_m, half_m), (half_m, -half_m), (-half_m, -half_m)]
    ring = []
    for north, east in corners:
        p_lat, p_lon = offset(lat, lon, north, east)
        ring.append([round(p_lon, 7), round(p_lat, 7)])
    return [ring]


def bbox_around(points: list[tuple[float, float]], margin_m: float = 400) -> str:
    """minLon,minLat,maxLon,maxLat covering (lat, lon) points with a margin."""
    lats, lons = [p[0] for p in points], [p[1] for p in points]
    south, west = offset(min(lats), min(lons), -margin_m, -margin_m)
    north, east = offset(max(lats), max(lons), margin_m, margin_m)
    return f'{west:.6f},{south:.6f},{east:.6f},{north:.6f}'
