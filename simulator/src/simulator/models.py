"""Scenario and run-manifest validation. Everything is checked before any network write."""
from dataclasses import dataclass, field
import hashlib
import json
import math
from pathlib import Path

SCENARIO_DIR = Path(__file__).resolve().parents[2] / 'scenarios'
KINDS = {'manual', 'publication', 'observations'}
REPORT_KINDS = {'pothole', 'obstruction', 'closure', 'other'}
EVENT_TYPES = {'hard_brake', 'bump'}
EVIDENCE = {'simulated', 'replay'}
HAZARD_KINDS = {'braking', 'surface', 'abandoned', *REPORT_KINDS}
MANIFEST_VERSION = 1


class ScenarioError(ValueError):
    """The scenario file is missing something or contradicts itself."""


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise ScenarioError(message)


def check_point(value, where: str) -> dict:
    _require(isinstance(value, dict), f'{where} must be an object with lat and lon')
    lat, lon = value.get('lat'), value.get('lon')
    _require(isinstance(lat, (int, float)) and isinstance(lon, (int, float)), f'{where} needs numeric lat and lon')
    _require(math.isfinite(lat) and math.isfinite(lon) and abs(lat) <= 90 and abs(lon) <= 180, f'{where} is outside WGS84 bounds')
    return {'lat': float(lat), 'lon': float(lon)}


@dataclass(frozen=True)
class Scenario:
    name: str
    kind: str
    version: int
    data: dict
    digest: str = field(compare=False)

    def get(self, key, default=None):
        return self.data.get(key, default)


def scenario_digest(data: dict) -> str:
    return hashlib.sha256(json.dumps(data, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def validate_scenario(data: dict) -> Scenario:
    _require(isinstance(data, dict), 'scenario must be a JSON object')
    name, kind = data.get('name'), data.get('kind')
    _require(isinstance(name, str) and name, 'scenario needs a name')
    _require(kind in KINDS, f'scenario kind must be one of {sorted(KINDS)}')
    _require(isinstance(data.get('version'), int) and data['version'] >= 1, 'scenario needs an integer version >= 1')
    if kind == 'manual':
        report = data.get('report')
        _require(isinstance(report, dict), 'manual scenario needs a report')
        check_point(report, 'report')
        _require(report.get('kind') in REPORT_KINDS, f'report.kind must be one of {sorted(REPORT_KINDS)}')
        description = report.get('description', '')
        _require(isinstance(description, str) and len(description) <= 280, 'report.description is limited to 280 characters')
        _require('DEMO' in description, 'report.description must say DEMO so demo data is recognisable on the map')
        age = report.get('age_minutes', 0)
        _require(isinstance(age, (int, float)) and age >= 0, 'report.age_minutes must be >= 0')
        _require(isinstance(data.get('expect_active', True), bool), 'expect_active must be true or false')
        _require(bool(data.get('expect_active', True)) == (age < 24 * 60), 'expect_active contradicts report.age_minutes (reports expire after 24 hours)')
    elif kind == 'publication':
        hazard = data.get('hazard')
        _require(isinstance(hazard, dict), 'publication scenario needs a hazard')
        check_point(hazard, 'hazard')
        _require(hazard.get('kind') in {'braking', 'surface', 'abandoned'}, 'hazard.kind must be braking, surface or abandoned')
        _require(hazard.get('evidence_source') in EVIDENCE, 'simulator publications must be labeled simulated or replay')
        _require('DEMO' in str(hazard.get('label', '')), 'hazard.label must say DEMO')
        for key in ('score', 'updated_score'):
            _require(isinstance(hazard.get(key), (int, float)) and 0 <= hazard[key] <= 1, f'hazard.{key} must be between 0 and 1')
        _require(hazard['score'] != hazard['updated_score'], 'updated_score must differ so revision 2 is a real change')
        check_point(data.get('control_report', {}), 'control_report')
    else:
        _require(data.get('evidence_source') in EVIDENCE, 'observations must be labeled simulated or replay')
        clusters = data.get('clusters')
        _require(isinstance(clusters, list) and clusters, 'observation scenario needs at least one cluster')
        keys = set()
        for cluster in clusters:
            key = cluster.get('key')
            _require(isinstance(key, str) and key and key not in keys, 'each cluster needs a unique key')
            keys.add(key)
            check_point(cluster.get('center', {}), f'cluster {key} center')
            _require(cluster.get('type') in EVENT_TYPES, f'cluster {key} type must be hard_brake or bump')
            events, rides = cluster.get('events'), cluster.get('rides')
            _require(isinstance(events, int) and isinstance(rides, int) and 1 <= rides <= events <= 500, f'cluster {key} needs 1 <= rides <= events <= 500')
            _require(isinstance(cluster.get('radius_m', 4), (int, float)) and 0 <= cluster.get('radius_m', 4) <= 6,
                     f'cluster {key} radius_m must be 0-6 so every event stays within the 12 m clustering distance')
            low, high = cluster.get('age_minutes', [0, 30])
            _require(0 <= low <= high, f'cluster {key} age_minutes must be [low, high] with 0 <= low <= high')
        points = data.get('points_per_ride', 0)
        _require(isinstance(points, int) and 0 <= points <= 2000, 'points_per_ride must be 0-2000')
    for entry in data.get('expect', {}).get('hazards', []) + data.get('expect', {}).get('absent', []):
        check_point(entry.get('near', {}), 'expectation near')
        _require(entry.get('kind') in HAZARD_KINDS, f'expectation kind {entry.get("kind")!r} is not a hazard kind')
        _require(isinstance(entry.get('within_m', 30), (int, float)) and entry.get('within_m', 30) > 0, 'expectation within_m must be > 0')
    return Scenario(name=name, kind=kind, version=data['version'], data=data, digest=scenario_digest(data))


def load_scenario(name_or_path: str) -> Scenario:
    path = Path(name_or_path)
    if not path.suffix:
        path = SCENARIO_DIR / f'{name_or_path}.json'
    if not path.is_file():
        available = ', '.join(sorted(p.stem for p in SCENARIO_DIR.glob('*.json')))
        raise ScenarioError(f'no scenario at {path}. Available: {available}')
    try:
        data = json.loads(path.read_text())
    except json.JSONDecodeError as error:
        raise ScenarioError(f'{path} is not valid JSON: {error}') from error
    return validate_scenario(data)


class ManifestError(ValueError):
    """A run manifest cannot be resumed as requested."""


@dataclass
class RunManifest:
    """Everything needed to repeat a run byte for byte. Never contains credentials."""
    scenario: str
    scenario_version: int
    scenario_digest: str
    seed: int
    now: str
    run_id: str
    endpoints: dict
    requests: list = field(default_factory=list)
    evidence: list = field(default_factory=list)
    next_revision: int = 1
    version: int = MANIFEST_VERSION
    path: Path | None = field(default=None, compare=False, repr=False)

    def to_json(self) -> str:
        # Key order is kept as generated: a resumed request must serialize to the same bytes.
        body = {k: v for k, v in self.__dict__.items() if k != 'path'}
        return json.dumps(body, indent=2) + '\n'

    def save(self) -> None:
        if self.path is None:
            return
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_suffix('.tmp')
        temporary.write_text(self.to_json())
        temporary.replace(self.path)

    @classmethod
    def load(cls, path: Path) -> 'RunManifest':
        try:
            data = json.loads(Path(path).read_text())
        except (OSError, json.JSONDecodeError) as error:
            raise ManifestError(f'cannot read run manifest {path}: {error}') from error
        if data.get('version') != MANIFEST_VERSION:
            raise ManifestError(f'run manifest version {data.get("version")!r} is not supported')
        manifest = cls(**data)
        manifest.path = Path(path)
        return manifest

    def check_resume(self, scenario: str, digest: str, endpoints: dict, seed: int | None = None) -> None:
        """Old IDs must never be paired with a different scenario, seed, endpoint or body."""
        if scenario != self.scenario or digest != self.scenario_digest:
            raise ManifestError(f'scenario {scenario!r} changed since this run started; start a fresh run instead of resuming')
        if seed is not None and seed != self.seed:
            raise ManifestError(f'--seed {seed} differs from the resumed run ({self.seed})')
        for key, value in endpoints.items():
            if value and self.endpoints.get(key) != value:
                raise ManifestError(f'{key} URL is {value!r} but this run was started against {self.endpoints.get(key)!r}')
