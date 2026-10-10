"""Operator commands: `python -m app.cli status|blocked|release <external_id>` (reads AUTOMATION_DATABASE_URL)."""
import asyncio
from datetime import datetime, timezone
import os
import sys

from . import db, outbox

async def main(argv):
    pool = db.make_pool(os.environ['AUTOMATION_DATABASE_URL'])
    await pool.open(wait=True, timeout=10)
    try:
        if argv[:1] == ['status']:
            print(await outbox.stats(pool, datetime.now(timezone.utc)))
        elif argv[:1] == ['blocked']:
            async with pool.connection() as conn:
                for row in await (await conn.execute("SELECT external_id, revision, last_error FROM outbox WHERE state = 'blocked' ORDER BY created_at")).fetchall():
                    print(row['external_id'], row['revision'], row['last_error'])
        elif argv[:1] == ['release'] and len(argv) == 2:
            print('released', await outbox.release_blocked(pool, argv[1]))
        else:
            sys.exit(__doc__)
    finally:
        await pool.close()

if __name__ == '__main__':
    asyncio.run(main(sys.argv[1:]))
