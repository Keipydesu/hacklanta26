"""Validate checked-in OpenAPI and every fixture; no live services required."""
from pathlib import Path
import json
import yaml
from jsonschema import Draft202012Validator, FormatChecker
from openapi_spec_validator import validate

ROOT = Path(__file__).resolve().parents[1]
specs = {}
for name in ('openapi.yaml', 'automatic.openapi.yaml'):
    spec = yaml.safe_load((ROOT / name).read_text())
    validate(spec)
    specs[name] = spec

def validator(name, schema):
    spec = specs[name]
    return Draft202012Validator({'$ref': f'#/components/schemas/{schema}', 'components': spec['components']}, format_checker=FormatChecker())

count = 0
for path in sorted((ROOT / 'fixtures').rglob('*')):
    if path.suffix not in ('.json', '.geojson'):
        continue
    data = json.loads(path.read_text())
    stem = path.stem
    schema = ('HazardCollection' if stem == 'hazards' else 'RouteRequest' if stem == 'route-request' else 'RouteResponse' if stem == 'route' else 'EventBatch' if stem.startswith('events') else 'PointBatch' if stem.startswith('points') else 'AutomaticPublication' if stem.startswith('automatic') else 'ManualReport')
    spec = 'automatic.openapi.yaml' if schema in ('EventBatch', 'PointBatch') else 'openapi.yaml'
    errors = list(validator(spec, schema).iter_errors(data))
    if 'invalid' in stem:
        assert errors, f'{path}: expected schema rejection'
    else:
        assert not errors, f'{path}: {errors}'
    count += 1
print(f'PASS: 2 OpenAPI specs and {count} fixtures (including expected invalid cases).')
