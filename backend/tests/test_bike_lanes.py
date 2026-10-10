import importlib.util
import json
from pathlib import Path

import pytest

DIR = Path(__file__).resolve().parents[1] / 'bike_lanes'
spec = importlib.util.spec_from_file_location('import_osm', DIR/'import_osm.py')
import_osm = importlib.util.module_from_spec(spec)
spec.loader.exec_module(import_osm)
classify = import_osm.classify

def sides(tags):
    result = classify({'highway': 'secondary', **tags})
    return result['bike_lane'], (result['left']['status'], result['left']['facility']), (result['right']['status'], result['right']['facility'])

def test_missing_tags_are_unknown_not_absent():
    assert sides({}) == ('unknown', ('unknown', None), ('unknown', None))
    assert sides({'cycleway:right': 'no'}) == ('unknown', ('unknown', None), ('absent', 'none'))

@pytest.mark.parametrize('tags, expected', [
    ({'cycleway': 'no'}, ('absent', ('absent', 'none'), ('absent', 'none'))),
    ({'cycleway:both': 'lane'}, ('present', ('present', 'lane'), ('present', 'lane'))),
    ({'cycleway:both': 'lane', 'cycleway:left': 'shared_lane'}, ('present', ('absent', 'shared_lane'), ('present', 'lane'))),
    ({'cycleway:left': 'separate', 'cycleway:right': 'no'}, ('present', ('present', 'separate'), ('absent', 'none'))),
    ({'cycleway': 'opposite_lane'}, ('present', ('present', 'lane'), ('unknown', None))),
    ({'cycleway': 'shared_lane'}, ('absent', ('absent', 'shared_lane'), ('absent', 'shared_lane'))),
    ({'cycleway': 'both'}, ('unknown', ('unknown', 'both'), ('unknown', 'both'))),
])
def test_side_evidence_rules(tags, expected):
    assert sides(tags) == expected

def test_paths_keep_facility_type():
    assert classify({'highway': 'cycleway'})['bike_lane'] == 'present'
    shared = classify({'highway': 'footway', 'bicycle': 'designated'})
    assert (shared['bike_lane'], shared['facility']) == ('absent', 'shared_path')

def test_sample_fixture_is_consumable():
    data = json.loads((DIR/'sample.geojson').read_text())
    boxes = data['metadata']['campuses']
    assert data['metadata']['attribution'] == '© OpenStreetMap contributors'
    assert {f['properties']['bike_lane'] for f in data['features']} == {'present', 'absent', 'unknown'}
    for feature in data['features']:
        west, south, east, north = boxes[feature['properties']['campus']]
        lon, lat = feature['geometry']['coordinates'][0]
        # GeoJSON is [lon, lat]; ways may extend past the box they intersect.
        assert west - 0.01 < lon < east + 0.01 and south - 0.01 < lat < north + 0.01
