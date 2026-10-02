#!/bin/sh
set -eu
# psql variables quote secret values as literals. Never use shell interpolation in SQL.
psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set=ON_ERROR_STOP=1 <<'SQL'
\getenv metadata_password OPENSIGHT_METADATA_PASSWORD
\getenv tenant_password OPENSIGHT_TENANT_METADATA_PASSWORD
CREATE ROLE opensight_metadata LOGIN NOSUPERUSER BYPASSRLS PASSWORD :'metadata_password';
CREATE ROLE opensight_tenant LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS PASSWORD :'tenant_password';
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
ALTER SCHEMA public OWNER TO opensight_metadata;
GRANT USAGE ON SCHEMA public TO opensight_tenant;
SQL
