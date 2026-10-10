"""Export campus street segments with bike-lane status from OpenStreetMap (Overpass API).

Standard library only. From the repository root:

    python3 backend/bike_lanes/import_osm.py [--date <ISO 8601 UTC timestamp>]

`--date` pins the query to an OSM snapshot time, e.g. the timestamp of the extract Valhalla
and the basemap were built from. Writes campus-bike-lanes.geojson and sample.geojson here.
Evidence rules are in README.md; missing tags are always `unknown`, never `absent`.
"""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import time
import urllib.error
import urllib.parse
import urllib.request

HERE = Path(__file__).resolve().parent
ENDPOINT = 'https://overpass-api.de/api/interpreter'
USER_AGENT = 'hacklanta26-bike-lanes/1 (https://github.com/Keipydesu/hacklanta26)'

# minLon,minLat,maxLon,maxLat: OSM campus outline bounds plus ~150 m for adjacent streets.
# Georgia Tech: relation 3341535. GSU downtown: ways 586614408 and 1110422299.
CAMPUSES = {
    'gatech': (-84.4090, 33.7670, -84.3842, 33.7850),
    'gsu': (-84.3923, 33.7485, -84.3787, 33.7610),
}

ROADS = ('trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link'
         '|unclassified|residential|living_street')

# Value of cycleway / cycleway:both / cycleway:left / cycleway:right -> (status, facility).
SIDE_VALUES = {
    'lane': ('present', 'lane'),
    'opposite_lane': ('present', 'lane'),
    'track': ('present', 'track'),
    'opposite_track': ('present', 'track'),
    'separate': ('present', 'separate'),
    'shared_lane': ('absent', 'shared_lane'),
    'share_busway': ('absent', 'share_busway'),
    'opposite_share_busway': ('absent', 'share_busway'),
    'shoulder': ('absent', 'shoulder'),
    'no': ('absent', 'none'),
    'none': ('absent', 'none'),
    'opposite': ('absent', 'none'),
}
UNKNOWN = ('unknown', None)


def unsided_oneway_facility(tags):
    """A bare lane/track on a one-way road proves presence, but not which side."""
    return (tags.get('oneway') in ('yes', '1', 'true', '-1')
            and tags.get('cycleway') in ('lane', 'track'))


def side(tags, name):
    """Most specific tag wins: cycleway:<side>, then cycleway:both, then cycleway."""
    for key in (f'cycleway:{name}', 'cycleway:both', 'cycleway'):
        if key in tags:
            value = tags[key]
            if key == 'cycleway' and unsided_oneway_facility(tags):
                return UNKNOWN
            # opposite_* values describe the contraflow (left) side of a one-way street only.
            if key == 'cycleway' and value.startswith('opposite') and name == 'right':
                return UNKNOWN
            return SIDE_VALUES.get(value, ('unknown', value))
    return UNKNOWN


def classify(tags):
    """Return bike-lane properties for one OSM way's tags."""
    highway = tags.get('highway')
    if highway == 'cycleway':
        return {'bike_lane': 'present', 'facility': 'cycleway', 'left': None, 'right': None}
    if highway in ('path', 'footway', 'pedestrian'):
        # A shared-use path is bicycle infrastructure but not a dedicated bike lane.
        return {'bike_lane': 'absent', 'facility': 'shared_path', 'left': None, 'right': None}
    left, right = side(tags, 'left'), side(tags, 'right')
    statuses = {left[0], right[0]}
    overall = 'present' if 'present' in statuses else 'absent' if statuses == {'absent'} else 'unknown'
    # Preserve road-level evidence only when a side actually falls back to the generic tag.
    # Explicit side/both tags still take precedence over conflicting generic evidence.
    if (unsided_oneway_facility(tags) and 'cycleway:both' not in tags
            and any(f'cycleway:{name}' not in tags for name in ('left', 'right'))):
        overall = 'present'
    return {
        'bike_lane': overall,
        'facility': None,
        'left': {'status': left[0], 'facility': left[1], 'oneway': tags.get('cycleway:left:oneway')},
        'right': {'status': right[0], 'facility': right[1], 'oneway': tags.get('cycleway:right:oneway')},
    }


def query(bbox, date):
    west, south, east, north = bbox
    area = f'{south},{west},{north},{east}'
    settings = f'[out:json][timeout:120]' + (f'[date:"{date}"]' if date else '')
    return f'''{settings};
(
  way["highway"~"^({ROADS})$"]({area});
  way["highway"="cycleway"]({area});
  way["highway"~"^(path|footway|pedestrian)$"]["bicycle"~"^(designated|yes)$"]({area});
);
out meta geom qt;'''


def fetch(text, attempts=4):
    body = urllib.parse.urlencode({'data': text}).encode()
    request = urllib.request.Request(ENDPOINT, body, {'User-Agent': USER_AGENT})
    for attempt in range(attempts):
        try:
            with urllib.request.urlopen(request, timeout=180) as response:
                result = json.load(response)
                # Overpass can return HTTP 200 with partial/empty elements after a runtime error.
                # Fail before main writes either dataset; never publish partial coverage as complete.
                if result.get('remark'):
                    raise RuntimeError(f"Overpass returned an incomplete result: {result['remark']}")
                return result
        except urllib.error.HTTPError as error:
            # The public server often answers 429/504 under load; back off and retry.
            if error.code not in (429, 502, 503, 504) or attempt == attempts - 1:
                raise
            time.sleep(30 * (attempt + 1))


def feature(campus, way):
    tags = way['tags']
    return {
        'type': 'Feature',
        'geometry': {'type': 'LineString',
                     'coordinates': [[round(p['lon'], 7), round(p['lat'], 7)] for p in way['geometry']]},
        'properties': {
            'source_id': f"osm:way/{way['id']}", 'source_version': way['version'],
            'source_updated': way['timestamp'], 'campus': campus,
            'name': tags.get('name'), 'highway': tags['highway'], 'oneway': tags.get('oneway'),
            **classify(tags),
        },
    }


def sample(features):
    """First segment (by OSM id) for each campus/status/facility combination."""
    picked = {}
    for item in sorted(features, key=lambda f: int(f['properties']['source_id'].split('/')[1])):
        p = item['properties']
        facilities = (p['facility'],) if p['left'] is None else (p['left']['facility'], p['right']['facility'])
        picked.setdefault((p['campus'], p['bike_lane'], facilities), item)
    return list(picked.values())


def dump(features, metadata):
    """GeoJSON with one feature per line, so refreshes produce readable diffs."""
    lines = ',\n'.join(json.dumps(item, ensure_ascii=False, separators=(',', ':')) for item in features)
    head = json.dumps(metadata, ensure_ascii=False)
    return f'{{"type":"FeatureCollection","metadata":{head},"features":[\n{lines}\n]}}\n'


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--date', help='OSM snapshot time (ISO 8601 UTC); default is current data')
    args = parser.parse_args()
    features, snapshot = [], None
    for campus, bbox in CAMPUSES.items():
        result = fetch(query(bbox, args.date))
        snapshot = result['osm3s']['timestamp_osm_base']
        features += [feature(campus, way) for way in result['elements'] if way['type'] == 'way']
    metadata = {
        'source': 'OpenStreetMap via Overpass API', 'license': 'ODbL-1.0',
        'attribution': '© OpenStreetMap contributors',
        'osm_snapshot': args.date or snapshot,
        'retrieved_at': datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        'campuses': {name: list(bbox) for name, bbox in CAMPUSES.items()},
    }
    for name, items in (('campus-bike-lanes.geojson', features), ('sample.geojson', sample(features))):
        (HERE/name).write_text(dump(items, metadata))
        print(f'{name}: {len(items)} segments')


if __name__ == '__main__':
    main()
