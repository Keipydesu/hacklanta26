"""Durable outbox delivery: persisted body is sent verbatim, in revision order per hazard."""
from datetime import timedelta
import random

import httpx

from .publisher import send

LEASE = timedelta(seconds=60)
BACKOFF_CAP_S = 300

CLAIM_SQL = '''
UPDATE outbox SET state = 'sending', lease_until = %s, attempts = attempts + 1
WHERE (external_id, revision) IN (
    SELECT o.external_id, o.revision FROM outbox o
    WHERE ((o.state = 'pending' AND o.due_at <= %s) OR (o.state = 'sending' AND o.lease_until < %s))
      -- revision N must be delivered before N+1; a blocked or in-flight predecessor holds the successor back
      AND NOT EXISTS (SELECT 1 FROM outbox p WHERE p.external_id = o.external_id AND p.revision < o.revision
                      AND p.state <> 'delivered')
    ORDER BY o.due_at, o.external_id, o.revision LIMIT %s FOR UPDATE SKIP LOCKED)
RETURNING external_id, revision, body, attempts'''

async def claim_due(pool, now, limit=10):
    async with pool.connection() as conn, conn.transaction():
        return await (await conn.execute(CLAIM_SQL, (now + LEASE, now, now, limit))).fetchall()

async def mark(pool, job, state, error=None, due_at=None, product_id=None):
    async with pool.connection() as conn, conn.transaction():
        await conn.execute(
            '''UPDATE outbox SET state = %s, last_error = %s, lease_until = NULL, due_at = COALESCE(%s, due_at)
               WHERE external_id = %s AND revision = %s''', (state, error, due_at, job['external_id'], job['revision']))
        if product_id:
            await conn.execute('UPDATE derived_hazards SET product_hazard_id = %s WHERE external_id = %s',
                               (product_id, job['external_id']))

def backoff(attempts):
    return min(BACKOFF_CAP_S, 2 ** attempts) * random.uniform(0.5, 1.0)

async def deliver_due(pool, client: httpx.AsyncClient, url, key, now, limit=10):
    """Claim, send (no DB transaction held across HTTP), then ack/retry/block. Returns counts by outcome."""
    counts = {'delivered': 0, 'retry': 0, 'blocked': 0}
    for job in await claim_due(pool, now, limit):
        try:
            receipt = await send(client, url, key, job['external_id'], job['body'])
            if not isinstance(receipt, dict) or 'hazard_id' not in receipt or 'revision' not in receipt:
                raise TypeError('malformed receipt')  # server misbehaving: retry, don't block
            if receipt['revision'] != job['revision']:
                raise ValueError(f"receipt revision {receipt.get('revision')} != {job['revision']}")
            async with pool.connection() as conn:
                known = await (await conn.execute('SELECT product_hazard_id FROM derived_hazards WHERE external_id = %s',
                                                  (job['external_id'],))).fetchone()
            if known and known['product_hazard_id'] and str(known['product_hazard_id']) != receipt['hazard_id']:
                raise ValueError('product hazard ID changed for a stable external ID')
        except httpx.HTTPStatusError as error:
            status = error.response.status_code
            if status in (401, 409, 422):  # credential, revision disagreement, payload defect: stop blind retries
                await mark(pool, job, 'blocked', f'HTTP {status}')
                counts['blocked'] += 1
            else:  # 5xx, 429 and anything else unexpected
                await mark(pool, job, 'pending', f'HTTP {status}', now + timedelta(seconds=backoff(job['attempts'])))
                counts['retry'] += 1
        except httpx.HTTPError as error:
            await mark(pool, job, 'pending', type(error).__name__, now + timedelta(seconds=backoff(job['attempts'])))
            counts['retry'] += 1
        except ValueError as error:
            await mark(pool, job, 'blocked', str(error))
            counts['blocked'] += 1
        except Exception as error:  # e.g. a 200 with a malformed receipt: never leave the claim hanging until its lease expires
            await mark(pool, job, 'pending', f'bad receipt: {type(error).__name__}', now + timedelta(seconds=backoff(job['attempts'])))
            counts['retry'] += 1
        else:
            await mark(pool, job, 'delivered', product_id=receipt['hazard_id'])
            counts['delivered'] += 1
    return counts

async def release_blocked(pool, external_id):
    """Operator action after reconciliation: put blocked rows for this hazard back in the queue."""
    async with pool.connection() as conn, conn.transaction():
        cur = await conn.execute("UPDATE outbox SET state = 'pending', due_at = now(), last_error = NULL "
                                 "WHERE external_id = %s AND state = 'blocked'", (external_id,))
        return cur.rowcount

async def stats(pool, now):
    async with pool.connection() as conn:
        row = await (await conn.execute(
            '''SELECT count(*) FILTER (WHERE state IN ('pending', 'sending')) AS pending,
                      count(*) FILTER (WHERE state = 'blocked') AS blocked,
                      min(created_at) FILTER (WHERE state IN ('pending', 'sending')) AS oldest
               FROM outbox''')).fetchone()
    age = (now - row['oldest']).total_seconds() if row['oldest'] else 0
    return {'pending': row['pending'], 'blocked': row['blocked'], 'oldest_pending_age_s': age}

async def rebase(pool, external_id, first_revision):
    """Operator action for a 409 caused by the product holding a higher revision (e.g. restored backup).

    Renumbers this hazard's undelivered outbox rows (blocked first, in order) to start at first_revision,
    which the operator must set above the product's latest revision, then re-queues them. Delivered rows
    and their history are untouched. Returns the number of rows renumbered.
    """
    async with pool.connection() as conn, conn.transaction():
        rows = await (await conn.execute(
            "SELECT revision FROM outbox WHERE external_id = %s AND state <> 'delivered' ORDER BY revision", (external_id,))).fetchall()
        if not rows:
            return 0
        delivered = await (await conn.execute(
            "SELECT coalesce(max(revision), 0) AS top FROM outbox WHERE external_id = %s AND state = 'delivered'", (external_id,))).fetchone()
        if first_revision <= delivered['top']:
            raise ValueError(f"first_revision must exceed the last delivered revision {delivered['top']}")
        shift = first_revision - rows[0]['revision']
        for row in reversed(rows):  # highest first so renumbering never collides with an existing row
            new = row['revision'] + shift
            await conn.execute(
                "UPDATE outbox SET revision = %s, body = jsonb_set(body, '{revision}', to_jsonb(%s::int)), "
                "state = 'pending', due_at = now(), last_error = NULL, lease_until = NULL "
                "WHERE external_id = %s AND revision = %s", (new, new, external_id, row['revision']))
        await conn.execute(
            "UPDATE derived_hazards SET revision = %s, public_body = jsonb_set(public_body, '{revision}', to_jsonb(%s::int)) "
            "WHERE external_id = %s", (rows[-1]['revision'] + shift, rows[-1]['revision'] + shift, external_id))
        return len(rows)
