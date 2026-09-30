# H1: tenant metadata and offline migration (#21)

H1 is the metadata foundation for the single-node hosted rollout. It adds no
operator HTTP API, sessions, source execution, hosted route composition, or
multi-node service. Existing self-hosted HTTP handlers still use the legacy
stores; do not expose them as the hosted tenant plane. H2 composes verified
sessions and provisioning, H3 integrates source authorization, and H7 assigns
legacy automation execution owners.

## Storage and access

`@opensight/api/metadata` exports the repositories, database adapters, schema
initializer, operator records, migration, and encryption helpers. SQLite uses
Node's built-in driver (no new dependency); PostgreSQL accepts an injected
existing `pg` pool. Both adapters use actual transactions and composite keys.

Each opaque tenant has one globally unique namespace and authorization, policy,
and configuration revisions. Resource keys include tenant, namespace, kind,
owner and portable ID. Prepared datasets retain owner scope. Relational links
are extracted from validated bodies into a table with composite foreign keys,
including grant principals, group members, datasets, source/secret bindings,
prep dependencies, invitations and preserved automation references. Definitions
retain their portable IDs/ARNs; these are never filesystem paths or grants.

`TenantMetadata.authenticate(credential, verifier)` accepts only a trusted
server verifier. It resolves the tenant from active namespace membership and
returns an immutable `{tenantId, namespaceId, userId, authorizationRevision}`.
Other repository accessors require that issued context and recheck membership,
lifecycle and revision inside each transaction. A copied/fabricated context is
rejected. Foreign and unknown resources return `RESOURCE_NOT_FOUND` (404).
Writes require administrator capability or build capability for owned resources.
Compare-and-swap versions prevent lost updates; failed batches roll back resource
rows, links, revisions and outbox together. Revision checks provide the seam for
later asynchronous publication checks and session/embed invalidation.

PostgreSQL requires separate privileged operator/membership and restricted
tenant pools. Initialize with `initializeMetadata(operatorDb, 'postgres')`;
construct the tenant adapter with `new PostgresMetadataDatabase(tenantPool, true)`.
Use a tenant login role with only SELECT/INSERT/UPDATE/DELETE on the `h1_*` tables
except `h1_migrations`, and no DDL, owner membership, superuser or BYPASSRLS.
The adapter rejects unsafe roles. FORCE RLS restricts every tenant table by
transaction-local settings; settings are reset before use and before pool
release, with a failed reset/rollback discarding the connection. Operator and
membership credentials must never reach tenant routes. These low-level DB and
operator objects are trusted capabilities, not authenticated tenant accessors.

## Lifecycle and outbox

`MetadataOperator` reserves the tenant, namespace, initial administrator and
operation atomically. Provisioning advances through `created`, `configured`,
`verified`, then `active`. The caller must perform/verify external work before
recording its checkpoint. H2 will supply the external-subject/session mapping
and operator-scoped idempotency keys; H1 issues no credentials. An operation ID
replays its payload hash or rejects reuse with different input. Suspend/resume
and deletion admission use the expected tenant version. Suspension and deletion
increment authorization revision. Deletion requires `artifacts-removed` before
removing resources, and retains the tenant/namespace, operation and tombstone.
This prevents namespace reuse and resurrection; retention policy remains H8.

Every committed lifecycle or metadata change appends a durable `h1_outbox` row
with an event ID, scope, type, revision and timestamp, without data contents or
secrets. No dispatcher runs in H1. Later consumers can use event IDs for dedupe
and reread current revisions; delivery/acknowledgment belongs to a later slice.

## Maintenance migration

Stop the API and its scheduler, drain all writers, and keep them stopped through
migration and cutover. This is an explicit offline operation, not a live upgrade.
Existing instances can still hold read snapshots, so file markers alone are not
a substitute for stopping the process. Put runtime configuration, database and
backups outside the repository, or under the ignored `.opensight/` directory.

Supply a `LegacyMigrationConfig` JSON file through
`OPENSIGHT_METADATA_MIGRATION_CONFIG`. It contains:

- `migrationId`, `maintenance: true`, and `backupDirectory`.
- `securityPath`, plus each configured `prepPath`, `aiPath`, `automationPath`.
  Export any intentionally migrated in-memory settings before stopping the API;
  H1 cannot discover omitted stores or transient uploads.
- `namespaces`: one explicit `{namespaceId, tenantId, purpose, dataRoot?}` per
  registered namespace. Generate UUID tenant IDs; purpose is `self-hosted` or
  `customer`. `default` has no automatic mapping. Repository fixture roots may
  only be mapped as self-hosted. Never point a customer mapping at copied fixture
  data; the path check cannot determine the provenance of arbitrary copies.
- `securityColumns`: the bound columns used to validate legacy policies.
- `datasets`: explicit `{namespaceId, id, arn, definition, sources}` bindings.
  `sources` contains scoped resource keys, not imported ARNs.
- `sources`: explicit `{namespaceId, id, ownerId?, binding}` records. Bindings
  reference environment configuration, never plaintext credentials. Include every
  prep owner/source; unresolved ephemeral uploads require repair or reimport.
- `compatibleBaseUrls` when encrypted compatible-provider settings require it.

Set `OPENSIGHT_METADATA_DATABASE` to the SQLite metadata file and, if migrating
saved AI keys, supply the existing `OPENSIGHT_AI_ENCRYPTION_KEY` through the
environment. H1 authenticates the legacy AES-256-GCM envelope and reencrypts it
with tenant/namespace/owner/secret-ID associated data. Neither the key nor
plaintext enters the database, reports or backups. Backups retain encrypted
legacy values and all other original input bytes, so protect them as private
deployment data. No source is opened and no Blaze snapshot is marked ready.

After building the API, run from the repository root:

```sh
npm run metadata:migrate --workspace @opensight/api -- migrate
# Review the returned counts/checksum and the private versioned backup.
npm run metadata:migrate --workspace @opensight/api -- seal
```

PostgreSQL migrations use the same `MetadataMigration` library with the
privileged adapter instead of the SQLite CLI. There is no HTTP migration route.

The migration freezes every input with a durable marker under a single-node
SQLite file lock. Existing legacy writers reject frozen files, and subsequent
legacy startup rejects frozen definition roots/stores. Use the same canonical
paths throughout maintenance. A backup-directory lock serializes maintenance
commands; process death releases locks without PID-file recovery. Symlinks and
overlapping input/backup roots are rejected.

Inventory validates IDs, references, administrators, prep dependencies and
policy/ARN bindings before any tenant commit. Invalid rows cause failure for
operator repair; nothing is dropped. The versioned `h1-v1-<migrationId>.json`
backup is mode 0600, atomically saved and fsynced before commit. It records input
bytes/checksums and the validated plan. The database/report contains counts and
checksums, not data contents. Modified inputs or backup checksums reject resume.
The CLI prints only safe error codes; fix the source offline after rollback.

All migrated tenants/resources/outbox records commit in one transaction while
tenants remain `provisioning` with a `migration-held` operation. They cannot
authenticate yet. Repeat `migrate` with identical configuration after interruption;
uncommitted rows roll back and committed work replays without duplication.
Legacy refresh/report/alert records stay in the explicitly mapped default tenant,
retain their original record, and carry `executionDisabled: true` until H7.

`seal` atomically activates every migrated tenant and is the rollback boundary.
It is an explicit operator assertion that the inventory is ready for the later
hosted composition. H1 itself still provides no hosted HTTP server. Before seal:

```sh
npm run metadata:migrate --workspace @opensight/api -- rollback
```

Rollback removes only this migration's unserved metadata and outbox, retains its
audit record/backup, and unfreezes unchanged legacy files (they were never
rewritten). It is resumable. Use a new migration ID after repair. After seal,
rollback is rejected and the legacy stores stay frozen: do not dual-write or
restart the legacy server against them. Post-cutover recovery requires an
operator backup/restore procedure that preserves deletion tombstones, not replay
of an old migration. Retention/backup purge decisions remain outside H1.
