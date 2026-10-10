"""Pure checks: identity, clock, scenario validation, generated payloads, batching, trimming."""
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import tempfile
import unittest

from simulator import manual, observations, publication, replay
from simulator.clock import freeze, iso, parse_time, rebase_offset_ms
from simulator.geo import bbox_around, distance_m, offset, ring_center, square
from simulator.identity import item_id, run_namespace
from simulator.models import SCENARIO_DIR, ManifestError, RunManifest, ScenarioError, load_scenario, validate_scenario

NOW = freeze('2026-10-10T12:00:00Z')
RUN = str(run_namespace('braking-spot', 42, iso(NOW)))


class IdentityAndClock(unittest.TestCase):
    def test_ids_are_stable_per_run_and_item(self):
        self.assertEqual(item_id(RUN, 's', 'event/0'), item_id(RUN, 's', 'event/0'))
        self.assertNotEqual(item_id(RUN, 's', 'event/0'), item_id(RUN, 's', 'event/1'))
        other = str(run_namespace('braking-spot', 42, '2026-10-10T12:00:01.000Z'))
        self.assertNotEqual(item_id(RUN, 's', 'event/0'), item_id(other, 's', 'event/0'), 'a fresh run gets fresh IDs')
        self.assertNotEqual(RUN, str(run_namespace('braking-spot', 43, iso(NOW))))

    def test_clock_is_frozen_utc_and_requires_a_timezone(self):
        self.assertEqual(iso(NOW), '2026-10-10T12:00:00.000Z')
        self.assertEqual(iso(parse_time('2026-10-10T08:00:00-04:00')), '2026-10-10T12:00:00.000Z')
        with self.assertRaises(ValueError):
            parse_time('2026-10-10T12:00:00')

    def test_rebase_uses_one_offset_and_never_lands_in_the_future(self):
        events = [{'t_ms': 1000, 'type': 'bump'}, {'t_ms': 4000, 'type': 'hard_brake'}]
        gps = [{'t_ms': 500}, {'t_ms': 5000}]
        moved_events, moved_gps, shift = replay.rebase_recording(events, gps, NOW)
        self.assertEqual(shift, rebase_offset_ms(5000, NOW))
        self.assertEqual(moved_gps[-1]['t_ms'], int(NOW.timestamp() * 1000))
        self.assertEqual(moved_events[1]['t_ms'] - moved_events[0]['t_ms'], 3000, 'gaps are preserved')
        self.assertTrue(all(item['t_ms'] <= NOW.timestamp() * 1000 for item in moved_events + moved_gps))


class Geometry(unittest.TestCase):
    def test_offsets_and_distances_agree(self):
        lat, lon = offset(33.75, -84.38, 30, 40)
        self.assertAlmostEqual(distance_m(33.75, -84.38, lat, lon), 50, delta=0.2)

    def test_square_is_closed_longitude_first_and_centred(self):
        ring = square(33.75, -84.38, 10)[0]
        self.assertEqual(ring[0], ring[-1])
        self.assertEqual(len(ring), 5)
        self.assertTrue(all(-85 < p[0] < -84 and 33 < p[1] < 34 for p in ring))
        lat, lon = ring_center(ring)
        self.assertAlmostEqual(distance_m(lat, lon, 33.75, -84.38), 0, delta=0.05)

    def test_bbox_has_increasing_bounds(self):
        west, south, east, north = (float(v) for v in bbox_around([(33.75, -84.38), (33.76, -84.39)]).split(','))
        self.assertTrue(west < -84.39 < -84.38 < east and south < 33.75 < 33.76 < north)


class Scenarios(unittest.TestCase):
    def test_every_checked_in_scenario_is_valid(self):
        names = sorted(p.stem for p in SCENARIO_DIR.glob('*.json'))
        self.assertIn('demo-seed', names)
        for name in names:
            scenario = load_scenario(name)
            self.assertEqual(scenario.name, name)

    def test_contradictory_or_incomplete_scenarios_are_rejected(self):
        good = json.loads((SCENARIO_DIR / 'braking-spot.json').read_text())
        for mutate, pattern in [
            (lambda d: d.pop('evidence_source'), 'labeled'),
            (lambda d: d.update(evidence_source='device'), 'labeled'),
            (lambda d: d['clusters'][0].update(rides=9), 'rides <= events'),
            (lambda d: d['clusters'][0].update(radius_m=30), 'radius_m'),
            (lambda d: d['clusters'][0]['center'].update(lat=123), 'WGS84'),
            (lambda d: d['clusters'].append(dict(d['clusters'][0])), 'unique key'),
            (lambda d: d['expect']['hazards'][0].update(kind='volcano'), 'not a hazard kind'),
            (lambda d: d.update(kind='nonsense'), 'kind must be'),
        ]:
            data = json.loads(json.dumps(good))
            mutate(data)
            with self.assertRaisesRegex(ScenarioError, pattern):
                validate_scenario(data)
        manual_good = json.loads((SCENARIO_DIR / 'manual-report.json').read_text())
        manual_good['report']['description'] = 'pothole'
        with self.assertRaisesRegex(ScenarioError, 'DEMO'):
            validate_scenario(manual_good)
        expired = json.loads((SCENARIO_DIR / 'manual-expired.json').read_text())
        expired['expect_active'] = True
        with self.assertRaisesRegex(ScenarioError, 'contradicts'):
            validate_scenario(expired)
        with self.assertRaisesRegex(ScenarioError, 'no scenario'):
            load_scenario('does-not-exist')

    def test_thresholds_match_the_worker_and_the_negative_control_stays_below_them(self):
        seed = load_scenario('demo-seed').get('clusters')[0]
        self.assertGreaterEqual(seed['events'], 3)
        self.assertGreaterEqual(seed['rides'], 2)
        negative = load_scenario('demo-seed-negative')
        self.assertLess(negative.get('clusters')[0]['events'], 3)
        self.assertFalse(negative.get('expect').get('hazards'))


class GeneratedPayloads(unittest.TestCase):
    def test_same_run_seed_and_clock_give_identical_bodies(self):
        scenario = load_scenario('braking-spot')
        first = observations.planned(RUN, scenario, 42, NOW)
        self.assertEqual(json.dumps(first), json.dumps(observations.planned(RUN, scenario, 42, NOW)))
        self.assertNotEqual(json.dumps(first), json.dumps(observations.planned(RUN, scenario, 43, NOW)))

    def test_observations_satisfy_the_contract_and_the_clustering_distance(self):
        for name in ('braking-spot', 'bump-spot', 'two-clusters', 'demo-seed', 'demo-seed-negative'):
            scenario = load_scenario(name)
            data = observations.generate_observations(RUN, scenario, 42, NOW)
            ids = [e['id'] for e in data['events']] + [p['id'] for trace in data['points'].values() for p in trace]
            self.assertEqual(len(ids), len(set(ids)), f'{name}: IDs must be unique')
            for event in data['events']:
                self.assertEqual(event['source'], 'simulated')
                self.assertIn(event['type'], ('hard_brake', 'bump'))
                self.assertLessEqual(parse_time(event['ts']), NOW + timedelta(minutes=5))
                for key in ('accuracy_m', 'speed_before_mps', 'speed_after_mps', 'peak_g', 'duration_ms'):
                    self.assertGreaterEqual(event[key], 0, f'{name}: {key}')
            for cluster in scenario.get('clusters'):
                members = [e for e in data['events'] if distance_m(e['lat'], e['lon'], cluster['center']['lat'], cluster['center']['lon']) <= 6.5]
                self.assertEqual(len(members), cluster['events'], f'{name}/{cluster["key"]}: every event within 12 m of the others')
                self.assertEqual(len({e['ride_id'] for e in members}), cluster['rides'])
            for ride, trace in data['points'].items():
                self.assertEqual(len(trace), scenario.get('points_per_ride'))
                stamps = [p['ts'] for p in trace]
                self.assertEqual(stamps, sorted(stamps))
                self.assertTrue(all(p['source'] == 'simulated' and p['speed_mps'] >= 0 for p in trace))

    def test_hard_brakes_lose_speed_and_bumps_are_short(self):
        brakes = observations.generate_observations(RUN, load_scenario('braking-spot'), 42, NOW)['events']
        self.assertTrue(all(e['speed_before_mps'] - e['speed_after_mps'] >= 2 and e['speed_before_mps'] >= 3 for e in brakes))
        bumps = observations.generate_observations(RUN, load_scenario('bump-spot'), 42, NOW)['events']
        self.assertTrue(all(e['peak_g'] >= 1 and e['duration_ms'] < 150 for e in bumps))

    def test_two_clusters_are_further_apart_than_the_clustering_distance(self):
        north, south = load_scenario('two-clusters').get('clusters')
        gap = distance_m(north['center']['lat'], north['center']['lon'], south['center']['lat'], south['center']['lon'])
        self.assertGreater(gap - north['radius_m'] - south['radius_m'], 12)

    def test_at_moves_observations_and_expectations_together(self):
        scenario = load_scenario('two-clusters')
        target = {'lat': 33.7600, 'lon': -84.3900}
        data = observations.generate_observations(RUN, scenario, 42, NOW, at=target)
        present, _ = observations.expectations(scenario, at=target)
        self.assertAlmostEqual(distance_m(present[0]['near']['lat'], present[0]['near']['lon'], target['lat'], target['lon']), 0, delta=0.01)
        for expectation in present:
            near = [e for e in data['events'] if distance_m(e['lat'], e['lon'], expectation['near']['lat'], expectation['near']['lon']) <= 6.5]
            self.assertEqual(len(near), 4)

    def test_batches_respect_the_limits_and_keep_ride_paths(self):
        self.assertEqual([len(part) for part in observations.chunk(list(range(1201)), 500)], [500, 500, 201])
        big = validate_scenario({'name': 'big', 'kind': 'observations', 'version': 1, 'evidence_source': 'simulated', 'points_per_ride': 2000,
                                 'clusters': [{'key': 'c', 'type': 'bump', 'center': {'lat': 33.75, 'lon': -84.38}, 'events': 500, 'rides': 2, 'radius_m': 4}]})
        requests = observations.planned(RUN, big, 1, NOW)
        self.assertEqual(sum(len(r['body'].get('events', [])) for r in requests), 500)
        for request in requests:
            if 'points' in request['body']:
                self.assertLessEqual(len(request['body']['points']), 2000)
                self.assertRegex(request['path'], r'^/v1/rides/[0-9a-f-]{36}/points$')

    def test_manual_and_publication_bodies(self):
        create, retry, conflict = manual.planned(RUN, load_scenario('manual-report'), NOW)
        self.assertEqual(create['body'], retry['body'])
        self.assertEqual(conflict['body']['id'], create['body']['id'])
        self.assertNotEqual(conflict['body'], create['body'])
        self.assertIn('DEMO', create['body']['description'])
        expired = manual.generate_manual(RUN, load_scenario('manual-expired'), NOW)
        self.assertLess(parse_time(expired['observed_at']), NOW - timedelta(hours=24))

        scenario = load_scenario('publication-lifecycle')
        steps = {s['key']: s for s in publication.planned(RUN, scenario, NOW)}
        one, two, three = steps['revision-1']['body'], steps['revision-2']['body'], steps['revision-3-resolved']['body']
        self.assertEqual(steps['revision-1-retry']['body'], one)
        self.assertEqual(steps['revision-1-stale']['body'], one)
        self.assertEqual([one['revision'], two['revision'], three['revision']], [1, 2, 3])
        self.assertEqual(three['status'], 'resolved')
        self.assertEqual(set(three), set(one), 'resolution is a complete body, not a patch')
        self.assertEqual(one['evidence_source'], 'simulated')
        self.assertTrue(one['first_seen'] <= one['last_seen'] <= one['expires_at'])
        self.assertEqual(len({s['path'] for k, s in steps.items() if k != 'control-report'}), 1, 'one stable external ID')


class Manifests(unittest.TestCase):
    def test_round_trip_and_resume_guards(self):
        scenario = load_scenario('demo-seed')
        with tempfile.TemporaryDirectory() as folder:
            manifest = RunManifest(scenario=scenario.name, scenario_version=1, scenario_digest=scenario.digest, seed=42, now=iso(NOW), run_id=RUN,
                                   endpoints={'automation': 'http://a'}, path=Path(folder) / 'run.json')
            manifest.requests.append({'key': 'k', 'method': 'POST', 'target': 'automation', 'path': '/v1/events', 'body': {'events': []}})
            manifest.save()
            loaded = RunManifest.load(manifest.path)
            self.assertEqual(loaded.to_json(), manifest.to_json())
            self.assertNotIn('Bearer', loaded.to_json())
            loaded.check_resume(scenario.name, scenario.digest, {'automation': 'http://a'}, 42)
            with self.assertRaisesRegex(ManifestError, 'changed'):
                loaded.check_resume(scenario.name, 'different-digest', {'automation': 'http://a'})
            with self.assertRaisesRegex(ManifestError, 'started against'):
                loaded.check_resume(scenario.name, scenario.digest, {'automation': 'http://elsewhere'})
            with self.assertRaisesRegex(ManifestError, 'seed'):
                loaded.check_resume(scenario.name, scenario.digest, {'automation': 'http://a'}, 7)


class Recordings(unittest.TestCase):
    def write(self, folder: Path, metres: float, trimmed=False):
        folder.mkdir(parents=True, exist_ok=True)
        gps, motion = ['t_ms,lat,lon,speed_mps,accuracy_m'], ['t_ms,ax,ay,az,gx,gy,gz']
        steps = int(metres / 5)
        for i in range(steps + 1):
            lat, lon = offset(33.75, -84.38, i * 5, 0)
            gps.append(f'{i * 1000},{lat:.7f},{lon:.7f},{"" if i == 3 else 5},5')
            for k in range(0, 1000, 500):
                motion.append(f'{i * 1000 + k},0,0,0,0,0,9.80665')
        (folder / 'gps-0000.csv').write_text('\n'.join(gps) + '\n')
        (folder / 'motion-0000.csv').write_text('\n'.join(motion) + '\n')
        (folder / 'labels-0000.csv').write_text('t_ms,type\n2000,bump\n60000,hard_brake\n')
        (folder / 'meta.json').write_text(json.dumps({'ride_id': 'r', 'trimmed': trimmed}))
        return folder

    def test_trim_removes_both_endpoint_zones_and_marks_provenance(self):
        with tempfile.TemporaryDirectory() as root:
            raw = self.write(Path(root) / 'raw', 600)
            meta = replay.trim_recording(raw, Path(root) / 'trimmed')
            self.assertTrue(meta['trimmed'])
            gps = replay.read_rows(Path(root) / 'trimmed', 'gps')
            first = distance_m(33.75, -84.38, gps[0]['lat'], gps[0]['lon'])
            last = distance_m(33.75, -84.38, gps[-1]['lat'], gps[-1]['lon'])
            self.assertGreater(first, 100)
            self.assertLess(last, 500)
            motion = replay.read_rows(Path(root) / 'trimmed', 'motion')
            self.assertTrue(all(gps[0]['t_ms'] <= m['t_ms'] <= gps[-1]['t_ms'] for m in motion))
            labels = replay.read_rows(Path(root) / 'trimmed', 'labels')
            self.assertEqual([row['type'] for row in labels], ['hard_brake'], 'the label inside the start zone is gone')
            with self.assertRaisesRegex(replay.RecordingError, 'already marked trimmed'):
                replay.trim_recording(Path(root) / 'trimmed', Path(root) / 'again')

    def test_blank_speed_stays_unknown(self):
        with tempfile.TemporaryDirectory() as root:
            rows = replay.read_rows(self.write(Path(root) / 'raw', 100), 'gps')
            self.assertIsNone(rows[3]['speed_mps'])
            self.assertEqual(rows[0]['speed_mps'], 5.0)

    def test_a_short_ride_has_nothing_to_keep(self):
        with tempfile.TemporaryDirectory() as root:
            with self.assertRaisesRegex(replay.RecordingError, 'nothing is left'):
                replay.trim_recording(self.write(Path(root) / 'raw', 180), Path(root) / 'out')

    def test_untrimmed_recordings_are_never_planned_for_upload(self):
        with tempfile.TemporaryDirectory() as root:
            raw = self.write(Path(root) / 'raw', 600)
            with self.assertRaisesRegex(replay.RecordingError, 'not marked trimmed'):
                replay.planned(RUN, raw, {'events': []}, NOW)

    def test_replay_upload_is_labeled_replay_rebased_and_skips_unknown_speed(self):
        with tempfile.TemporaryDirectory() as root:
            recording = self.write(Path(root) / 'ride', 600, trimmed=True)
            detected = {'events': [{'type': 'bump', 't_ms': 50_000, 'lat': 33.7522, 'lon': -84.38, 'accuracy_m': 5, 'speed_before_mps': 5,
                                    'speed_after_mps': 5, 'peak_g': 1.6, 'duration_ms': 60}]}
            requests = replay.planned(RUN, recording, detected, NOW)
            self.assertEqual(json.dumps(requests), json.dumps(replay.planned(RUN, recording, detected, NOW)), 'identical retry payloads')
            events = [e for r in requests for e in r['body'].get('events', [])]
            points = [p for r in requests for p in r['body'].get('points', [])]
            self.assertEqual({e['source'] for e in events} | {p['source'] for p in points}, {'replay'})
            self.assertEqual(len(points), 120, 'the fix with unknown speed is not uploaded as zero')
            self.assertEqual(max(parse_time(p['ts']) for p in points), NOW)
            self.assertEqual(parse_time(events[0]['ts']), NOW - timedelta(seconds=70))
            self.assertRegex(requests[-1]['path'], rf'/v1/rides/{events[0]["ride_id"]}/points')


if __name__ == '__main__':
    unittest.main()
