"""Compare canonical request schemas with Pydantic schemas, ignoring presentation metadata."""
from copy import deepcopy

def normalize(schema, root):
    if isinstance(schema, list): return [normalize(x,root) for x in schema]
    if not isinstance(schema, dict): return schema
    if '$ref' in schema:
        resolved = root
        for part in schema['$ref'].removeprefix('#/').split('/'):
            resolved = resolved[part]
        return normalize(resolved,root)
    result = {k:normalize(v,root) for k,v in schema.items() if k not in ('title','description','default','$defs','examples')}
    if 'required' in result: result['required'] = sorted(result['required'])
    # Pydantic's fixed-size tuples imply no extra positions via maxItems.
    if result.get('items') is False and result.get('maxItems') == len(result.get('prefixItems',[])):
        result.pop('items')
    return result

def assert_request_parity(spec, models):
    for name, model in models.items():
        actual = model.model_json_schema()
        expected = spec['components']['schemas'][name]
        assert normalize(actual,actual) == normalize(expected,spec), f'{name} drifted from canonical OpenAPI'
