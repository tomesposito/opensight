# Operator audit schema migration (issue #123)

## What changed and why

`initializeAudit()` used to run `CREATE TABLE` / `ALTER TABLE` on every audit
append and read. The deployed runtime operator role intentionally has no `CREATE`
privilege on the schema, so the runtime path was broken, and concurrent first use
could race on PostgreSQL catalog creation.

As of this change:

- Audit DDL happens only in the controlled, serialized owner migration path
  (`migrateRuntime` / `migrateServerless`, under the advisory transaction lock).
  `initializeAudit()` applies the schema idempotently and records a
  version/checksum marker in the new `h8_audit_schema` table
  (`AUDIT_SCHEMA_VERSION`, `auditSchemaChecksum` in `operator-audit.ts`).
- Ordinary audit appends and reads do **no DDL**. Against a missing or legacy
  table they fail closed with `AUDIT_SCHEMA_NOT_MIGRATED` (503) instead of
  attempting schema changes the runtime role is not privileged for.
- The runtime operator role keeps `SELECT, INSERT, UPDATE, DELETE` on `h8_audit`
  plus `SELECT` on `h8_audit_schema` (deployment verification), and still has no
  schema `CREATE` right.

## Upgrade procedure (operator migration, Tom executes)

This goes through the separately reviewed operator migration — do not rewrite the
deployed baseline and do not broaden the code-only CI role. The release
compatibility digest changes with this release, so promotion requires the
migration below; production stays on the previously verified release until then.

1. Deploy the new release to the migration entry point and run the owner
   migration (`migrateServerless`) with `OPENSIGHT_MAINTENANCE=frozen`, as with
   previous promotions. It takes the advisory lock, applies the four additive
   columns (`actor`, `tenant_id`, `subject`, `detail`) to the deployed
   three-column `h8_audit`, writes the marker row, re-tightens the runtime
   grants, and appends the `serverless.migrated` audit entry.
2. Verify, as the schema owner:
   ```sql
   SELECT version, checksum FROM h8_audit_schema WHERE id = 1;
   -- expect: version = 1, checksum = <auditSchemaChecksum from the release>
   \d h8_audit
   -- expect: event_id, created_at, action, actor, tenant_id, subject, detail
   ```
   Legacy rows are attributed to the `deployment-operator` identity via the
   `actor` column default; no data is rewritten.
3. Verify the runtime role is still least-privilege:
   ```sql
   -- as the runtime operator role: this must fail with 42501
   CREATE TABLE audit_probe (id INT);
   -- this must succeed (one row: version = 1)
   SELECT version FROM h8_audit_schema WHERE id = 1;
   ```
4. Promote the release to the hosted deployment.

## Rollback procedure

The migration is strictly additive (four new columns with defaults, one new
marker table); no existing data is modified and no privilege is widened.

- **Rolling back the release does not require a schema rollback.** The previous
  release's `initializeAudit()` treats existing columns as no-ops
  (savepoint-guarded `ADD COLUMN`) and runs fine against the migrated table, so
  redeploying the previous release is sufficient. Do **not** drop the new
  columns — that would destroy audit detail written by the new release.
- The `h8_audit_schema` marker table is inert to the old release; leave it in
  place so a later re-promotion sees the correct version.
- If the migration itself fails partway, it runs inside the owner's single
  migration transaction: the advisory lock is released on rollback and no
  partial schema is left behind. Re-run the migration; do not hand-apply DDL.

## Contract notes for future schema changes

- Bump `AUDIT_SCHEMA_VERSION` and extend the canonical DDL list (which feeds
  `auditSchemaChecksum`) together with an explicit additive upgrade path.
- A marker mismatch fails the owner migration with `AUDIT_SCHEMA_MISMATCH`
  rather than silently running against a foreign schema.
- Runtime paths must never regain DDL: keep `CREATE` revoked on the schema for
  runtime roles, and keep the `AUDIT_SCHEMA_NOT_MIGRATED` fail-closed behavior
  covered by `operator-audit-postgres.test.mjs`.
