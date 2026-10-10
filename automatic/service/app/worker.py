"""Serialized hazard evaluation: cluster events, score, match identities, commit derived state + outbox.

Tunables (documented, not contract): CLUSTER_EPS_M/MIN_EVENTS/MIN_RIDES from the architecture;
MIN_SCORE keeps long-decayed clusters from publishing; SCORE_DELTA/REFRESH_MARGIN stop the periodic
wake from republishing unchanged hazards; MATCH_DISTANCE_M is the max gap for an identity match.
"""
from datetime import datetime, timedelta
import json
from uuid import uuid4

from psycopg.types.json import Jsonb

from . import abandonment
from .publisher import validator

EPS_M, MIN_EVENTS, MIN_RIDES = 12, 3, 2
LOOKBACK = timedelta(days=30)
TTL = timedelta(hours=24)
REFRESH_MARGIN = timedelta(hours=6)  # re-publish an unchanged hazard when expiry is nearer than this
SCORE_DELTA = 0.02
MIN_SCORE = 0.2
MATCH_DISTANCE_M = 12
KINDS = {'hard_brake': ('braking', 'Hard braking'), 'bump': ('surface', 'Rough surface')}
LOCK_KEY = 7_262_026_003

def score_events(timestamps, now):
    """min(1, sum(0.5 ** (age_days / 7)) / 5); future timestamps count as age 0, never above fresh weight."""
    total = sum(0.5 ** (max(0.0, (now - ts).total_seconds()) / 86400 / 7) for ts in timestamps)
    return min(1.0, total / 5)

def evidence_source(sources):
    unique = set(sources)
    return unique.pop() if len(unique) == 1 else 'mixed'

CLUSTER_SQL = '''
WITH e AS (
    SELECT id, ride_id, ts, source, ST_Transform(location, 32616) AS g
    FROM events WHERE type = %s AND ts > %s AND ts <= %s ORDER BY ts, id),
c AS (SELECT *, ST_ClusterDBSCAN(g, eps := %s, minpoints := %s) OVER () AS cid FROM e)
SELECT cid, array_agg(ts ORDER BY ts, id) AS stamps, array_agg(source ORDER BY ts, id) AS sources,
       count(*) AS events, count(DISTINCT ride_id) AS rides,
       ST_AsGeoJSON(ST_Transform(ST_Buffer(ST_ConvexHull(ST_Collect(g)), 8), 4326), 7)::jsonb AS geometry
FROM c WHERE cid IS NOT NULL GROUP BY cid HAVING count(DISTINCT ride_id) >= %s ORDER BY min(ts), cid'''

def iso(value):
    return value.isoformat().replace('+00:00', 'Z')

async def cluster_events(conn, event_type, now):
    kind, name = KINDS[event_type]
    rows = await (await conn.execute(CLUSTER_SQL, (event_type, now - LOOKBACK, now + timedelta(minutes=5), EPS_M, MIN_EVENTS, MIN_RIDES))).fetchall()
    found = []
    for row in rows:
        score = round(score_events(row['stamps'], now), 3)
        if score < MIN_SCORE or row['geometry']['type'] != 'Polygon':
            continue
        found.append({'kind': kind, 'geometry': row['geometry'], 'score': score, 'event_count': row['events'],
                      'ride_count': row['rides'], 'first_seen': row['stamps'][0], 'last_seen': row['stamps'][-1],
                      'label': f"{name}, {row['events']} events", 'evidence_source': evidence_source(row['sources'])})
    return found

async def match(conn, candidates):
    """One-to-one greedy match, ranked by overlap area desc, gap asc, prior ID (deterministic)."""
    pairs = []
    for index, cand in enumerate(candidates):
        rows = await (await conn.execute(
            '''SELECT external_id, kind,
                      ST_Area(ST_Intersection(geometry, g)::geography) AS overlap,
                      ST_Distance(geometry::geography, g::geography) AS gap
               FROM derived_hazards, (SELECT ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326) AS g) AS c
               WHERE status = 'active' AND kind = %s AND ST_DWithin(geometry::geography, g::geography, %s)''',
            (json.dumps(cand['geometry']), cand['kind'], MATCH_DISTANCE_M))).fetchall()
        pairs += [(-row['overlap'], row['gap'], str(row['external_id']), index) for row in rows]
    taken_old, taken_new, matches = set(), set(), {}
    for _, _, old, new in sorted(pairs):
        if old not in taken_old and new not in taken_new:
            taken_old.add(old), taken_new.add(new)
            matches[new] = old
    return matches

def public_body(cand, revision, now, status='active'):
    return {'revision': revision, 'kind': cand['kind'], 'geometry': cand['geometry'], 'score': cand['score'],
            'event_count': cand['event_count'], 'ride_count': cand['ride_count'], 'first_seen': iso(cand['first_seen']),
            'last_seen': iso(cand['last_seen']), 'expires_at': iso(now + TTL), 'status': status,
            'label': cand['label'], 'evidence_source': cand['evidence_source']}

def materially_changed(old, new, now):
    keys = ('kind', 'geometry', 'event_count', 'ride_count', 'first_seen', 'last_seen', 'status', 'label', 'evidence_source')
    if any(old[k] != new[k] for k in keys) or abs(old['score'] - new['score']) >= SCORE_DELTA:
        return True
    expires = datetime.fromisoformat(old['expires_at'].replace('Z', '+00:00'))
    return expires - now < REFRESH_MARGIN

async def enqueue(conn, external_id, body, geometry_json, now):
    validator().validate(body)  # never enqueue a body the product would reject
    await conn.execute(
        '''INSERT INTO derived_hazards (external_id, kind, geometry, status, revision, public_body)
           VALUES (%s, %s, ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326), %s, %s, %s)
           ON CONFLICT (external_id) DO UPDATE SET kind = EXCLUDED.kind, geometry = EXCLUDED.geometry,
               status = EXCLUDED.status, revision = EXCLUDED.revision, public_body = EXCLUDED.public_body''',
        (external_id, body['kind'], json.dumps(geometry_json), body['status'], body['revision'], Jsonb(body)))
    await conn.execute('INSERT INTO outbox (external_id, revision, body, due_at) VALUES (%s, %s, %s, %s)',
                       (external_id, body['revision'], Jsonb(body), now))

async def abandoned_candidates(conn, now):
    """Traffic-based candidates; also refreshes the private per-cell rate table."""
    rows = await (await conn.execute(
        """SELECT ride_id, ts, ST_Y(location) AS lat, ST_X(location) AS lon, source FROM points
           WHERE ts > %s AND ts <= %s""", (now - timedelta(days=14), now))).fetchall()
    days, sources = abandonment.aggregate_traffic(((r['ride_id'], r['ts'], r['lat'], r['lon'], r['source']) for r in rows), now)
    found, flagged, stats = abandonment.candidates(days, sources, now)
    await conn.execute('DELETE FROM cells')
    for cell, (baseline, recent) in stats.items():
        if baseline > 0 or cell in flagged:
            ring = [[lng, lat] for lng, lat in abandonment.h3.cells_to_geo([cell])['coordinates'][0]]
            await conn.execute(
                """INSERT INTO cells (cell, resolution, window_end, baseline_rate, recent_rate, flagged, geometry)
                   VALUES (%s, %s, %s, %s, %s, %s, ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326))""",
                (cell, abandonment.RESOLUTION, now, baseline, recent, cell in flagged,
                 json.dumps({'type': 'Polygon', 'coordinates': [ring]})))
    return found

async def evaluate(pool, now):
    """One evaluation at a frozen clock. Returns the number of publications enqueued, or None if another evaluator holds the lock."""
    async with pool.connection() as conn, conn.transaction():
        await conn.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ')
        if not (await (await conn.execute('SELECT pg_try_advisory_xact_lock(%s) AS ok', (LOCK_KEY,))).fetchone())['ok']:
            return None
        snapshot_seq = (await (await conn.execute('SELECT dirty_seq FROM worker_state')).fetchone())['dirty_seq']
        enqueued = 0
        streams = [(kind, lambda t=t: cluster_events(conn, t, now)) for t, (kind, _) in KINDS.items()]
        streams.append(('abandoned', lambda: abandoned_candidates(conn, now)))
        for kind, produce in streams:
            candidates = await produce()
            previous = {str(r['external_id']): r for r in await (await conn.execute(
                "SELECT external_id, revision, public_body FROM derived_hazards WHERE status = 'active' AND kind = %s", (kind,))).fetchall()}
            matches = await match(conn, candidates)
            for index, cand in enumerate(candidates):
                if index in matches:
                    old = previous.pop(matches[index])
                    body = public_body(cand, old['revision'] + 1, now)
                    if materially_changed(old['public_body'], body, now):
                        await enqueue(conn, matches[index], body, cand['geometry'], now)
                        enqueued += 1
                else:
                    external_id = str(uuid4())
                    await enqueue(conn, external_id, public_body(cand, 1, now), cand['geometry'], now)
                    enqueued += 1
            for external_id, old in previous.items():  # no longer qualifies: complete resolved state, higher revision
                body = dict(old['public_body'], revision=old['revision'] + 1, status='resolved')
                await enqueue(conn, external_id, body, body['geometry'], now)
                enqueued += 1
    # Separate READ COMMITTED statement: inside the REPEATABLE READ snapshot this row update would fail
    # whenever an ingest bumped dirty_seq meanwhile. A crash before it just re-runs an idempotent pass.
    async with pool.connection() as conn:
        await conn.execute('UPDATE worker_state SET evaluated_seq = GREATEST(evaluated_seq, %s), last_evaluated_at = %s',
                           (snapshot_seq, now))
    return enqueued
