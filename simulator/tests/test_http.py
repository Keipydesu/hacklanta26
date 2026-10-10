"""Scenario flows against in-memory HTTP stand-ins (see fakes.py). No real service is involved."""
import contextlib
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock

from simulator import cli
from tests.fakes import KEY, Services, serve

NOW = '2026-10-10T12:00:00Z'


class HttpScenarios(unittest.TestCase):
    def setUp(self):
        self.services = Services()
        self.url, shutdown = serve(self.services)
        self.addCleanup(shutdown)
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        sleeper = mock.patch('time.sleep', lambda seconds: None)
        sleeper.start()
        self.addCleanup(sleeper.stop)

    def run_cli(self, *argv, env=None):
        out, err = io.StringIO(), io.StringIO()
        with mock.patch.dict(os.environ, env or {}, clear=False), contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = cli.main([*argv, '--out', self.folder.name] if argv[0] != 'trim' else list(argv))
        return code, out.getvalue(), err.getvalue()

    def writes(self, prefix=''):
        return [(m, p, raw) for m, p, raw in self.services.requests if m != 'GET' and p.startswith(prefix)]

    def manifest(self):
        files = sorted(Path(self.folder.name).glob('*.json'), key=lambda p: p.stat().st_mtime)
        return files[-1], json.loads(files[-1].read_text())

    # --- dry run ---------------------------------------------------------------------------
    def test_dry_run_is_the_default_and_touches_no_network(self):
        for argv in (['manual', '--product-url', self.url], ['publication', '--product-url', self.url],
                     ['observations', '--scenario', 'demo-seed', '--automation-url', self.url, '--product-url', self.url],
                     ['manual', '--product-url', self.url, '--demo-target', '--dry-run']):
            code, out, _ = self.run_cli(*argv, '--now', NOW)
            self.assertEqual(code, 0)
            self.assertTrue(json.loads(out)['dry_run'])
        self.assertEqual(self.services.requests, [])
        self.assertEqual(list(Path(self.folder.name).iterdir()), [], 'a dry run leaves no manifest behind')

    def test_dry_run_output_is_deterministic_and_hides_the_key(self):
        first = self.run_cli('publication', '--now', NOW, env={'AUTOMATION_PUBLISH_KEY': KEY})[1]
        second = self.run_cli('publication', '--now', NOW, env={'AUTOMATION_PUBLISH_KEY': KEY})[1]
        self.assertEqual(first, second)
        self.assertNotIn(KEY, first)
        self.assertIn('Bearer <AUTOMATION_PUBLISH_KEY>', first)

    def test_demo_target_requires_an_explicit_url(self):
        code, _, err = self.run_cli('manual', '--demo-target', env={'PRODUCT_API_URL': ''})
        self.assertEqual(code, 1)
        self.assertIn('explicit product URL', err)

    # --- manual ----------------------------------------------------------------------------
    def test_manual_report_create_retry_conflict_and_read_back(self):
        code, out, err = self.run_cli('manual', '--product-url', self.url, '--demo-target')
        self.assertEqual(code, 0, err)
        posts = self.writes('/v1/reports')
        self.assertEqual(len(posts), 3)
        self.assertEqual(posts[0][2], posts[1][2], 'the retry resends identical bytes')
        self.assertNotEqual(posts[0][2], posts[2][2])
        self.assertEqual(len(self.services.hazards), 1, 'still exactly one manual hazard')
        lines = [json.loads(line) for line in out.strip().splitlines()]
        self.assertEqual([e['status'] for e in lines if 'status' in e], [201, 200, 409])
        self.assertEqual(lines[-1]['result'], 'PASS')
        self.assertTrue(all(e['ok'] for e in self.manifest()[1]['evidence']))

    def test_expired_report_is_accepted_but_not_active(self):
        code, out, err = self.run_cli('manual', '--scenario', 'manual-expired', '--product-url', self.url, '--demo-target')
        self.assertEqual(code, 0, err)
        self.assertIn('expired-report-not-active', out)
        self.assertEqual(len(self.services.reports), 1)

    def test_resume_reuses_ids_and_bodies_and_refuses_a_different_target(self):
        self.assertEqual(self.run_cli('manual', '--product-url', self.url, '--demo-target')[0], 0)
        path, before = self.manifest()
        first_body = self.writes('/v1/reports')[0][2]
        code, _, err = self.run_cli('manual', '--product-url', self.url, '--demo-target', '--resume', str(path))
        self.assertEqual(code, 0, err)
        self.assertEqual(self.writes('/v1/reports')[3][2], first_body)
        self.assertEqual(len(self.services.reports), 1, 'resuming did not create a second report')
        self.assertEqual(self.manifest()[1]['run_id'], before['run_id'])
        code, _, err = self.run_cli('manual', '--product-url', 'http://127.0.0.1:9', '--demo-target', '--resume', str(path))
        self.assertEqual(code, 2)
        self.assertIn('started against', err)
        code, _, err = self.run_cli('manual', '--scenario', 'manual-expired', '--product-url', self.url, '--demo-target', '--resume', str(path))
        self.assertEqual(code, 2)
        self.assertIn('changed since this run started', err)

    def test_a_wrong_answer_fails_the_scenario_with_context(self):
        self.services.fail_next = [404]
        code, _, err = self.run_cli('manual', '--product-url', self.url, '--demo-target')
        self.assertEqual(code, 1)
        self.assertIn('manual-report: create (report) expected [201, 200] but received 404', err)

    # --- publication -----------------------------------------------------------------------
    def test_publication_lifecycle_preserves_the_manual_control(self):
        code, out, err = self.run_cli('publication', '--product-url', self.url, '--demo-target', env={'AUTOMATION_PUBLISH_KEY': KEY})
        self.assertEqual(code, 0, err)
        statuses = {e['step']: e['status'] for e in map(json.loads, out.strip().splitlines()) if 'status' in e}
        self.assertEqual(statuses, {'manual-control': 201, 'missing-credential': 401, 'invalid-credential': 401, 'create': 201, 'identical-retry': 200,
                                    'update': 200, 'stale-revision-rejected': 409, 'resolve': 200})
        self.assertNotIn(KEY, out + err)
        _, manifest = self.manifest()
        self.assertNotIn(KEY, json.dumps(manifest))
        steps = [e['step'] for e in manifest['evidence']]
        self.assertIn('manual-preserved', steps)
        self.assertIn('resolved-leaves-feed', steps)
        active = self.services.feed()['features']
        self.assertEqual([f['properties']['source'] for f in active], ['manual'])

    def test_stop_after_create_leaves_a_labeled_hazard_visible(self):
        code, _, err = self.run_cli('publication', '--product-url', self.url, '--demo-target', '--stop-after', 'create', env={'AUTOMATION_PUBLISH_KEY': KEY})
        self.assertEqual(code, 0, err)
        automatic = [f['properties'] for f in self.services.feed()['features'] if f['properties']['source'] == 'automatic']
        self.assertEqual(len(automatic), 1)
        self.assertEqual(automatic[0]['evidence_source'], 'simulated')
        self.assertIn('DEMO', automatic[0]['label'])

    def test_resuming_a_partial_publication_run_finishes_instead_of_409(self):
        argv = ['publication', '--product-url', self.url, '--demo-target', '--stop-after', 'update']
        self.assertEqual(self.run_cli(*argv, env={'AUTOMATION_PUBLISH_KEY': KEY})[0], 0)
        path, _ = self.manifest()
        code, out, err = self.run_cli('publication', '--product-url', self.url, '--demo-target', '--resume', str(path), env={'AUTOMATION_PUBLISH_KEY': KEY})
        self.assertEqual(code, 0, err)
        self.assertIn('already completed in this run', out)
        self.assertEqual([f['properties']['source'] for f in self.services.feed()['features']], ['manual'])

    def test_a_resume_that_succeeds_clears_the_earlier_failure(self):
        self.services.fail_next = [404]
        self.assertEqual(self.run_cli('manual', '--product-url', self.url, '--demo-target')[0], 1)
        path, _ = self.manifest()
        code, out, err = self.run_cli('manual', '--product-url', self.url, '--demo-target', '--resume', str(path))
        self.assertEqual(code, 0, err)
        self.assertEqual(json.loads(out.strip().splitlines()[-1])['result'], 'PASS')

    def test_dry_run_plan_matches_the_live_publication_requests(self):
        _, manifest = self.manifest() if False else (None, None)
        code, out, err = self.run_cli('publication', '--product-url', self.url, env={'AUTOMATION_PUBLISH_KEY': KEY})
        self.assertEqual(code, 0, err)
        planned = [r['key'] for r in json.loads(out)['requests']]
        self.assertEqual(self.writes(), [])
        self.assertEqual(self.run_cli('publication', '--product-url', self.url, '--demo-target', env={'AUTOMATION_PUBLISH_KEY': KEY})[0], 0)
        _, manifest = self.manifest()
        self.assertEqual([r['key'] for r in manifest['requests']], planned)

    def test_negative_control_gets_a_fresh_spot_each_run_so_it_cannot_accumulate(self):
        spots = set()
        for seed in (1, 2, 3, 4, 5, 6):
            code, _, err = self.run_cli('observations', '--scenario', 'demo-seed-negative', '--automation-url', self.url, '--demo-target', '--seed', str(seed), '--now', f'2026-10-10T12:00:0{seed}Z')
            self.assertEqual(code, 0, err)
        for event in self.services.events.values() if isinstance(self.services.events, dict) else self.services.events:
            body = event if isinstance(event, dict) else event[1]
            spots.add(round(body['lat'], 3))
        self.assertGreater(len(spots), 3)

    def test_publication_without_the_server_side_key_fails_clearly(self):
        code, _, err = self.run_cli('publication', '--product-url', self.url, '--demo-target', env={'AUTOMATION_PUBLISH_KEY': ''})
        self.assertEqual(code, 1)
        self.assertIn('AUTOMATION_PUBLISH_KEY is not set', err)
        self.assertEqual([f['properties']['source'] for f in self.services.feed()['features']], ['manual'])

    # --- observations ----------------------------------------------------------------------
    def test_observations_become_a_published_simulated_hazard(self):
        code, out, err = self.run_cli('observations', '--scenario', 'demo-seed', '--automation-url', self.url, '--product-url', self.url, '--demo-target', '--wait', '5')
        self.assertEqual(code, 0, err)
        evidence = [json.loads(line) for line in out.strip().splitlines()]
        awaited = next(e for e in evidence if e['step'] == 'await-hazards')
        self.assertEqual(awaited['hazards'][0]['kind'], 'braking')
        self.assertEqual(awaited['hazards'][0]['evidence_source'], 'simulated')
        self.assertEqual(len(self.services.events), 3)
        self.assertEqual(sum(len(json.loads(raw)['points']) for _, p, raw in self.writes('/v1/rides')), 24)

    def test_two_clusters_stay_two_hazards_and_bumps_become_surface(self):
        code, _, err = self.run_cli('observations', '--scenario', 'two-clusters', '--automation-url', self.url, '--product-url', self.url, '--demo-target', '--wait', '5')
        self.assertEqual(code, 0, err)
        self.assertEqual(sorted(f['properties']['kind'] for f in self.services.feed()['features']), ['braking', 'braking'])
        code, _, err = self.run_cli('observations', '--scenario', 'bump-spot', '--automation-url', self.url, '--product-url', self.url, '--demo-target', '--wait', '5')
        self.assertEqual(code, 0, err)
        self.assertIn('surface', [f['properties']['kind'] for f in self.services.feed()['features']])

    def test_negative_control_is_ingested_but_never_published(self):
        code, out, err = self.run_cli('observations', '--scenario', 'demo-seed-negative', '--automation-url', self.url, '--product-url', self.url, '--demo-target', '--wait', '1')
        self.assertEqual(code, 0, err)
        self.assertEqual(len(self.services.events), 2)
        self.assertEqual(self.services.feed()['features'], [])
        self.assertIn('assert-absent', out)

    def test_accepted_events_alone_do_not_pass_when_no_hazard_appears(self):
        self.services.worker = False
        code, out, err = self.run_cli('observations', '--scenario', 'demo-seed', '--automation-url', self.url, '--product-url', self.url, '--demo-target', '--wait', '0')
        self.assertEqual(code, 1)
        self.assertIn('not published within', err)
        self.assertEqual(json.loads(out.strip().splitlines()[-1])['step'], 'await-hazards')

    def test_ingestion_only_run_says_what_it_did_not_check(self):
        code, out, _ = self.run_cli('observations', '--scenario', 'demo-seed', '--automation-url', self.url, '--demo-target', env={'PRODUCT_API_URL': ''})
        self.assertEqual(code, 0)
        self.assertIn('ingestion-only evidence', out)

    def test_temporary_failures_retry_identical_bodies(self):
        self.services.fail_next = [503, 502]
        code, _, err = self.run_cli('observations', '--scenario', 'demo-seed', '--automation-url', self.url, '--product-url', self.url, '--demo-target', '--wait', '5')
        self.assertEqual(code, 0, err)
        events = self.writes('/v1/events')
        self.assertEqual(len(events), 3)
        self.assertEqual(len({raw for _, _, raw in events}), 1)
        self.assertEqual(len(self.services.events), 3)

    def test_conflict_fails_once_without_retrying(self):
        self.services.fail_next = [409]
        code, _, err = self.run_cli('observations', '--scenario', 'demo-seed', '--automation-url', self.url, '--demo-target')
        self.assertEqual(code, 1)
        self.assertIn('received 409', err)
        self.assertEqual(len(self.writes()), 1)

    def test_an_unreachable_service_stops_after_the_retry_budget(self):
        code, _, err = self.run_cli('observations', '--scenario', 'demo-seed', '--automation-url', 'http://127.0.0.1:9', '--demo-target', '--timeout', '0.2')
        self.assertEqual(code, 1)
        self.assertIn('did not answer after 5 attempts', err)

    def test_resumed_observations_are_duplicates_not_new_evidence(self):
        argv = ['observations', '--scenario', 'braking-spot', '--automation-url', self.url, '--product-url', self.url, '--demo-target', '--wait', '5']
        self.assertEqual(self.run_cli(*argv)[0], 0)
        path, _ = self.manifest()
        code, out, err = self.run_cli(*argv, '--resume', str(path))
        self.assertEqual(code, 0, err)
        ingested = [json.loads(line) for line in out.strip().splitlines() if '"ingested"' in line][0]
        self.assertEqual(ingested['accepted'], 0)
        self.assertEqual(ingested['duplicates'], 5 + 3 * 12)
        self.assertEqual(len(self.services.events), 5)

    # --- routes ----------------------------------------------------------------------------
    def test_stub_routes_are_reported_as_stubs(self):
        code, out, err = self.run_cli('routes', '--product-url', self.url, '--demo-target')
        self.assertEqual(code, 0, err)
        routes = next(json.loads(line) for line in out.splitlines() if '"routes"' in line and '"step": "routes"' in line)
        self.assertTrue(routes['stub'])
        self.assertIn('does not demonstrate hazard-aware routing', routes['note'])
        self.services.fail_next = [503] * 5
        code, out, _ = self.run_cli('routes', '--product-url', self.url, '--demo-target')
        self.assertEqual(code, 0)
        self.assertIn('routing unavailable', out)


if __name__ == '__main__':
    unittest.main()
