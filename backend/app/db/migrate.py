"""Versioned SQL migrations, serialized by an advisory lock so concurrent starters cannot race.

Run standalone with `python -m app.db.migrate` (reads DATABASE_URL) or via the API lifespan.
"""
from pathlib import Path
import sys

import psycopg

MIGRATIONS = Path(__file__).resolve().parent / 'migrations'
LOCK_KEY = 7_262_026_001  # arbitrary constant shared by every product schema writer

def pending(conn):
    conn.execute('CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())')
    applied = {row[0] for row in conn.execute('SELECT version FROM schema_migrations')}
    return [path for path in sorted(MIGRATIONS.glob('*.sql')) if path.stem not in applied]

def migrate(url):
    """Apply pending migrations, each in its own transaction. Returns the versions applied."""
    done = []
    with psycopg.connect(url, autocommit=True) as conn:
        conn.execute('SELECT pg_advisory_lock(%s)', (LOCK_KEY,))
        try:
            for path in pending(conn):
                with conn.transaction():
                    conn.execute(path.read_text())
                    conn.execute('INSERT INTO schema_migrations (version) VALUES (%s)', (path.stem,))
                done.append(path.stem)
        finally:
            conn.execute('SELECT pg_advisory_unlock(%s)', (LOCK_KEY,))
    return done

if __name__ == '__main__':
    import os
    applied = migrate(os.environ['DATABASE_URL'])
    print('applied:', ', '.join(applied) or 'nothing (up to date)', file=sys.stderr)
