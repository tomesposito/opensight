# Operator audit schema migration (issues #123 and #131)

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

1. Verify the exact attested release and prepare an expiring, version-pinned
   `serverless-backup-lambda` runner. Keep owner credentials confined to that
   runner. Acquire the shared operation CAS, install the watchdog, stop admission
   and queue mappings, and drain invocations. Advance the independent epoch before
   transactionally freezing SQL. Bind the fixed plan and `quiescent` operation to
   that epoch; do not use the earlier empty-pilot bridge on retained data.
2. Invoke `command: snapshot` with the fixed snapshot plan. The runner recognizes
   exactly the legacy three-column audit table without a marker, or the current
   seven-column table with its exact marker. Other tables must still exist and be
   owned; partial audit shapes, marker views, altered defaults and foreign owners
   fail closed. The snapshot contains the actual inventory, pins retained object
   versions, verifies their S3 digests and key versions, and conditionally registers
   the encrypted snapshot under the independent registry head. Save its immutable
   version and checksum; never edit the snapshot to resemble the target schema.
3. Prepare the fixed `migrate` plan with that snapshot version/checksum and current
   registry epoch. Bind the new plan digest to the active operation and invoke
   `command: migrate`. `migrateRegistered` verifies the registered legacy inventory
   and preservation before calling `migrateServerless` with
   `OPENSIGHT_MAINTENANCE=frozen`. The owner transaction adds the four columns
   (`actor`, `tenant_id`, `subject`, `detail`), writes the marker, re-tightens runtime
   grants, checks preservation again, and records its receipt and audit entries.
   Source audit history and unrelated request receipts must remain exact. Only a
   committed matching receipt permits retry against the upgraded schema.
4. Verify, as the schema owner:
   ```sql
   SELECT version, checksum FROM h8_audit_schema WHERE id = 1;
   -- expect: version = 1, checksum = <auditSchemaChecksum from the release>
   \d h8_audit
   -- expect: event_id, created_at, action, actor, tenant_id, subject, detail
   ```
   Legacy rows are attributed to the `deployment-operator` identity via the
   `actor` column default; no data is rewritten.
5. Verify the runtime role is still least-privilege:
   ```sql
   -- as the runtime operator role: this must fail with 42501
   CREATE TABLE audit_probe (id INT);
   -- this must succeed (one row: version = 1)
   SELECT version FROM h8_audit_schema WHERE id = 1;
   ```
6. Promote the immutable release artifacts, reopen only under the same reviewed
   operation, run hosted acceptance, and record actual source, compatibility and
   configuration together. Remove the temporary runner and authority afterward.

The runner needs `GetObject` as well as conditional `PutObject` on its exact
maintenance receipt key. A retry compares an existing receipt without replacing
it; the SQL `replayed` observation may differ, but plan, registry, backup and
result identity must agree. Conflicting or unreadable evidence stays closed.
Ordinary deployment and maintenance workflow roles gain no new privileges.

## Rollback procedure

The migration is strictly additive (four new columns with defaults, one new
marker table); no existing data is modified and no privilege is widened.

- **The deployed legacy release needs no schema rollback.** Its
  `INSERT INTO h8_audit VALUES (?,?,?)` supplies the first three columns; PostgreSQL
  applies the trailing column defaults. The registered-upgrade PostgreSQL test
  exercises this exact statement under the restricted runtime role after migration.
  Preserve the new columns and marker when reverting immutable code/frontend
  artifacts. Do not infer compatibility for an arbitrary older release; verify
  the particular retained image before reopening it.
- The `h8_audit_schema` marker table is inert to the old release; leave it in
  place so a later re-promotion sees the correct version.
- If the migration itself fails partway, it runs inside the owner's single
  migration transaction: the advisory lock is released on rollback and no
  partial schema is left behind. Re-run the migration; do not hand-apply DDL.
- A registered legacy snapshot can also restore into a separately initialized
  current-schema target. Its audit rows use the target defaults and its verified
  audit marker remains in place. Existing tenant suspension, membership/session
  revocation, epoch/fence advancement and held delivery rules still apply. This
  is an isolated held restore, not automatic production rollback or cutover.

## Contract notes for future schema changes

- Bump `AUDIT_SCHEMA_VERSION` and extend the canonical DDL list (which feeds
  `auditSchemaChecksum`) together with an explicit additive upgrade path.
- A marker mismatch fails the owner migration with `AUDIT_SCHEMA_MISMATCH`
  rather than silently running against a foreign schema.
- Runtime paths must never regain DDL: keep `CREATE` revoked on the schema for
  runtime roles, and keep the `AUDIT_SCHEMA_NOT_MIGRATED` fail-closed behavior
  covered by `operator-audit-postgres.test.mjs`.
- `serverless-audit-upgrade.test.mjs` covers the registered legacy upgrade on
  PostgreSQL with retained metadata and object versions, SQLite compatibility,
  exact retries, receipt reconciliation, isolated held restore, ownership/schema
  tampering, post-backup writes and rollback after a late preservation failure.
