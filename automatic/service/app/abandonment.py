"""Abandonment: a normally busy H3 cell whose traffic collapsed while a nearby cell's rose.

Windows are rolling 24 h days ending at the (frozen) evaluation time: day 0 is the latest 24 h.
Recent = days 0-1 (last 48 h); baseline = days 2-13, zero-traffic days included in the denominator.
H3 resolution and window boundaries are internal tuning (agree with Lane F's closure scenario).
"""
from collections import defaultdict
from datetime import timedelta

import h3

RESOLUTION = 10
BASELINE_DAYS = range(2, 14)
RECENT_DAYS = range(0, 2)
MIN_BASELINE_RATE = 5      # rides/day
RECENT_FRACTION = 0.30
NEIGHBOR_RINGS = 2
NEIGHBOR_GAIN = 1.30
SCORE = 0.7
LABEL = 'Path traffic dropped sharply'

def aggregate_traffic(points, now):
    """points: iterable of (ride_id, ts, lat, lon, source). Returns {cell: {day: set(rides)}} and cell->sources."""
    days, sources = defaultdict(lambda: defaultdict(set)), defaultdict(set)
    for ride_id, ts, lat, lon, source in points:
        age = (now - ts).total_seconds()
        if age < 0:
            continue
        cell = h3.latlng_to_cell(lat, lon, RESOLUTION)
        days[cell][int(age // 86400)].add(ride_id)
        sources[cell].add(source)
    return days, sources

def rates(days_for_cell):
    baseline = sum(len(days_for_cell.get(k, ())) for k in BASELINE_DAYS) / len(BASELINE_DAYS)
    recent = sum(len(days_for_cell.get(k, ())) for k in RECENT_DAYS) / len(RECENT_DAYS)
    return baseline, recent

def find_abandoned_cells(days):
    stats = {cell: rates(d) for cell, d in days.items()}
    flagged = set()
    for cell, (baseline, recent) in stats.items():
        if baseline < MIN_BASELINE_RATE or recent >= RECENT_FRACTION * baseline:
            continue
        for neighbor in h3.grid_disk(cell, NEIGHBOR_RINGS):
            if neighbor == cell or neighbor not in stats:
                continue  # no history for that cell: never treat missing data as evidence
            n_base, n_recent = stats[neighbor]
            if n_base > 0 and n_recent > NEIGHBOR_GAIN * n_base:
                flagged.add(cell)
                break
    return flagged, stats

def group_cells(cells):
    """Connected components over shared edges (grid_disk(1)); each becomes one Polygon candidate."""
    remaining, groups = set(cells), []
    while remaining:
        stack, group = [remaining.pop()], set()
        while stack:
            cell = stack.pop()
            group.add(cell)
            for neighbor in h3.grid_disk(cell, 1):
                if neighbor in remaining:
                    remaining.discard(neighbor)
                    stack.append(neighbor)
        groups.append(group)
    return groups

def polygons(group):
    """Longitude-first Polygon geometries for a group (never a MultiPolygon, never a convex hull)."""
    shape = h3.cells_to_geo(sorted(group))
    parts = shape['coordinates'] if shape['type'] == 'MultiPolygon' else [shape['coordinates']]
    return [{'type': 'Polygon', 'coordinates': [[list(p) for p in ring] for ring in part]} for part in parts]

def candidates(days, sources, now):
    flagged, stats = find_abandoned_cells(days)
    found = []
    for group in sorted(group_cells(flagged), key=lambda g: min(g)):
        origin = {s for cell in group for s in sources[cell]}
        rides = set().union(*(r for cell in group for k, r in days[cell].items() if k in BASELINE_DAYS))
        for geometry in polygons(group):
            found.append({'kind': 'abandoned', 'geometry': geometry, 'score': SCORE, 'event_count': 0,
                          'ride_count': len(rides), 'first_seen': now - timedelta(hours=48), 'last_seen': now,
                          'label': LABEL, 'evidence_source': origin.pop() if len(origin) == 1 else 'mixed'})
            origin = {s for cell in group for s in sources[cell]}
    return found, flagged, stats
