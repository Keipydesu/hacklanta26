"""PostGIS-backed product store. Every method is one transaction; notifications happen after commit."""
from dataclasses import dataclass
from datetime import timedelta
from uuid import UUID, uuid4

from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from psycopg_pool import AsyncConnectionPool
from shapely.geometry import shape

from ..schemas import AutomaticPublication, ManualReport

class Conflict(Exception):
    """Same identity, different content (report body or stale/conflicting revision)."""

@dataclass
class Result:
    hazard_id: str
    duplicate: bool
    status: int  # HTTP status the adapter should use: 201 created, 200 retry/update

FEATURE_COLUMNS = '''id, source, kind, label, score, status, first_seen, last_seen, expires_at,
    event_count, ride_count, report_count, evidence_source'''

class PostgresStore:
    def __init__(self, url, pool_size=10):
        self.pool = AsyncConnectionPool(url, min_size=1, max_size=pool_size, open=False,
                                        kwargs={'row_factory': dict_row}, timeout=5,
                                        check=AsyncConnectionPool.check_connection)

    async def open(self):
        await self.pool.open(wait=True, timeout=10)

    async def close(self):
        await self.pool.close()

    async def health(self):
        async with self.pool.connection(timeout=2) as conn:
            await conn.execute('SELECT 1')

    async def create_report(self, body: ManualReport, area):
        """Insert report + buffered hazard atomically; resolve identical/conflicting retries."""
        report_id = body.id
        payload = body.model_dump(mode='json')
        async with self.pool.connection() as conn, conn.transaction():
            # ON CONFLICT waits for a concurrent inserter of the same ID, so exactly one wins.
            inserted = await (await conn.execute(
                '''INSERT INTO manual_reports (id, kind, location, observed_at, description, payload)
                   VALUES (%s, %s, ST_SetSRID(ST_MakePoint(%s, %s), 4326), %s, %s, %s)
                   ON CONFLICT (id) DO NOTHING RETURNING id''',
                (report_id, body.kind, body.lon, body.lat, body.observed_at, body.description, Jsonb(payload)))).fetchone()
            if not inserted:
                row = await (await conn.execute(
                    '''SELECT r.payload, h.id AS hazard_id FROM manual_reports r
                       JOIN hazards h ON h.manual_report_id = r.id WHERE r.id = %s''', (report_id,))).fetchone()
                if ManualReport.model_validate(row['payload']) != body:
                    raise Conflict()
                return Result(str(row['hazard_id']), True, 200)
            hazard_id = uuid4()
            expires = body.observed_at + timedelta(hours=24)
            await conn.execute(
                '''INSERT INTO hazards (id, source, kind, geometry, label, score, status, first_seen, last_seen,
                       expires_at, event_count, ride_count, report_count, evidence_source, manual_report_id)
                   VALUES (%s, 'manual', %s, ST_SetSRID(ST_GeomFromWKB(%s), 4326), %s, 0.5, 'active', %s, %s, %s,
                       0, 0, 1, NULL, %s)''',
                (hazard_id, body.kind, area.wkb, body.description or body.kind, body.observed_at,
                 body.observed_at, expires, report_id))
            return Result(str(hazard_id), False, 201)

    async def publish(self, publisher: str, external_id: UUID, body: AutomaticPublication):
        """Revision-serialized upsert: the row lock makes concurrent revisions apply in a strict order."""
        payload = body.model_dump(mode='json')
        geometry = shape(body.geometry.model_dump())
        async with self.pool.connection() as conn, conn.transaction():
            hazard_id = uuid4()
            created = await (await conn.execute(
                '''INSERT INTO hazards (id, source, kind, geometry, label, score, status, first_seen, last_seen,
                       expires_at, event_count, ride_count, report_count, evidence_source, publisher, external_id,
                       revision, publication)
                   VALUES (%s, 'automatic', %s, ST_SetSRID(ST_GeomFromWKB(%s), 4326), %s, %s, %s, %s, %s, %s, %s, %s,
                       0, %s, %s, %s, %s, %s)
                   ON CONFLICT (publisher, external_id) DO NOTHING RETURNING id''',
                (hazard_id, body.kind, geometry.wkb, body.label, body.score, body.status, body.first_seen,
                 body.last_seen, body.expires_at, body.event_count, body.ride_count, body.evidence_source,
                 publisher, external_id, body.revision, Jsonb(payload)))).fetchone()
            if created:
                return Result(str(hazard_id), False, 201)
            row = await (await conn.execute(
                'SELECT id, revision, publication FROM hazards WHERE publisher = %s AND external_id = %s FOR UPDATE',
                (publisher, external_id))).fetchone()
            previous = AutomaticPublication.model_validate(row['publication'])
            if body.revision < row['revision'] or (body.revision == row['revision'] and body != previous):
                raise Conflict()
            if body == previous:
                return Result(str(row['id']), True, 200)
            await conn.execute(
                '''UPDATE hazards SET kind = %s, geometry = ST_SetSRID(ST_GeomFromWKB(%s), 4326), label = %s,
                       score = %s, status = %s, first_seen = %s, last_seen = %s, expires_at = %s, event_count = %s,
                       ride_count = %s, evidence_source = %s, revision = %s, publication = %s,
                       expiry_notified_for = CASE WHEN expires_at IS DISTINCT FROM %s THEN NULL ELSE expiry_notified_for END
                   WHERE id = %s''',
                (body.kind, geometry.wkb, body.label, body.score, body.status, body.first_seen, body.last_seen,
                 body.expires_at, body.event_count, body.ride_count, body.evidence_source, body.revision,
                 Jsonb(payload), body.expires_at, row['id']))
            return Result(str(row['id']), False, 200)

    async def list_active(self, bounds, now):
        west, south, east, north = bounds
        async with self.pool.connection() as conn:
            rows = await (await conn.execute(
                f'''SELECT {FEATURE_COLUMNS}, ST_AsGeoJSON(geometry)::jsonb AS geojson FROM hazards
                    WHERE status = 'active' AND expires_at > %s
                      AND geometry && ST_MakeEnvelope(%s, %s, %s, %s, 4326)
                      AND ST_Intersects(geometry, ST_MakeEnvelope(%s, %s, %s, %s, 4326))
                    ORDER BY first_seen, id''',
                (now, west, south, east, north, west, south, east, north))).fetchall()
        features = []
        for row in rows:
            geometry = row.pop('geojson')
            row['id'] = str(row['id'])
            features.append({'type': 'Feature', 'geometry': geometry, 'properties': row})
        return features

    async def scan_expirations(self, now, limit=100):
        """Record (and return) hazards newly past expiry; commits before the caller notifies anyone."""
        async with self.pool.connection() as conn, conn.transaction():
            rows = await (await conn.execute(
                '''UPDATE hazards SET expiry_notified_for = expires_at WHERE id IN (
                       SELECT id FROM hazards
                       WHERE status = 'active' AND expires_at <= %s
                         AND expiry_notified_for IS DISTINCT FROM expires_at
                       ORDER BY expires_at LIMIT %s FOR UPDATE SKIP LOCKED)
                   RETURNING id''', (now, limit))).fetchall()
        return [str(row['id']) for row in rows]
