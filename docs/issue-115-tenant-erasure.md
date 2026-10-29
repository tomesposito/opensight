# Issue #115: tenant erasure

This implements the issue's supplied brief for the stopped single-node
`ReferenceMaintenance.deleteTenant` flow. The approved audit decision is
[IDD D-84](idd/D-84-tenant-erasure-audit-retention.md).

## Operator command

First request deletion through the existing operator tenant API, record its
operation ID, then drain and stop every API, scheduler and legacy writer.
The reference launcher takes the existing exclusive maintenance lock. Set
`OPENSIGHT_MAINTENANCE=frozen` and the normal private backup directory and keys.
The operation must be a deletion at `revoked`, `artifacts-removed`, `deleted`,
or `erasure-verified`; an active tenant cannot be erased directly.

`delete-tenant` defaults to a dry run:

```sh
OPENSIGHT_DELETE_MODE=dry-run node --env-file="$OPENSIGHT_RUNTIME_ENV" packages/api/dist/single-node-cli.js delete-tenant
```

`OPENSIGHT_DELETE_OPERATION` selects the operation. The JSON report includes
`tenantId`, `operationId`, `dryRun`, `status`, and `counts` with a store, action,
and count for each entry. Actions distinguish deletion, scrubbing, retained
records, and the backup deletion fence. `h1_resources.<kind>` entries break down
the `h1_resources` total and must not be added to it. A scrub count is the number
of rows whose tenant labels/configuration still require clearing. Backup file
counts include abandoned temporary files. Planning creates no registry,
directory, audit event, or database row and changes no existing file bytes.

After reviewing the report and resolving external copies, explicitly execute:

```sh
OPENSIGHT_DELETE_MODE=execute OPENSIGHT_DELETE_CONFIRM="$OPENSIGHT_ERASURE_TENANT" OPENSIGHT_BACKUP_COPIES=none node --env-file="$OPENSIGHT_RUNTIME_ENV" packages/api/dist/single-node-cli.js delete-tenant
```

The confirmation must exactly match the reported tenant ID. A missing or wrong
confirmation fails with `TENANT_ERASURE_CONFIRMATION_REQUIRED`. A mode typo
fails with `TENANT_ERASURE_MODE_INVALID`; unresolved external copies fail with
`BACKUP_COPIES_UNRESOLVED`. The programmatic equivalent is
`deleteTenant(operationId, 'none', { dryRun: false, confirmTenantId })`;
omitting options is read-only even if the external-copy assertion is supplied.

## Store coverage

| Store | Treatment |
| --- | --- |
| `h1_resources`, `h1_links` | Delete all tenant rows: datasets, prepared datasets, analyses, dashboards and versions, sources, encrypted upload payloads/credentials, policies, folders, users, AI config and all other kinds |
| `h2_onboarding`, `h2_invitations`, `h2_sessions`, `h2_memberships` | Delete tenant rows in dependency order |
| `h2_identities`, `h2_login_selections` | Delete identities exclusively belonging to this tenant and their login selections; preserve shared identities and unrelated orphans |
| `h5_embedding_config`, `h6_sessions` | Delete tenant embedding configuration and grants |
| `h7_jobs`, `h7_occurrences`, `h7_deliveries`, `h7_migrations` | Delete tenant jobs, execution and delivery state |
| `h8_usage`, `h8_usage_events`, `h8_ai_warnings`, `h8_recovery` | Delete tenant usage, warnings and recovery state |
| `analytics_events`, `analytics_settings` | Delete tenant analytics and settings |
| `h1_tenants`, `h1_namespaces` | Clear placement, limits, display name and slug; replace namespace name with `deleted`; retain lifecycle tombstone and namespace reservation |
| Managed backups | Fence deleted tenant independently of SQL; invalidate all snapshot registrations and remove all backup/temporary files, including snapshots of other tenants |
| Blaze cache | The stopped reference process has no surviving in-memory cache. In-process maintenance can supply all held `HostedCache` instances to `open`; their tenant entries are counted, purged and verified |
| `h8_audit`, `h1_outbox` | Retain audit history under normal retention, including deletion completion |
| `h1_operations`, `h1_revisions` | Retain opaque lifecycle/idempotency/authorization reservations |

Operator configuration, shared keys, schema/migration records, global hashed
authentication throttles, and opaque request idempotency records remain. Source
PostgreSQL databases are operator-owned external systems, not OpenSight asset
stores. The existing external-copy assertion and storage purge procedure still
apply to external exports, volume snapshots, WAL and physical media. This is
logical erasure, not a physical-media or compliance certification.

The standalone local-file demo and serverless runtime are separate storage
models. This command does not erase their stores. Discovery of serverless tables,
an unknown tenant/namespace-scoped table, or durable object-backed sources fails
closed with `TENANT_ERASURE_STORE_UNSUPPORTED`, listing the unsupported stores.
It performs no AWS calls. A serverless erasure implementation needs its own
object-version, dispatch and recovery fencing; this reference command does not
claim that implementation.

## Failure and retry semantics

Backup fencing precedes unlinking. Filesystem/cache deletion may finish before a
SQL failure; repeat the same confirmed operation after resolving the error.
An interrupted first registry write can be retried when only abandoned registry
temporary files remain; unregistered snapshots still fail closed.
SQL purge, independent row verification, lifecycle completion and the completion
audit receipt commit together. Silent leftovers cause
`TENANT_ERASURE_ORPHANS_REMAIN` with per-store counts on the error's `detail`;
the CLI prints those details and exits unsuccessfully. No completion receipt is
written for a failed attempt. Verification does not require parsing asset bodies
through authoring validators.

A successful operation records `erasure-verified` in its retained operation row.
An unchanged rerun rechecks stores and returns `noop` without changing database
rows or rewriting the registry. That marker survives audit retention. Legacy
`artifacts-removed` and `deleted` checkpoints are upgraded safely; an existing
completion audit entry is retained. Reintroduced tenant assets are purged on a
rerun, rather than being hidden by a completed operation marker.

## Verification

`packages/api/test/tenant-erasure.test.mjs` is included by the existing API test
glob, which is run by root `npm test`. Tests cover exact dry-run counts and
unchanged bytes, confirmation bypasses, all asset kinds, tenant isolation,
shared identities, silent orphan failures, audit-write failure, partial retry,
legacy checkpoints, interrupted registry initialization, symlink bypasses,
reintroduced assets, cache purge failures and audit-retention-independent no-ops.
See [verification and gap notes](issue-115-gap-notes.md) for final counts and
static-demo review.
