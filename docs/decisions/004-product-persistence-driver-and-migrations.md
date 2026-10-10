# 004. psycopg 3 and plain SQL migrations for product persistence

- Status: Accepted
- Date: 2026-10-10

## Decision

The product API uses `psycopg` 3 (async, `psycopg-pool`) with hand-written SQL files in
`backend/app/db/migrations/`, applied in order by a small runner under a Postgres advisory lock.
`DATABASE_URL` selects PostGIS; when unset the stage 0 memory store remains for fixtures. Row locks
and unique constraints, not process memory, provide idempotency and revision ordering.

## Why

Three small packages (`psycopg`, `psycopg-binary`, `psycopg-pool`), no ORM or migration framework
transitive tree, and direct access to PostGIS functions. Pinned to psycopg 3.3.3 (Feb 2026) and
psycopg-pool 3.3.0 (Dec 2025) rather than the newest releases (Sep 2026) to allow community review;
review of install scripts/advisories is recorded in the PR description.

## Rejected

SQLAlchemy + Alembic: larger dependency surface for a two-table schema. Reintroduce if the schema
outgrows plain SQL files.

## Supersedes

None.
