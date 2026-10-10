"""Private observation database: pool plus advisory-locked SQL migrations (AUTOMATION_DATABASE_URL only)."""
from pathlib import Path

import psycopg
from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool

MIGRATIONS = Path(__file__).resolve().parent / 'migrations'
LOCK_KEY = 7_262_026_002  # distinct from the product DB's key; they are separate databases anyway

def migrate(url):
    done = []
    with psycopg.connect(url, autocommit=True) as conn:
        conn.execute('SELECT pg_advisory_lock(%s)', (LOCK_KEY,))
        try:
            conn.execute('CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())')
            applied = {row[0] for row in conn.execute('SELECT version FROM schema_migrations')}
            for path in sorted(MIGRATIONS.glob('*.sql')):
                if path.stem in applied:
                    continue
                with conn.transaction():
                    conn.execute(path.read_text())
                    conn.execute('INSERT INTO schema_migrations (version) VALUES (%s)', (path.stem,))
                done.append(path.stem)
        finally:
            conn.execute('SELECT pg_advisory_unlock(%s)', (LOCK_KEY,))
    return done

def make_pool(url, size=10):
    return AsyncConnectionPool(url, min_size=1, max_size=size, open=False, kwargs={'row_factory': dict_row}, timeout=5)
