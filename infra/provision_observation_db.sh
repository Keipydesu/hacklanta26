#!/usr/bin/env bash
# Create the separate observation role and database on a database volume that already exists
# (a fresh volume gets them from infra/db/init/10-observations.sh). Safe to run again.
#   infra/provision_observation_db.sh
set -euo pipefail
. "$(dirname "$0")/lib.sh"
require_env_file
require_real_values OBSERVATIONS_DB_PASSWORD PRODUCT_DB_PASSWORD
[ "$(env_value OBSERVATIONS_DB_PASSWORD)" != "$(env_value PRODUCT_DB_PASSWORD)" ] || die "OBSERVATIONS_DB_PASSWORD must differ from PRODUCT_DB_PASSWORD"

note "ensuring the observations role and database exist"
# The password is forwarded through the environment and read inside psql, so it never appears on a
# command line or in output.
OBS_PW="$(env_value OBSERVATIONS_DB_PASSWORD)" compose exec -T -e OBS_PW db \
  psql -v ON_ERROR_STOP=1 --username product --dbname postgres >/dev/null <<'SQL'
\set password `printenv OBS_PW`
SELECT format('CREATE ROLE observations LOGIN PASSWORD %L', :'password')
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'observations') \gexec
SELECT format('ALTER ROLE observations PASSWORD %L', :'password') \gexec
SELECT 'CREATE DATABASE observations OWNER observations'
 WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'observations') \gexec
REVOKE CONNECT ON DATABASE product FROM PUBLIC;
REVOKE CONNECT ON DATABASE observations FROM PUBLIC;
SQL
db_admin --dbname observations -c 'CREATE EXTENSION IF NOT EXISTS postgis' >/dev/null

note "checking isolation: the observations role must not be able to open the product database"
as_observations() { PGPASSWORD="$(env_value OBSERVATIONS_DB_PASSWORD)" compose exec -T -e PGPASSWORD db psql --host 127.0.0.1 --username observations "$@"; }
if as_observations --dbname product -c 'SELECT 1' >/dev/null 2>&1; then
  die "the observations role can connect to the product database"
fi
as_observations -v ON_ERROR_STOP=1 --dbname observations -c 'SELECT 1' >/dev/null || die "the observations role cannot connect to its own database"
echo "observation database ready; the observations role has no access to the product database"
