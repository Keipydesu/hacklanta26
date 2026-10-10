"""Atomic UUID-batch ingestion. A conflict anywhere rejects the whole batch (409)."""
from datetime import datetime, timezone

from psycopg.types.json import Jsonb

class Conflict(Exception):
    pass

def canonical_payload(body):
    """Compare instants, including payloads stored before UTC normalization was introduced."""
    stamp = datetime.fromisoformat(body['ts']).astimezone(timezone.utc)
    return dict(body, ts=stamp.isoformat().replace('+00:00', 'Z'))

def normalize(item, ride_id):
    body = item.model_dump(mode='json')
    body['ride_id'] = str(ride_id)  # identity includes the ride, even for points (path parameter)
    return canonical_payload(body)

async def compare_and_insert(conn, table, items, insert_sql, params_for):
    """items: [(id, ride_id, model)]. Returns (accepted, duplicates). Caller owns the transaction."""
    seen, accepted, duplicates = {}, 0, 0
    for id, ride_id, item in items:
        body = normalize(item, ride_id)
        if id in seen:
            if seen[id] != body:
                raise Conflict()
            duplicates += 1
            continue
        seen[id] = body
        # ON CONFLICT waits for a concurrent inserter of the same UUID, so contradictory bodies cannot both win.
        inserted = await (await conn.execute(insert_sql + ' ON CONFLICT (id) DO NOTHING RETURNING id',
                                              params_for(id, ride_id, item, Jsonb(body)))).fetchone()
        if inserted:
            accepted += 1
            continue
        row = await (await conn.execute(f'SELECT payload FROM {table} WHERE id = %s', (id,))).fetchone()
        if canonical_payload(row['payload']) != body:
            raise Conflict()
        duplicates += 1
    return accepted, duplicates

EVENT_SQL = '''INSERT INTO events (id, ride_id, type, ts, location, source, payload)
               VALUES (%s, %s, %s, %s, ST_SetSRID(ST_MakePoint(%s, %s), 4326), %s, %s)'''
POINT_SQL = '''INSERT INTO points (id, ride_id, ts, location, source, payload)
               VALUES (%s, %s, %s, ST_SetSRID(ST_MakePoint(%s, %s), 4326), %s, %s)'''

async def ingest_events(pool, events):
    async with pool.connection() as conn, conn.transaction():
        result = await compare_and_insert(
            conn, 'events', [(e.id, e.ride_id, e) for e in events], EVENT_SQL,
            lambda id, ride, e, payload: (id, ride, e.type, e.ts, e.lon, e.lat, e.source, payload))
        if result[0]:
            await conn.execute('UPDATE worker_state SET dirty_seq = dirty_seq + 1')
        return result

async def ingest_points(pool, ride_id, points):
    async with pool.connection() as conn, conn.transaction():
        result = await compare_and_insert(
            conn, 'points', [(p.id, ride_id, p) for p in points], POINT_SQL,
            lambda id, ride, p, payload: (id, ride, p.ts, p.lon, p.lat, p.source, payload))
        if result[0]:
            await conn.execute('UPDATE worker_state SET dirty_seq = dirty_seq + 1')
        return result
