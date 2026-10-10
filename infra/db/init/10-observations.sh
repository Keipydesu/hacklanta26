#!/bin/sh
# Runs once, when the database volume is first created. Creates the separate observation dataset
# for the optional automation profile: its own role and database, no access to the product
# database. For a volume that already exists use infra/provision_observation_db.sh instead.
set -eu
if [ -z "${OBSERVATIONS_DB_PASSWORD:-}" ]; then
  echo "observation database not created: OBSERVATIONS_DB_PASSWORD is empty (manual stack only)"
  exit 0
fi
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<'SQL'
\set password `printenv OBSERVATIONS_DB_PASSWORD`
CREATE ROLE observations LOGIN PASSWORD :'password';
CREATE DATABASE observations OWNER observations;
REVOKE CONNECT ON DATABASE product FROM PUBLIC;
REVOKE CONNECT ON DATABASE observations FROM PUBLIC;
SQL
# The service's own migration says CREATE EXTENSION IF NOT EXISTS; creating it here as the
# administrator means the observation role never needs superuser rights.
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname observations -c 'CREATE EXTENSION IF NOT EXISTS postgis'
