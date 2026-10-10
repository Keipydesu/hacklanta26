"""Synthetic brake/bump observations for the separate observation API.

Coordinates stand for already-trimmed data and are never trimmed again. Everything generated here
is labeled with the scenario's evidence source (simulated), and nothing lowers the worker's
clustering thresholds: a scenario either meets them or is a negative control.
"""
import math
import random
from datetime import timedelta

from .clock import iso
from .geo import offset
from .identity import item_id
from .models import Scenario
from .transport import Run, ScenarioFailed

MAX_EVENTS_PER_BATCH = 500
MAX_POINTS_PER_BATCH = 2000


def chunk(items: list, size: int) -> list[list]:
    return [items[i:i + size] for i in range(0, len(items), size)]


def generate_observations(run_id: str, scenario: Scenario, seed: int, now, at: dict | None = None) -> dict:
    """Returns {'events': [...], 'points': {ride_id: [...]}}. Same run, seed and clock → same bodies.

    `at` moves the whole scenario so its first cluster sits on the given point (for placing a demo
    hazard on a route seen in the app); relative layout between clusters is kept.
    """
    rng = random.Random(f'{scenario.name}|{seed}')
    source = scenario.get('evidence_source')
    clusters = scenario.get('clusters')
    shift_lat = shift_lon = 0.0
    if at:
        shift_lat = at['lat'] - clusters[0]['center']['lat']
        shift_lon = at['lon'] - clusters[0]['center']['lon']
    events, points = [], {}
    for cluster in clusters:
        key, kind = cluster['key'], cluster['type']
        center_lat, center_lon = cluster['center']['lat'] + shift_lat, cluster['center']['lon'] + shift_lon
        low, high = cluster.get('age_minutes', [0, 30])
        radius = cluster.get('radius_m', 4)
        rides = [item_id(run_id, scenario.name, f'ride/{key}/{i}') for i in range(cluster['rides'])]
        ride_last_seen = {}
        for index in range(cluster['events']):
            ride = rides[index % len(rides)]
            angle, reach = rng.uniform(0, 2 * math.pi), radius * math.sqrt(rng.random())
            lat, lon = offset(center_lat, center_lon, reach * math.cos(angle), reach * math.sin(angle))
            moment = now - timedelta(minutes=rng.uniform(low, high))
            if kind == 'hard_brake':
                before = rng.uniform(5.0, 7.5)
                measured = {'speed_before_mps': before, 'speed_after_mps': before - rng.uniform(2.5, 4.5), 'peak_g': rng.uniform(0.4, 0.7), 'duration_ms': rng.uniform(400, 900)}
            else:
                before = rng.uniform(4.0, 6.5)
                measured = {'speed_before_mps': before, 'speed_after_mps': before - rng.uniform(0, 0.6), 'peak_g': rng.uniform(1.2, 2.0), 'duration_ms': rng.uniform(40, 120)}
            events.append({
                'id': item_id(run_id, scenario.name, f'event/{key}/{index}'), 'ride_id': ride, 'type': kind, 'ts': iso(moment),
                'lat': round(lat, 7), 'lon': round(lon, 7), 'accuracy_m': round(rng.uniform(3, 8), 1),
                'speed_before_mps': round(measured['speed_before_mps'], 2), 'speed_after_mps': round(max(0.0, measured['speed_after_mps']), 2),
                'peak_g': round(measured['peak_g'], 3), 'duration_ms': round(measured['duration_ms']), 'source': source,
            })
            ride_last_seen[ride] = max(ride_last_seen.get(ride, moment), moment)
        per_ride = scenario.get('points_per_ride', 0)
        for ride in rides:
            if not per_ride or ride not in ride_last_seen:
                continue
            # A short straight pass through the spot, one point per second at scooter pace.
            heading = rng.uniform(0, 2 * math.pi)
            speed = rng.uniform(4.0, 6.0)
            end = ride_last_seen[ride] + timedelta(seconds=per_ride // 2)
            trace = []
            for step in range(per_ride):
                along = (step - per_ride / 2) * speed
                lat, lon = offset(center_lat, center_lon, along * math.cos(heading), along * math.sin(heading))
                trace.append({
                    'id': item_id(run_id, scenario.name, f'point/{ride}/{step}'), 'ts': iso(end - timedelta(seconds=per_ride - 1 - step)),
                    'lat': round(lat, 7), 'lon': round(lon, 7), 'speed_mps': round(speed, 2), 'accuracy_m': 5.0, 'source': source,
                })
            points[ride] = trace
    latest = max((e['ts'] for e in events), default=None)
    if latest and latest > iso(now + timedelta(minutes=5)):
        raise ScenarioFailed(f'{scenario.name}: generated a timestamp more than five minutes in the future')
    return {'events': events, 'points': points}


def planned(run_id: str, scenario: Scenario, seed: int, now, at: dict | None = None) -> list[dict]:
    data = generate_observations(run_id, scenario, seed, now, at)
    requests = []
    for index, part in enumerate(chunk(data['events'], MAX_EVENTS_PER_BATCH)):
        requests.append({'key': f'events-{index}', 'method': 'POST', 'target': 'automation', 'path': '/v1/events', 'body': {'events': part}, 'expect': [200]})
    for ride, trace in data['points'].items():
        for index, part in enumerate(chunk(trace, MAX_POINTS_PER_BATCH)):
            requests.append({'key': f'points-{ride}-{index}', 'method': 'POST', 'target': 'automation', 'path': f'/v1/rides/{ride}/points', 'body': {'points': part}, 'expect': [200]})
    return requests


def send_observations(run: Run, scenario: Scenario, seed: int, now, at: dict | None = None) -> dict:
    """Upload every batch. 409/422 fail the scenario immediately; nothing is retried forever."""
    accepted = duplicates = 0
    for request in planned(run.manifest.run_id, scenario, seed, now, at):
        reply = run.send(request['key'], 'POST', 'automation', request['path'], request['body'], expect=(200,), step='ingest')
        size = len(next(iter(request['body'].values())))
        receipt = reply.body or {}
        if receipt.get('accepted', 0) + receipt.get('duplicates', 0) != size:
            raise ScenarioFailed(f'{scenario.name}: {request["key"]} sent {size} observations but the receipt counts {receipt}')
        accepted += receipt['accepted']
        duplicates += receipt['duplicates']
    run.evidence('ingested', True, accepted=accepted, duplicates=duplicates,
                 note='accepted by the observation API; this is not yet a published hazard')
    return {'accepted': accepted, 'duplicates': duplicates}


def expectations(scenario: Scenario, at: dict | None = None) -> tuple[list[dict], list[dict]]:
    """Scenario expectations (present, absent), shifted the same way the observations were."""
    clusters = scenario.get('clusters')
    shift_lat = (at['lat'] - clusters[0]['center']['lat']) if at else 0.0
    shift_lon = (at['lon'] - clusters[0]['center']['lon']) if at else 0.0

    def moved(entry: dict) -> dict:
        return {**entry, 'source': 'automatic', 'near': {'lat': entry['near']['lat'] + shift_lat, 'lon': entry['near']['lon'] + shift_lon}}
    expect = scenario.get('expect', {})
    return [moved(e) for e in expect.get('hazards', [])], [moved(e) for e in expect.get('absent', [])]
