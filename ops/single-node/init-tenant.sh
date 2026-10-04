#!/bin/sh
# REFERENCE HARNESS: pilot, single-node, no HA claims; ephemeral Blaze.
# Actual deployment requires separate authorization. Run only by PostgreSQL initdb.
set -eu
# Never use shell tracing or print the secret. PostgreSQL owns and creates this role.
OPENSIGHT_TENANT_PASSWORD=$(cat /run/opensight-secrets/postgres-tenant-password)
export OPENSIGHT_TENANT_PASSWORD
psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --no-psqlrc --set=ON_ERROR_STOP=1 <<'SQL'
\set QUIET 1
\getenv tenant_password OPENSIGHT_TENANT_PASSWORD
CREATE ROLE opensight_tenant LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS PASSWORD :'tenant_password';
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
SQL
unset OPENSIGHT_TENANT_PASSWORD
