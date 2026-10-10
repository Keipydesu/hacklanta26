import httpx
import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.places import METRO_BBOX, PlaceSearch, PlacesUnavailable, parse_photon
from test_boundary import validate

def feature(name=None, lat=33.7536, lon=-84.3854, **props):
    return {'type': 'Feature', 'geometry': {'type': 'Point', 'coordinates': [lon, lat]},
            'properties': {'osm_type': 'W', 'osm_id': abs(hash((name, lat, lon))) % 10**8, 'name': name, **props}}

PHOTON = {'features': [
    feature('Georgia State University', housenumber='33', street='Gilmer Street Southeast', city='Atlanta', state='GA'),
    feature('Georgia State University', housenumber='33', street='Gilmer Street Southeast', city='Atlanta', state='GA', lat=33.7529),
    feature(None, housenumber='55', street='Park Place Northeast', city='Atlanta', state='Georgia', lat=33.756, lon=-84.387),
    feature('Calgary house', lat=51.05, lon=-113.9),
    feature(None, lat=33.75, lon=-84.39),
]}

def test_photon_results_become_readable_deduplicated_metro_places():
    places = parse_photon(PHOTON)
    assert [(p.name, p.address) for p in places] == [
        ('Georgia State University', '33 Gilmer Street Southeast, Atlanta, GA'),
        ('55 Park Place Northeast', 'Atlanta, Georgia'),
    ]
    assert all(METRO_BBOX[0] <= p.lon <= METRO_BBOX[2] and METRO_BBOX[1] <= p.lat <= METRO_BBOX[3] for p in places)

def test_at_most_five_results_and_malformed_payloads_are_unavailable():
    many = {'features': [feature(f'Place {n}', lat=33.75 + n / 1000) for n in range(9)]}
    assert len(parse_photon(many)) == 5
    for bad in (None, [], {'nope': 1}):
        with pytest.raises(PlacesUnavailable):
            parse_photon(bad)
    assert parse_photon({'features': [{'geometry': None}, 'junk']}) == []

class FakePhoton:
    def __init__(self, respond=lambda request: httpx.Response(200, json=PHOTON)):
        self.requests, self.respond = [], respond
    def __call__(self, request):
        self.requests.append(request)
        return self.respond(request)

@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv('PHOTON_URL', 'http://photon.test')
    with TestClient(create_app('')) as client:
        yield client

def use(client, fake):
    client.app.state.places.http = httpx.AsyncClient(transport=httpx.MockTransport(fake))

def test_search_returns_contract_valid_places_and_sends_only_the_area_and_a_rounded_bias(client):
    fake = FakePhoton()
    use(client, fake)
    response = client.get('/v1/places', params={'q': '  Georgia   State ', 'near': '33.753112,-84.385317'})
    assert response.status_code == 200
    validate('PlaceResults', response.json())
    assert response.json()['places'][0]['name'] == 'Georgia State University'
    sent = fake.requests[0].url.params
    assert sent['q'] == 'Georgia State' and sent['bbox'] == ','.join(str(v) for v in METRO_BBOX)
    assert (sent['lat'], sent['lon']) == ('33.753', '-84.385'), 'the bias is rounded to about 100 m'

def test_repeated_searches_are_cached(client):
    fake = FakePhoton()
    use(client, fake)
    for _ in range(3):
        assert client.get('/v1/places', params={'q': 'Georgia State', 'near': '33.75311,-84.38531'}).status_code == 200
    assert len(fake.requests) == 1

@pytest.mark.parametrize('params', [{'q': 'ab'}, {'q': '   x  '}, {'q': 'x' * 101}, {'q': 'park', 'near': 'north'},
                                    {'q': 'park', 'near': '91,0'}, {'q': 'park', 'near': '1,2,3'}, {'q': 'park', 'near': 'nan,0'}])
def test_invalid_queries_are_422(client, params):
    use(client, FakePhoton())
    assert client.get('/v1/places', params=params).status_code == 422

@pytest.mark.parametrize('respond', [lambda r: httpx.Response(500), lambda r: httpx.Response(200, content=b'<html>'),
                                     lambda r: (_ for _ in ()).throw(httpx.ConnectTimeout('slow')), lambda r: httpx.Response(200, json={'x': 1})])
def test_provider_failures_are_503_and_never_cached(client, respond):
    use(client, FakePhoton(respond))
    response = client.get('/v1/places', params={'q': 'Georgia State'})
    assert response.status_code == 503 and 'map' in response.json()['detail']
    use(client, FakePhoton())
    assert client.get('/v1/places', params={'q': 'Georgia State'}).status_code == 200

def test_search_can_be_disabled(monkeypatch):
    monkeypatch.setenv('PHOTON_URL', '')
    with TestClient(create_app('')) as client:
        assert client.get('/v1/places', params={'q': 'Georgia State'}).status_code == 503

def test_cache_expires():
    clock = [0.0]
    fake = FakePhoton()
    search = PlaceSearch('http://photon.test', httpx.AsyncClient(transport=httpx.MockTransport(fake)), clock=lambda: clock[0])
    import asyncio
    asyncio.run(search.search('Georgia State'))
    clock[0] = 599
    asyncio.run(search.search('georgia state'))
    clock[0] = 601
    asyncio.run(search.search('Georgia State'))
    assert len(fake.requests) == 2
