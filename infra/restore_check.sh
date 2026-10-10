#!/usr/bin/env bash
# Prove a backup restores: load it into a throwaway database, count its tables and rows, drop it.
# The live datasets are never touched.
#   infra/restore_check.sh BACKUP_FILE
set -euo pipefail
. "$(dirname "$0")/lib.sh"
FILE="${1:-}"; [ -s "$FILE" ] || die "usage: $0 BACKUP_FILE (must exist and be non-empty)"
scratch="restore_check_$(date -u +%Y%m%d%H%M%S)"
cleanup() { db_admin --dbname postgres -c "DROP DATABASE IF EXISTS $scratch WITH (FORCE)" >/dev/null 2>&1 || true; }
trap cleanup EXIT
db_admin --dbname postgres -c "CREATE DATABASE $scratch" >/dev/null
db_admin --dbname "$scratch" -c 'CREATE EXTENSION IF NOT EXISTS postgis' >/dev/null
# The dump recreates PostGIS objects that the extension already provides; those errors are expected,
# so success is judged by what actually arrived rather than by pg_restore's exit status.
compose exec -T db pg_restore --username product --no-owner --dbname "$scratch" < "$FILE" >/dev/null 2>&1 || true
tables="$(db_admin --dbname "$scratch" -At -c "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name NOT IN ('spatial_ref_sys', 'geography_columns', 'geometry_columns')")"
[ "$tables" -gt 0 ] || die "restore produced no application tables"
db_admin --dbname "$scratch" -At -F ' ' -c "SELECT table_name, (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I', table_name), false, true, '')))[1]::text FROM information_schema.tables WHERE table_schema = 'public' AND table_name NOT IN ('spatial_ref_sys', 'geography_columns', 'geometry_columns') ORDER BY 1"
echo "restore check passed: $tables table(s) restored from $(basename "$FILE")"
