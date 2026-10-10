import importlib.util
import io
import json
import sys
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

@pytest.mark.parametrize('oneway', ['yes', '1', 'true', '-1'])
@pytest.mark.parametrize('facility', ['lane', 'track'])
def test_generic_oneway_facility_does_not_invent_sides(oneway, facility):
    assert sides({'oneway': oneway, 'cycleway': facility}) == (
        'present', ('unknown', None), ('unknown', None))

def test_oneway_explicit_side_evidence_wins():
    generic = {'oneway': 'yes', 'cycleway': 'lane'}
    assert sides({**generic, 'cycleway:right': 'lane'}) == (
        'present', ('unknown', None), ('present', 'lane'))
    assert sides({**generic, 'cycleway:both': 'no'}) == (
        'absent', ('absent', 'none'), ('absent', 'none'))
    assert sides({**generic, 'cycleway:left': 'no', 'cycleway:right': 'no'}) == (
        'absent', ('absent', 'none'), ('absent', 'none'))
    assert sides({'oneway': 'no', 'cycleway': 'lane'}) == (
        'present', ('present', 'lane'), ('present', 'lane'))

@pytest.mark.parametrize('partial', [False, True])
def test_refresh_error_preserves_both_existing_files(monkeypatch, tmp_path, partial):
    way = {'type': 'way', 'id': 1, 'version': 1, 'timestamp': '2026-10-10T00:00:00Z',
           'tags': {'highway': 'residential'},
           'geometry': [{'lon': -84.39, 'lat': 33.77}, {'lon': -84.38, 'lat': 33.78}]}
    success = {'osm3s': {'timestamp_osm_base': '2026-10-10T00:00:00Z'}, 'elements': [way]}
    failure = {**success, 'elements': [way] if partial else [],
               'remark': 'runtime error: Query timed out'}
    responses = iter([success, failure])  # First campus succeeds; second must abort the entire refresh.
    monkeypatch.setattr(import_osm.urllib.request, 'urlopen',
                        lambda *a, **kw: io.BytesIO(json.dumps(next(responses)).encode()))
    monkeypatch.setattr(import_osm, 'HERE', tmp_path)
    monkeypatch.setattr(sys, 'argv', ['import_osm.py'])
    for name in ('campus-bike-lanes.geojson', 'sample.geojson'):
        (tmp_path/name).write_bytes(b'previous complete dataset')
    with pytest.raises(RuntimeError, match='Query timed out'):
        import_osm.main()
    for name in ('campus-bike-lanes.geojson', 'sample.geojson'):
        assert (tmp_path/name).read_bytes() == b'previous complete dataset'

def test_fetch_accepts_complete_response(monkeypatch):
    result = {'osm3s': {'timestamp_osm_base': '2026-10-10T00:00:00Z'}, 'elements': []}
    monkeypatch.setattr(import_osm.urllib.request, 'urlopen',
                        lambda *a, **kw: io.BytesIO(json.dumps(result).encode()))
    assert import_osm.fetch('query') == result

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
