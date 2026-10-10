"""Database-free regressions: abandonment provenance and the D4 acceptance probe's correlation logic."""
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import h3

from app import abandonment
import acceptance_probe as probe

NOW = datetime(2026, 10, 10, 12, 0, tzinfo=timezone.utc)
BUSY, NEIGHBOR = (33.7531, -84.3853), (33.7541, -84.3853)

def points(place, per_day, days, source):
    return [(str(uuid4()), NOW - timedelta(days=k, hours=12), place[0], place[1], source) for k in days for _ in range(per_day)]

def candidates(rows):
    days, sources = abandonment.aggregate_traffic(rows, NOW)
    return abandonment.candidates(days, sources, NOW)[0]

def test_neighbor_evidence_that_qualifies_the_hazard_is_part_of_its_provenance():
    rows = (points(BUSY, 6, range(2, 14), 'device') + points(NEIGHBOR, 5, range(2, 14), 'simulated')
            + points(NEIGHBOR, 9, range(0, 2), 'simulated'))
    found = candidates(rows)
    assert [c['evidence_source'] for c in found] == ['mixed']

def test_replayed_diversion_next_to_device_baseline_is_mixed_and_all_device_stays_device():
    base = points(BUSY, 6, range(2, 14), 'device')
    assert candidates(base + points(NEIGHBOR, 5, range(2, 14), 'device') + points(NEIGHBOR, 9, range(0, 2), 'replay'))[0]['evidence_source'] == 'mixed'
    assert candidates(base + points(NEIGHBOR, 5, range(2, 14), 'device') + points(NEIGHBOR, 9, range(0, 2), 'device'))[0]['evidence_source'] == 'device'

def test_unrelated_neighbors_do_not_taint_provenance():
    far = (33.7600, -84.3700)   # a simulated cell far outside the neighbor rings
    rows = (points(BUSY, 6, range(2, 14), 'device') + points(NEIGHBOR, 5, range(2, 14), 'device')
            + points(NEIGHBOR, 9, range(0, 2), 'device') + points(far, 6, range(0, 14), 'simulated'))
    assert [c['evidence_source'] for c in candidates(rows)] == ['device']

# ---- acceptance probe ------------------------------------------------------------------------

def feature(external, lat, lon, **props):
    d = 1e-4
    ring = [[lon - d, lat - d], [lon + d, lat - d], [lon + d, lat + d], [lon - d, lat + d], [lon - d, lat - d]]
    base = {'id': external, 'source': 'automatic', 'label': 'Hard braking here', 'last_seen': 't0', 'event_count': 4,
            'ride_count': 2, 'score': 0.5, 'status': 'active', 'expires_at': 'x', 'evidence_source': 'simulated', 'kind': 'braking'}
    return {'type': 'Feature', 'geometry': {'type': 'Polygon', 'coordinates': [ring]}, 'properties': dict(base, **props)}

def feed(*features):
    return {f['properties']['id']: f for f in features}

EVENTS = [{'lat': 33.7600, 'lon': -84.3853}, {'lat': 33.7601, 'lon': -84.3853}]

def test_probe_fails_when_observations_are_accepted_but_nothing_was_published():
    old_elsewhere = feature('old', 33.7000, -84.3000)
    assert probe.attributable(feed(old_elsewhere), feed(old_elsewhere), EVENTS) == {}

def test_an_old_unchanged_hazard_at_the_same_spot_does_not_satisfy_the_gate():
    old_here = feature('old', 33.76005, -84.3853)
    assert probe.attributable(feed(old_here), feed(old_here), EVENTS) == {}

def test_a_new_hazard_on_the_run_location_is_attributed_and_an_unrelated_new_one_is_not():
    new_here, new_elsewhere = feature('new', 33.76005, -84.3853), feature('other', 33.7000, -84.3000)
    assert set(probe.attributable({}, feed(new_here, new_elsewhere), EVENTS)) == {'new'}

def test_an_existing_hazard_updated_by_this_run_is_attributed():
    before = feature('old', 33.76005, -84.3853)
    after = feature('old', 33.76005, -84.3853, event_count=6, last_seen='t1')
    assert set(probe.attributable(feed(before), feed(after), EVENTS)) == {'old'}
