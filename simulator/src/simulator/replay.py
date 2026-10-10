"""Recorded-ride replay and the privacy trim that must happen before a recording is shared.

Recording directory (written by the collector's opt-in recorder, or synthesized):
  motion*.csv  t_ms,ax,ay,az,gx,gy,gz          epoch ms; m/s²; accel is gravity-removed
  gps*.csv     t_ms,lat,lon,speed_mps,accuracy_m  blank speed/accuracy = unknown, never zero
  labels*.csv  t_ms,type                        optional
  meta.json    includes "trimmed": true|false

The Node adapter in replay-detector/ runs Lane B's detector over the CSVs. This module uploads its
output with source "replay" and stable IDs, and refuses anything not marked trimmed.
"""
import csv
import hashlib
from datetime import datetime, timezone
import json
import subprocess
from pathlib import Path

from .clock import iso, rebase_offset_ms
from .geo import distance_m
from uuid import uuid5

from .identity import ROOT, item_id
from .observations import MAX_EVENTS_PER_BATCH, MAX_POINTS_PER_BATCH, chunk
from .transport import Run, ScenarioFailed

ADAPTER = Path(__file__).resolve().parents[2] / 'replay-detector' / 'replay.mjs'
TRIM_M = 100.0
MAX_ACCURACY_M = 20.0
HEADERS = {'motion': 't_ms,ax,ay,az,gx,gy,gz', 'gps': 't_ms,lat,lon,speed_mps,accuracy_m', 'labels': 't_ms,type'}


class RecordingError(ValueError):
    """The recording is malformed, untrimmed, or too short to keep anything."""


def read_rows(directory: Path, kind: str) -> list[dict]:
    """All rows of every `<kind>*.csv` part, sorted by time. Blank cells stay None."""
    rows = []
    for part in sorted(Path(directory).glob(f'{kind}*.csv')):
        with part.open(newline='') as handle:
            reader = csv.DictReader(handle)
            if ','.join(reader.fieldnames or []) != HEADERS[kind]:
                raise RecordingError(f'{part.name} header must be {HEADERS[kind]!r}')
            for row in reader:
                parsed = {'t_ms': int(float(row['t_ms']))}
                for key, value in row.items():
                    if key == 't_ms':
                        continue
                    parsed[key] = (value if key == 'type' else float(value)) if value not in ('', None) else None
                rows.append(parsed)
    return sorted(rows, key=lambda r: r['t_ms'])


def read_meta(directory: Path) -> dict:
    path = Path(directory) / 'meta.json'
    if not path.is_file():
        raise RecordingError(f'{directory} has no meta.json')
    return json.loads(path.read_text())


def trim_window(gps: list[dict], trim_m: float = TRIM_M) -> tuple[int, int]:
    """Timestamps (start, end) between which a ride is more than `trim_m` (straight-line) from both ends.

    Only fixes with known accuracy of 20 m or better are used.
    """
    good = [g for g in gps if g.get('accuracy_m') is not None and g['accuracy_m'] <= MAX_ACCURACY_M]
    if len(good) < 2:
        raise RecordingError('not enough accurate GPS fixes to measure the ride')
    # Displacement from the first and last accurate fix, not accumulated path length: GPS jitter while
    # standing still adds path length but never moves the rider away from home.
    origin, final = good[0], good[-1]
    total = max(distance_m(origin['lat'], origin['lon'], g['lat'], g['lon']) for g in good)
    if total <= 2 * trim_m:
        raise RecordingError(f'ride only strays {total:.0f} m from its start; after removing the first and last {trim_m:.0f} m nothing is left')
    start = next(g['t_ms'] for g in good if distance_m(origin['lat'], origin['lon'], g['lat'], g['lon']) > trim_m)
    end = next(g['t_ms'] for g in reversed(good) if distance_m(final['lat'], final['lon'], g['lat'], g['lon']) > trim_m)
    if start >= end:
        raise RecordingError('ride has no interior after trimming')
    return start, end


def trim_recording(source: Path, destination: Path, trim_m: float = TRIM_M) -> dict:
    """Write a copy without the first and last 100 m. Refuses to trim an already-trimmed recording."""
    source, destination = Path(source), Path(destination)
    meta = read_meta(source)
    if meta.get('trimmed'):
        raise RecordingError('recording is already marked trimmed; trimming twice would remove more than intended')
    if destination.exists() and any(destination.iterdir()):
        raise RecordingError(f'{destination} is not empty')
    start, end = trim_window(read_rows(source, 'gps'), trim_m)
    destination.mkdir(parents=True, exist_ok=True)
    counts = {}
    for kind, header in HEADERS.items():
        rows = [r for r in read_rows(source, kind) if start <= r['t_ms'] <= end]
        counts[kind] = len(rows)
        if not rows and kind == 'labels':
            continue
        with (destination / f'{kind}.csv').open('w', newline='') as handle:
            handle.write(header + '\n')
            for row in rows:
                handle.write(','.join(_cell(k, row[k]) for k in header.split(',')) + '\n')
    # Allowlist: the raw meta carries the ride ID and start time, which must not travel with a shareable copy.
    kept = {k: meta[k] for k in ('format', 'source', 'motion', 'gps', 'labels') if k in meta}
    trimmed = {**kept, 'trimmed': True, 'trim': {'removed_m_each_end': trim_m, 'kept_from_t_ms': start, 'kept_to_t_ms': end, 'rows': counts},
               'note': 'First and last 100 m removed. Review before sharing; do not trim again.'}
    (destination / 'meta.json').write_text(json.dumps(trimmed, indent=2) + '\n')
    return trimmed


def _cell(key: str, value) -> str:
    if value is None:
        return ''
    if key == 'type':
        return str(value)
    if key == 't_ms':
        return str(int(value))
    return f'{float(value):.7f}'.rstrip('0').rstrip('.') or '0'


def detect(recording: Path, node: str = 'node') -> dict:
    """Run the Node adapter over a recording. Returns {'events': [...], 'detector': {...}}."""
    try:
        result = subprocess.run([node, str(ADAPTER), str(recording)], check=True, capture_output=True, text=True, timeout=600)
    except FileNotFoundError as error:
        raise RecordingError('Node.js is required to run the detector adapter') from error
    except subprocess.CalledProcessError as error:
        raise RecordingError(f'detector adapter failed: {error.stderr.strip()[-400:]}') from error
    return json.loads(result.stdout)


def rebase_recording(events: list[dict], gps: list[dict], run_time) -> tuple[list[dict], list[dict], int]:
    """Shift every timestamp by one offset so the latest sample is at the run time."""
    latest = max([e['t_ms'] for e in events] + [g['t_ms'] for g in gps])
    shift = rebase_offset_ms(latest, run_time)
    return ([{**e, 't_ms': e['t_ms'] + shift} for e in events], [{**g, 't_ms': g['t_ms'] + shift} for g in gps], shift)


def _stamp(t_ms: int) -> str:
    return iso(datetime.fromtimestamp(t_ms / 1000, tz=timezone.utc))


def recording_identity(recording: Path) -> str:
    digest = hashlib.sha256()
    for kind in ('gps', 'motion', 'labels'):
        path = Path(recording) / f'{kind}.csv'
        digest.update(path.read_bytes() if path.exists() else b'')
    return str(uuid5(ROOT, f'replay|{digest.hexdigest()}'))


def planned(run_id: str, recording: Path, detected: dict, run_time) -> list[dict]:
    """Upload requests for a trimmed recording: derived events and GPS points, source `replay`."""
    recording = Path(recording)
    meta = read_meta(recording)
    if not meta.get('trimmed'):
        raise RecordingError('recording is not marked trimmed; run `simulator.cli trim` and review it before any upload')
    gps = read_rows(recording, 'gps')
    # IDs come from the recording's content, not the run: replaying the same ride again is the same ride.
    recording_id = recording_identity(recording)
    events, gps, _ = rebase_recording(detected['events'], gps, run_time)
    name = f'replay/{recording.name}'
    ride = item_id(recording_id, name, 'ride')
    bodies = [{
        'id': item_id(recording_id, name, f'event/{index}'), 'ride_id': ride, 'type': e['type'], 'ts': _stamp(e['t_ms']),
        'lat': e['lat'], 'lon': e['lon'], 'accuracy_m': e['accuracy_m'], 'speed_before_mps': e['speed_before_mps'],
        'speed_after_mps': e['speed_after_mps'], 'peak_g': e['peak_g'], 'duration_ms': e['duration_ms'], 'source': 'replay',
    } for index, e in enumerate(events)]
    # A point needs measured speed and accuracy; unknown values are never sent as zero.
    points = [{
        'id': item_id(recording_id, name, f'point/{index}'), 'ts': _stamp(g['t_ms']), 'lat': g['lat'], 'lon': g['lon'],
        'speed_mps': g['speed_mps'], 'accuracy_m': g['accuracy_m'], 'source': 'replay',
    } for index, g in enumerate(gps) if g.get('speed_mps') is not None and g.get('accuracy_m') is not None and g['speed_mps'] >= 0]
    requests = [{'key': f'events-{i}', 'method': 'POST', 'target': 'automation', 'path': '/v1/events', 'body': {'events': part}, 'expect': [200]}
                for i, part in enumerate(chunk(bodies, MAX_EVENTS_PER_BATCH))]
    requests += [{'key': f'points-{i}', 'method': 'POST', 'target': 'automation', 'path': f'/v1/rides/{ride}/points', 'body': {'points': part}, 'expect': [200]}
                 for i, part in enumerate(chunk(points, MAX_POINTS_PER_BATCH))]
    return requests


def send_replay(run: Run, recording: Path, detected: dict, run_time) -> dict:
    accepted = duplicates = 0
    requests = planned(run.manifest.run_id, recording, detected, run_time)
    if not requests:
        run.evidence('replayed', False, note='nothing to upload: no detected events and no GPS point with measured speed and accuracy')
        raise ScenarioFailed('replay produced nothing to upload')
    for request in requests:
        try:
            receipt = run.send(request['key'], 'POST', 'automation', request['path'], request['body'], expect=(200,), step='ingest-replay').body or {}
        except ScenarioFailed as error:
            if ' 409' in str(error) or 'received 409' in str(error):
                raise ScenarioFailed(f'{error}. This recording was already replayed with a different clock; its IDs are stable, so repeat it with the same --now, or resume that run.') from error
            raise
        accepted += receipt.get('accepted', 0)
        duplicates += receipt.get('duplicates', 0)
    run.evidence('replayed', True, events=len(detected['events']), accepted=accepted, duplicates=duplicates,
                 note='replay evidence accepted by the observation API; detector accuracy still needs labeled rides')
    return {'accepted': accepted, 'duplicates': duplicates}
