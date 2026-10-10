import asyncio
import base64
import json
import httpx
import pytest
from fastapi.testclient import TestClient
from app.ai import VultrAI, AIBusy, validate_image
from app.main import create_app
from test_boundary import fresh, validate, FEED

# Real 1x1 JPEG, no external services or image libraries required by tests.
PHOTO = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAAAP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AAA//2Q=='
SUGGESTION = {'status': 'suggested', 'kind': 'obstruction', 'description': 'A barrier appears to block the walkway.'}
SUMMARY = {'routes': [
    {'kind': 'shortest', 'distance_m': 1000, 'duration_s': 180, 'hazard_count': 3},
    {'kind': 'safest', 'distance_m': 1200, 'duration_s': 240, 'hazard_count': 1}], 'safest_available': True}

@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv('VULTR_INFERENCE_API_KEY', 'private-test-key')
    monkeypatch.setenv('VULTR_INFERENCE_MODEL', 'qwen3.8-27b')
    monkeypatch.setenv('PHOTON_URL', '')
    with TestClient(create_app('')) as client:
        yield client

def use(client, answer=SUGGESTION, status=200, finish='stop'):
    sent = []
    def respond(request):
        sent.append(request)
        return httpx.Response(status, json={'choices': [{'finish_reason': finish, 'message': {'content': json.dumps(answer)}}]})
    asyncio.run(client.app.state.ai.http.aclose())
    client.app.state.ai.http = httpx.AsyncClient(base_url='https://api.vultrinference.com/v1/', transport=httpx.MockTransport(respond))
    return sent

def test_ai_disabled_keeps_manual_reporting_and_health_working(monkeypatch):
    monkeypatch.delenv('VULTR_INFERENCE_API_KEY', raising=False)
    monkeypatch.setenv('PHOTON_URL', '')
    with TestClient(create_app('')) as client:
        assert client.get('/v1/ai/status').json() == {'available': False}
        assert client.post('/v1/ai/analyze-photo', json={'image_base64': PHOTO}).status_code == 503
        assert client.post('/v1/ai/explain-route', json=SUMMARY).status_code == 503
        assert client.get('/healthz').status_code == 200
        assert client.post('/v1/reports', json=fresh()[0]).status_code == 201

def test_photo_suggests_but_never_publishes_and_credentials_stay_server_side(client):
    sent = use(client)
    assert client.get('/v1/ai/status').json() == {'available': True}
    response = client.post('/v1/ai/analyze-photo', json={'image_base64': PHOTO})
    assert response.json() == SUGGESTION
    validate('PhotoAnalysis', response.json())
    assert client.get(FEED).json()['features'] == []
    request = sent[0]
    assert str(request.url) == 'https://api.vultrinference.com/v1/chat/completions'
    assert request.headers['authorization'] == 'Bearer private-test-key'
    payload = json.loads(request.content)
    assert payload['model'] == 'qwen3.8-27b'
    assert payload['response_format']['json_schema']['strict'] is True
    assert payload['messages'][1]['content'][1]['image_url']['url'].startswith('data:image/jpeg;base64,')
    assert 'private-test-key' not in response.text
    # The rider's confirmed report still enters the existing manual endpoint.
    manual = dict(fresh()[0], kind=response.json()['kind'], description=response.json()['description'])
    assert client.post('/v1/reports', json=manual).status_code == 201
    assert client.get(FEED).json()['features'][0]['properties']['source'] == 'manual'

def test_jpeg_header_gps_metadata_is_removed_before_forwarding(client):
    sent = use(client)
    raw = base64.b64decode(PHOTO)
    metadata = b'Exif\x00\x00GPS-secret'
    segment = b'\xff\xe1' + (len(metadata) + 2).to_bytes(2, 'big') + metadata
    encoded = base64.b64encode(raw[:2] + segment + raw[2:]).decode()
    assert client.post('/v1/ai/analyze-photo', json={'image_base64': encoded}).status_code == 200
    forwarded = json.loads(sent[0].content)['messages'][1]['content'][1]['image_url']['url'].split(',')[1]
    assert b'GPS-secret' not in base64.b64decode(forwarded)
    assert validate_image(forwarded) == PHOTO

@pytest.mark.parametrize('image', ['https://example.com/photo.jpg', '!!!!', base64.b64encode(b'not jpeg').decode(), base64.b64encode(b'\xff\xd8\xff\xd9').decode()])
def test_invalid_images_never_reach_vultr(client, image):
    sent = use(client)
    assert client.post('/v1/ai/analyze-photo', json={'image_base64': image}).status_code == 422
    assert not sent

def test_oversized_and_extra_fields_are_rejected_without_echoing_photo(client):
    sent = use(client)
    assert client.post('/v1/ai/analyze-photo', content=(b'x' * 4200001), headers={'Content-Type': 'application/json'}).status_code == 413
    response = client.post('/v1/ai/analyze-photo', json={'image_base64': PHOTO, 'lat': 33.75})
    assert response.status_code == 422 and PHOTO not in response.text and not sent

@pytest.mark.parametrize('answer,finish', [
    ({'status': 'suggested', 'kind': 'made_up', 'description': 'bad'}, 'stop'),
    ({'status': 'no_hazard', 'kind': 'pothole', 'description': 'bad'}, 'stop'),
    ({'status': 'suggested', 'kind': 'pothole', 'description': 'x' * 281}, 'stop'),
    (SUGGESTION, 'length'),
])
def test_invalid_or_truncated_model_output_is_unavailable(client, answer, finish):
    use(client, answer, finish=finish)
    assert client.post('/v1/ai/analyze-photo', json={'image_base64': PHOTO}).status_code == 503

@pytest.mark.parametrize('status', [401, 429, 500])
def test_upstream_failure_does_not_break_manual_reporting(client, status):
    use(client, status=status)
    response = client.post('/v1/ai/analyze-photo', json={'image_base64': PHOTO})
    assert response.status_code == 503 and 'private-test-key' not in response.text
    assert client.get('/healthz').status_code == 200
    assert client.post('/v1/reports', json=fresh()[0]).status_code == 201

def test_route_explanation_uses_displayed_numeric_facts_only(client):
    sent = use(client, {'focus': 'hazards'})
    response = client.post('/v1/ai/explain-route', json=SUMMARY)
    assert response.status_code == 200
    validate('RouteExplanation', response.json())
    text = response.json()['explanation']
    assert text.startswith('The lower-risk option intersects 1 reported hazard, compared with 3')
    assert '4.0 minutes' in text and '3.0 minutes' in text and '1200 m' in text
    message = json.loads(sent[0].content)['messages'][1]['content']
    assert json.loads(message) == SUMMARY
    assert 'coordinates' not in message and 'lat' not in message
    fallback = dict(SUMMARY, safest_available=False)
    assert client.post('/v1/ai/explain-route', json=fallback).json()['explanation'].startswith('No distinct lower-risk alternative')

def test_ai_cannot_invent_route_facts_and_summary_rejects_geometry(client):
    sent = use(client, {'focus': 'hazards', 'explanation': 'This route is completely safe.'})
    assert client.post('/v1/ai/explain-route', json=SUMMARY).status_code == 503
    assert client.post('/v1/ai/explain-route', json=dict(SUMMARY, geometry={})).status_code == 422
    assert client.post('/v1/ai/explain-route', json=dict(SUMMARY, routes=[SUMMARY['routes'][0]] * 2)).status_code == 422
    assert len(sent) == 1

def test_bounded_ai_budget_returns_retry_after(client):
    sent = use(client)
    client.app.state.ai.active = 2
    response = client.post('/v1/ai/analyze-photo', json={'image_base64': PHOTO})
    assert response.status_code == 429 and response.headers['Retry-After'] == '60'
    client.app.state.ai.active = 0
    import time
    client.app.state.ai.starts.extend([time.monotonic()] * 20)
    assert client.post('/v1/ai/analyze-photo', json={'image_base64': PHOTO}).status_code == 429
    assert not sent
