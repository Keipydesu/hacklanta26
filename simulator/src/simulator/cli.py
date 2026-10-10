"""Campus hazard map simulator.

Dry-run is the default: payloads and the requests that would be sent are printed and nothing
touches the network. Network writes need --demo-target plus an explicit URL. There is no implicit
production endpoint and no cleanup: resetting a demo database is an infrastructure step.
"""
import argparse
import json
import os
from pathlib import Path
import sys
import time

from . import manual, observations, publication, replay
from .assertions import assert_absent, await_hazards, compare_routes
from .clock import freeze, iso
from .geo import bbox_around
from .identity import run_namespace
from .models import ManifestError, RunManifest, Scenario, ScenarioError, check_point, load_scenario
from .transport import Run, ScenarioFailed, Transport

RUNS_DIR = Path(__file__).resolve().parents[2] / 'runs'


def parse_point(text: str) -> dict:
    try:
        lat, lon = (float(part) for part in text.split(','))
    except ValueError as error:
        raise argparse.ArgumentTypeError('expected LAT,LON') from error
    return check_point({'lat': lat, 'lon': lon}, 'point')


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog='simulator', description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(dest='command', required=True)

    def common(sub, default_scenario=None):
        sub.add_argument('--scenario', default=default_scenario, required=default_scenario is None, help='scenario name under simulator/scenarios, or a path')
        sub.add_argument('--seed', type=int, help='default 42; a resumed run keeps its own seed')
        sub.add_argument('--now', help='ISO time to freeze the run at (default: the current time, read once)')
        sub.add_argument('--demo-target', action='store_true', help='confirm that the given URLs are a demo environment and allow network writes')
        sub.add_argument('--dry-run', action='store_true', help='print payloads only (also the default without --demo-target)')
        sub.add_argument('--resume', type=Path, help='run manifest to continue with identical IDs and bodies')
        sub.add_argument('--out', type=Path, default=RUNS_DIR, help='directory for run manifests (ignored by git)')
        sub.add_argument('--timeout', type=float, default=10.0)

    sub = commands.add_parser('manual', help='create, read back, retry and conflict-probe one manual report')
    common(sub, 'manual-report')
    sub.add_argument('--product-url', default=os.getenv('PRODUCT_API_URL'))

    sub = commands.add_parser('publication', help='publish, retry, update, stale-probe and resolve one automatic hazard over HTTP')
    common(sub, 'publication-lifecycle')
    sub.add_argument('--product-url', default=os.getenv('PRODUCT_API_URL'))
    sub.add_argument('--stop-after', choices=publication.STOP_POINTS, default='resolve', help='stop early to leave the hazard visible for inspection')

    sub = commands.add_parser('observations', help='send synthetic brake/bump observations and wait for the published hazard')
    common(sub)
    sub.add_argument('--automation-url', default=os.getenv('AUTOMATION_API_URL'))
    sub.add_argument('--product-url', default=os.getenv('PRODUCT_API_URL'), help='if given, wait for the expected hazards on the public feed')
    sub.add_argument('--at', type=parse_point, metavar='LAT,LON', help='place the first cluster here instead of the scenario location')
    sub.add_argument('--wait', type=float, default=60.0, help='seconds to wait for publication (or to confirm a negative control stays empty)')

    sub = commands.add_parser('routes', help='request a route comparison and check its shape')
    common(sub, 'manual-report')
    sub.add_argument('--product-url', default=os.getenv('PRODUCT_API_URL'))
    sub.add_argument('--origin', type=parse_point, metavar='LAT,LON', default={'lat': 33.7531, 'lon': -84.3853})
    sub.add_argument('--destination', type=parse_point, metavar='LAT,LON', default={'lat': 33.7560, 'lon': -84.3880})

    sub = commands.add_parser('replay', help='run the detector over a trimmed recording and upload the result as replay evidence')
    sub.add_argument('--recording', type=Path, required=True)
    sub.add_argument('--events', type=Path, help='use this adapter output instead of running Node')
    sub.add_argument('--automation-url', default=os.getenv('AUTOMATION_API_URL'))
    for flag, kwargs in (('--seed', {'type': int}), ('--now', {}), ('--demo-target', {'action': 'store_true'}), ('--dry-run', {'action': 'store_true'}),
                         ('--resume', {'type': Path}), ('--out', {'type': Path, 'default': RUNS_DIR}), ('--timeout', {'type': float, 'default': 10.0})):
        sub.add_argument(flag, **kwargs)

    sub = commands.add_parser('trim', help='copy a raw recording without its first and last 100 m')
    sub.add_argument('--recording', type=Path, required=True)
    sub.add_argument('--out', type=Path, required=True)

    commands.add_parser('scenarios', help='list available scenarios')
    return parser


def start_run(args, scenario_name: str, digest: str, version: int, endpoints: dict) -> tuple[RunManifest, object]:
    """Fresh run: freeze the clock once and allocate a namespace. Resume: reuse both, verified."""
    endpoints = {key: value.rstrip('/') for key, value in endpoints.items() if value}
    if args.resume:
        manifest = RunManifest.load(args.resume)
        manifest.check_resume(scenario_name, digest, endpoints, args.seed)
        return manifest, freeze(manifest.now)
    now = freeze(args.now)
    seed = 42 if args.seed is None else args.seed
    run_id = str(run_namespace(scenario_name, seed, iso(now)))
    manifest = RunManifest(scenario=scenario_name, scenario_version=version, scenario_digest=digest, seed=seed, now=iso(now), run_id=run_id, endpoints=endpoints)
    return manifest, now


def live(args, endpoints: dict, needed: list[str]) -> bool:
    """True when this invocation may write to the network."""
    if args.dry_run or not args.demo_target:
        return False
    missing = [name for name in needed if not endpoints.get(name)]
    if missing:
        raise ScenarioFailed(f'--demo-target needs an explicit {" and ".join(m + " URL" for m in missing)}')
    return True


def print_plan(manifest: RunManifest, requests: list[dict]) -> None:
    print(json.dumps({'dry_run': True, 'scenario': manifest.scenario, 'seed': manifest.seed, 'now': manifest.now, 'run_id': manifest.run_id,
                      'requests': [{k: r[k] for k in ('key', 'method', 'target', 'path', 'expect', 'body') if k in r} | ({'auth': 'Bearer <AUTOMATION_PUBLISH_KEY>'} if r.get('auth') else {})
                                   for r in requests]}, indent=2))


def attach(manifest: RunManifest, args) -> RunManifest:
    if manifest.path is None:
        manifest.path = Path(args.out) / f'{manifest.scenario}-{manifest.seed}-{manifest.run_id[:8]}.json'
    manifest.save()
    return manifest


def finish(run: Run) -> int:
    failed = [e for e in run.manifest.evidence if not e['ok']]
    print(json.dumps({'result': 'FAIL' if failed else 'PASS', 'scenario': run.manifest.scenario, 'seed': run.manifest.seed, 'now': run.manifest.now,
                      'run_id': run.manifest.run_id, 'manifest': str(run.manifest.path), 'endpoints': run.manifest.endpoints}))
    return 1 if failed else 0


def expect_kind(scenario: Scenario, kind: str) -> None:
    if scenario.kind != kind:
        raise ScenarioError(f'scenario {scenario.name!r} is a {scenario.kind} scenario; this command needs a {kind} scenario')


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        return dispatch(args)
    except (ScenarioError, ManifestError, replay.RecordingError) as error:
        print(f'error: {error}', file=sys.stderr)
        return 2
    except ScenarioFailed as error:
        print(f'FAIL: {error}', file=sys.stderr)
        return 1


def dispatch(args) -> int:
    if args.command == 'scenarios':
        for path in sorted((Path(__file__).resolve().parents[2] / 'scenarios').glob('*.json')):
            scenario = load_scenario(str(path))
            print(f'{scenario.name:24} {scenario.kind:13} {scenario.get("description", "")}')
        return 0
    if args.command == 'trim':
        meta = replay.trim_recording(args.recording, args.out)
        print(json.dumps({'trimmed': str(args.out), **meta['trim']}))
        return 0
    if args.command == 'replay':
        return replay_command(args)

    scenario = load_scenario(args.scenario)
    transport = Transport(timeout=args.timeout)

    if args.command == 'manual':
        expect_kind(scenario, 'manual')
        endpoints = {'product': args.product_url}
        manifest, now = start_run(args, scenario.name, scenario.digest, scenario.version, endpoints)
        if not live(args, endpoints, ['product']):
            print_plan(manifest, manual.planned(manifest.run_id, scenario, now))
            return 0
        run = Run(attach(manifest, args), transport)
        manual.run_manual(run, scenario, now)
        return finish(run)

    if args.command == 'publication':
        expect_kind(scenario, 'publication')
        endpoints = {'product': args.product_url}
        manifest, now = start_run(args, scenario.name, scenario.digest, scenario.version, endpoints)
        if not live(args, endpoints, ['product']):
            print_plan(manifest, publication.planned(manifest.run_id, scenario, now))
            return 0
        run = Run(attach(manifest, args), transport, publish_key=os.environ.get('AUTOMATION_PUBLISH_KEY'))
        publication.run_publication_lifecycle(run, scenario, now, stop_after=args.stop_after)
        return finish(run)

    if args.command == 'routes':
        endpoints = {'product': args.product_url}
        manifest, _ = start_run(args, 'routes', '-', 1, endpoints)
        if not live(args, endpoints, ['product']):
            print_plan(manifest, [{'key': 'route', 'method': 'POST', 'target': 'product', 'path': '/v1/route', 'expect': [200, 503],
                                   'body': {'origin': args.origin, 'destination': args.destination}}])
            return 0
        run = Run(attach(manifest, args), transport)
        compare_routes(run, args.origin, args.destination)
        return finish(run)

    expect_kind(scenario, 'observations')
    endpoints = {'automation': args.automation_url, 'product': args.product_url}
    manifest, now = start_run(args, scenario.name, scenario.digest, scenario.version, endpoints)
    if not live(args, endpoints, ['automation']):
        print_plan(manifest, observations.planned(manifest.run_id, scenario, manifest.seed, now, args.at))
        return 0
    run = Run(attach(manifest, args), transport)
    observations.send_observations(run, scenario, manifest.seed, now, args.at)
    present, absent = observations.expectations(scenario, args.at)
    if not args.product_url:
        run.evidence('publication-not-checked', True, note='no --product-url given: ingestion-only evidence, no published hazard was verified')
        return finish(run)
    centers = [(e['near']['lat'], e['near']['lon']) for e in present + absent]
    bbox = bbox_around(centers) if centers else '-84.40,33.74,-84.37,33.77'
    if present:
        await_hazards(run, bbox, present, deadline_s=args.wait)
    if absent:
        if not present:
            # Negative control: give the worker the same time it would need to publish, then look.
            time.sleep(args.wait)
        assert_absent(run, bbox, absent)
    return finish(run)


def replay_command(args) -> int:
    recording = args.recording
    detected = json.loads(args.events.read_text()) if args.events else replay.detect(recording)
    endpoints = {'automation': args.automation_url}
    name = f'replay-{recording.name}'
    digest = json.dumps(replay.read_meta(recording), sort_keys=True)
    manifest, now = start_run(args, name, digest, 1, endpoints)
    requests = replay.planned(manifest.run_id, recording, detected, now)
    if not live(args, endpoints, ['automation']):
        print_plan(manifest, requests)
        return 0
    run = Run(attach(manifest, args), Transport(timeout=args.timeout))
    replay.send_replay(run, recording, detected, now)
    return finish(run)


if __name__ == '__main__':
    sys.exit(main())
