"""Address and place search for trip endpoints, proxied to Photon (OSM-based, no key).

The app only talks to this API, so rider IPs and queries are not sent to the provider directly and the
provider can be swapped. Results are limited to the metro-Atlanta area that Valhalla routes over.
Decision 018 records the provider choice, limits and privacy notes.
"""
from collections import OrderedDict
from dataclasses import dataclass
import time

import httpx

METRO_BBOX = (-84.55, 33.60, -84.20, 33.95)
MAX_RESULTS = 5
CACHE_TTL_S = 600
CACHE_SIZE = 256
USER_AGENT = 'campus-hazards-product-api (hackathon demo)'

class PlacesUnavailable(Exception):
    """Provider outage, timeout or malformed response."""

@dataclass(frozen=True)
class Place:
    id: str
    name: str
    address: str
    lat: float
    lon: float

def _inside(lon, lat):
    west, south, east, north = METRO_BBOX
    return west <= lon <= east and south <= lat <= north

def parse_photon(payload) -> list[Place]:
    """Readable, deduplicated places inside the metro area, best match first."""
    try:
        features = payload['features']
    except (TypeError, KeyError) as error:
        raise PlacesUnavailable('Malformed place search response') from error
    places, seen = [], set()
    for feature in features if isinstance(features, list) else []:
        try:
            props = feature.get('properties') or {}
            lon, lat = (float(v) for v in feature['geometry']['coordinates'][:2])
        except (AttributeError, KeyError, TypeError, ValueError):
            continue
        if not _inside(lon, lat):
            continue
        street = ' '.join(str(p) for p in (props.get('housenumber'), props.get('street')) if p)
        name = str(props.get('name') or street).strip()
        if not name:
            continue
        address = ', '.join(str(p) for p in (street if street != name else None, props.get('city'), props.get('state')) if p)
        key = (name.casefold(), address.casefold())
        if key in seen:
            continue
        seen.add(key)
        osm = f"{props.get('osm_type', '')}{props.get('osm_id', '')}" or f'{lat:.6f},{lon:.6f}'
        places.append(Place(osm[:64], name[:120], address[:200], lat, lon))
        if len(places) == MAX_RESULTS:
            break
    return places

class PlaceSearch:
    def __init__(self, base_url, http: httpx.AsyncClient | None = None, clock=time.monotonic):
        self.base_url = base_url.rstrip('/')
        self.http = http or httpx.AsyncClient(timeout=httpx.Timeout(4, connect=2), headers={'User-Agent': USER_AGENT})
        self.clock = clock
        self.cache: OrderedDict = OrderedDict()

    async def close(self):
        await self.http.aclose()

    async def search(self, query: str, near: tuple[float, float] | None = None) -> list[Place]:
        """`near` is (lat, lon) used only to rank results; it is rounded for caching."""
        rounded = (round(near[0], 3), round(near[1], 3)) if near else None
        key = (query.casefold(), rounded)
        cached = self.cache.get(key)
        if cached and cached[0] > self.clock():
            self.cache.move_to_end(key)
            return cached[1]
        params = {'q': query, 'limit': 10, 'lang': 'en', 'bbox': ','.join(str(v) for v in METRO_BBOX)}
        if rounded:
            params.update(lat=rounded[0], lon=rounded[1])
        try:
            response = await self.http.get(f'{self.base_url}/api/', params=params)
            response.raise_for_status()
            places = parse_photon(response.json())
        except (httpx.HTTPError, ValueError) as error:
            raise PlacesUnavailable(f'Place search unavailable: {error!r}') from error
        self.cache[key] = (self.clock() + CACHE_TTL_S, places)
        if len(self.cache) > CACHE_SIZE:
            self.cache.popitem(last=False)
        return places
