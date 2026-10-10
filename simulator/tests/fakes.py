"""In-memory HTTP stand-ins for the product and observation APIs, for simulator tests only.

They implement just the contract behaviour the scenarios assert on (idempotency, revisions,
credentials, expiry filtering, atomic batches). They are not the real services and prove nothing
about them; the real gates are run against live APIs.
"""
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import math
import threading
from urllib.parse import parse_qs, urlparse
from uuid import uuid4

KEY = 'test-publisher-key'


def _time(value):
    return datetime.fromisoformat(value.replace('Z', '+00:00'))


class Services:
    """Shared state for both fake APIs, plus a toy worker that publishes qualifying clusters."""

    def __init__(self, worker=True, stub_routes=True):
        self.reports, self.hazards, self.publications = {}, {}, {}
        self.events, self.points = {}, {}
        self.requests = []           # (method, path, raw body bytes)
        self.fail_next = []          # statuses to answer with before behaving normally
        self.worker, self.stub_routes = worker, stub_routes
        self.lock = threading.Lock()

    # --- product -------------------------------------------------------------------------
    def create_report(self, body):
        if body['id'] in self.reports:
            previous, hazard_id = self.reports[body['id']]
            if previous != body:
                return 409, {'detail': 'Report ID already has a different payload'}
            return 200, {'report_id': body['id'], 'hazard_id': hazard_id, 'duplicate': True}
        hazard_id = str(uuid4())
        observed = _time(body['observed_at'])
        self.hazards[hazard_id] = self._feature(hazard_id, body['lat'], body['lon'], 8, {
            'id': hazard_id, 'source': 'manual', 'kind': body['kind'], 'label': body.get('description') or body['kind'], 'score': 0.5, 'status': 'active',
            'first_seen': body['observed_at'], 'last_seen': body['observed_at'], 'expires_at': (observed + timedelta(hours=24)).isoformat(),
            'event_count': 0, 'ride_count': 0, 'report_count': 1, 'evidence_source': None})
        self.reports[body['id']] = (body, hazard_id)
        return 201, {'report_id': body['id'], 'hazard_id': hazard_id, 'duplicate': False}

    def publish(self, external_id, body, authorization):
        if authorization != f'Bearer {KEY}':
            return 401, {'detail': 'Missing or invalid publisher credential'}
        status, hazard_id = 201, str(uuid4())
        if external_id in self.publications:
            previous, hazard_id = self.publications[external_id]
            if body['revision'] < previous['revision'] or (body['revision'] == previous['revision'] and body != previous):
                return 409, {'detail': 'Stale or conflicting revision'}
            status = 200
            if body == previous:
                return 200, {'hazard_id': hazard_id, 'revision': body['revision'], 'duplicate': True}
        props = {k: v for k, v in body.items() if k not in ('revision', 'geometry')}
        props.update(id=hazard_id, source='automatic', report_count=0)
        self.hazards[hazard_id] = {'type': 'Feature', 'geometry': body['geometry'], 'properties': props}
        self.publications[external_id] = (body, hazard_id)
        return status, {'hazard_id': hazard_id, 'revision': body['revision'], 'duplicate': False}

    def feed(self):
        now = datetime.now(timezone.utc)
        return {'type': 'FeatureCollection', 'features': [h for h in self.hazards.values()
                if h['properties']['status'] == 'active' and _time(h['properties']['expires_at']) > now]}

    @staticmethod
    def _feature(hazard_id, lat, lon, half_m, props):
        d_lat, d_lon = half_m / 111_320, half_m / (111_320 * math.cos(math.radians(lat)))
        ring = [[lon - d_lon, lat - d_lat], [lon + d_lon, lat - d_lat], [lon + d_lon, lat + d_lat], [lon - d_lon, lat + d_lat], [lon - d_lon, lat - d_lat]]
        return {'type': 'Feature', 'geometry': {'type': 'Polygon', 'coordinates': [ring]}, 'properties': props}

    # --- observation ---------------------------------------------------------------------
    def ingest(self, store, items, identity=lambda item: item):
        accepted = duplicates = 0
        seen = {}
        for item in items:
            known = store.get(item['id'], seen.get(item['id']))
            if known is not None and known != identity(item):
                return 409, {'detail': 'Observation ID already has a different payload'}
            seen[item['id']] = identity(item)
        for item in items:
            if item['id'] in store:
                duplicates += 1
            else:
                store[item['id']] = identity(item)
                accepted += 1
        return 200, {'accepted': accepted, 'duplicates': duplicates}

    def recompute(self):
        """Toy stand-in for Lane D: 12 m, >= 3 events, >= 2 rides, one hazard per cluster seed."""
        kinds = {'hard_brake': 'braking', 'bump': 'surface'}
        remaining = list(self.events.values())
        index = 0
        while remaining:
            seed = remaining[0]
            cluster = [e for e in remaining if e['type'] == seed['type'] and _metres(e, seed) <= 12]
            remaining = [e for e in remaining if e not in cluster]
            if len(cluster) < 3 or len({e['ride_id'] for e in cluster}) < 2:
                continue
            lat = sum(e['lat'] for e in cluster) / len(cluster)
            lon = sum(e['lon'] for e in cluster) / len(cluster)
            sources = {e['source'] for e in cluster}
            hazard_id = f'derived-{seed["type"]}-{index}'
            index += 1
            now = datetime.now(timezone.utc)
            self.hazards[hazard_id] = self._feature(hazard_id, lat, lon, 10, {
                'id': hazard_id, 'source': 'automatic', 'kind': kinds[seed['type']], 'label': f'{len(cluster)} events', 'score': min(1.0, len(cluster) / 5),
                'status': 'active', 'first_seen': now.isoformat(), 'last_seen': now.isoformat(), 'expires_at': (now + timedelta(hours=24)).isoformat(),
                'event_count': len(cluster), 'ride_count': len({e['ride_id'] for e in cluster}), 'report_count': 0,
                'evidence_source': sources.pop() if len(sources) == 1 else 'mixed'})


def _metres(a, b):
    return math.hypot((a['lat'] - b['lat']) * 111_320, (a['lon'] - b['lon']) * 111_320 * math.cos(math.radians(a['lat'])))


def serve(services: Services):
    """Start one server answering both APIs. Returns (base_url, shutdown)."""

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def _reply(self, status, body, headers=None):
            raw = json.dumps(body).encode()
            self.send_response(status)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(raw)))
            for key, value in (headers or {}).items():
                self.send_header(key, value)
            self.end_headers()
            self.wfile.write(raw)

        def _handle(self, method):
            url = urlparse(self.path)
            raw = self.rfile.read(int(self.headers.get('Content-Length') or 0))
            with services.lock:
                services.requests.append((method, url.path, raw))
                if services.fail_next:
                    return self._reply(services.fail_next.pop(0), {'detail': 'injected failure'})
                body = json.loads(raw) if raw else None
                parts = url.path.strip('/').split('/')
                if method == 'GET' and url.path == '/v1/hazards':
                    if 'bbox' not in parse_qs(url.query):
                        return self._reply(422, {'detail': 'bbox required'})
                    return self._reply(200, services.feed())
                if method == 'POST' and url.path == '/v1/reports':
                    return self._reply(*services.create_report(body))
                if method == 'PUT' and parts[:3] == ['v1', 'automatic', 'hazards']:
                    return self._reply(*services.publish(parts[3], body, self.headers.get('Authorization')))
                if method == 'POST' and url.path == '/v1/route':
                    line = [[body['origin']['lon'], body['origin']['lat']], [body['destination']['lon'], body['destination']['lat']]]
                    route = {'geometry': {'type': 'LineString', 'coordinates': line}, 'distance_m': 410, 'duration_s': 92, 'risk_score': 0, 'hazard_ids': []}
                    headers = {'X-Stage-0-Stub': 'fixed-route-fixture-not-navigation'} if services.stub_routes else {}
                    return self._reply(200, {'routes': [{'kind': 'shortest', **route}, {'kind': 'safest', **route}], 'safest_available': False}, headers)
                if method == 'POST' and url.path == '/v1/events':
                    result = services.ingest(services.events, body['events'])
                    if services.worker:
                        services.recompute()
                    return self._reply(*result)
                if method == 'POST' and parts[:2] == ['v1', 'rides'] and parts[3:] == ['points']:
                    return self._reply(*services.ingest(services.points, body['points'], identity=lambda p: {**p, 'ride_id': parts[2]}))
                return self._reply(404, {'detail': 'not found'})

        def do_GET(self):
            self._handle('GET')

        def do_POST(self):
            self._handle('POST')

        def do_PUT(self):
            self._handle('PUT')

    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()

    def shutdown():
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)
    return f'http://127.0.0.1:{server.server_address[1]}', shutdown
