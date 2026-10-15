# Upload quota diagnostics (issue #91)

Follow-up to the live pilot's `USAGE_LIMIT_EXCEEDED` condition: a workspace reached
its 256 MiB limit after earlier failed synthetic upload attempts retained reserved
capacity. The reservation holds raw bytes plus the bounded native output allowance,
and a failed or cancelled attempt keeps its storage charged until the collector
proves exact-version absence after the minimum 24-hour window. This document
specifies the owner-visible breakdown, the explained quota error, the operator
inspection procedure, and the audited bounded maintenance operation (specified and
tested; not implemented — see "Maintenance" below).

## Usage breakdown contract

`describeStorage()` in `packages/api/src/storage-breakdown.ts` is the single source
of the numbers. It is read-only: it never inserts the `sr_storage_usage` row, it
scopes every query by `(deployment, tenant_id, namespace_id)`, and it validates
every identifier and counter before reporting.

Fields:

- `limitBytes` — the tenant's `storageBytes` entitlement from `sr_limits`.
- `metadataBytes` — H1 logical resource bytes for the namespace.
- `liveBytes`, `reservedBytes` — the committed gauge from `sr_storage_usage`.
- `totalBytes` — metadata + live + reserved (the value compared against the limit).
- `pendingCleanupBytes` — charged bytes without an active pin, operation, source,
  manifest or result reference. These are cleanup obligations, including reservations
  still inside their retention window. Healthy protected live objects are excluded.
- `pendingCleanup` — per object: `id`, `purpose`, `state` (`reserved`|`live`|`retiring`),
  `capacityBytes`, `bytes` (when bound), `nextReclamationAt` (ms epoch or null),
  `protections`, `overdue`.
- `nextReclamationAt` — the earliest reclamation time across pending objects, null when
  nothing is pending. Per object it is `max(retention_until, created_at + 24h,
  signature_until + 10min)`, extended by active pins, source/result expiry and running
  operations through the collector's shared `objectProtection()` rules. An indefinite
  manifest reference reports null. Times indicate eligibility, never completed deletion.
- `overdueCount` — unprotected objects past their eligibility time, including
  reservations not yet moved to retiring. This catches obligations never picked up.
- `protectedObjects`, `protectedBytes` — separately reported active storage, with
  named protections (`pin`, `operation`, `source`, `manifest`, `result`).
- The operator report additionally includes bounded cleanup event metadata, exact
  object keys/versions, ledger-derived totals and `gaugeMatchesLedger`. These private
  diagnostics are never returned by the upload error.

A namespace sees only its own rows. The operator command takes the tenant and
namespace explicitly; there is no cross-tenant listing.

## Explained quota error

`ObjectLedger.reserve()` throws `USAGE_LIMIT_EXCEEDED` (429) with a `detail` payload:

```json
{ "summary": "Storage limit 1 MiB exceeded: ... retained by 1 object(s) awaiting collector cleanup; next eligible reclamation ... Eligible times are not a promise of deletion. ...",
  "requestedBytes": 600000,
  "breakdown": { "limitBytes": 1048576, "metadataBytes": 0, "liveBytes": 0, "reservedBytes": 600000,
                 "pendingCleanupBytes": 600000, "pendingCleanupCount": 1, "overdueCount": 0,
                 "nextReclamationAt": "2026-10-15T..." } }
```

`MetadataError` carries an optional `detail` (third constructor argument). The hosted Lambda HTTP serializer publishes only `Message` from the quota-error
factory, after authentication; arbitrary `MetadataError.detail` stays private. The
existing browser client displays that safe explanation without transferring object
bytes or polling a failed reservation. The legacy and v1 serializers retain their
existing detail formats; the v1 message uses `detail.summary` when present. `errorCode` stays `USAGE_LIMIT_EXCEEDED`
so existing clients keep matching on the code.

## Operator procedure: inspecting pending cleanup

Read-only diagnostic command (no writes, no locks beyond a reader):

```
node dist/storage-inspect-cli.js --tenant <id> --namespace <id> [--deployment <name>]
```

Configure exactly one database:

- `OPENSIGHT_METADATA_DATABASE=<sqlite file>` — opened with the SQLite driver
  `readOnly: true` option and `query_only`, inside one read transaction. A missing
  file fails instead of creating a database; URI and in-memory paths are refused.
- `OPENSIGHT_METADATA_POSTGRES=<connection string>` — single `pg` connection with
  `default_transaction_read_only=on` and one repeatable-read, read-only snapshot.
  Set `OPENSIGHT_POSTGRES_CA` to the trusted PEM CA or
  `OPENSIGHT_POSTGRES_CA_FILE` to its path. TLS certificate and hostname verification
  are mandatory; URL query overrides such as `sslmode=disable` are refused. The
  connection is discarded on success and error. Connect is limited to 20 seconds,
  statements to 3 seconds, and the connected inspection to 25 seconds.

The command prints the breakdown JSON on stdout. Exit 0 on success; a
`MetadataError` code on stderr with exit 1 otherwise (`STORAGE_INSPECT_USAGE`,
`STORAGE_INSPECT_CONFIG_INVALID`, `ENTITLEMENT_UNRESOLVED`).

Diagnosing a stuck workspace:

1. Run the command for the affected tenant/namespace.
2. `pendingCleanup` shows cleanup obligations and their eligibility times. Review
   `protectedObjects` separately; active references and pins can extend retention.
3. `overdueCount > 0` means unprotected objects are past eligibility and the collector has
   not recorded the exact-version deletion proof — that is a collector problem, not a
   quota problem. Do not touch counters; investigate the collector run for those
   object ids.
4. If `nextReclamationAt` is in the future, the retention gate is still active.
   Expiry makes cleanup eligible; release still requires successful collector proof.
   The 24-hour minimum hold must not be shortened to clear a test quota.


## Private AWS inspection

Build the API, then package the exact diagnostic code with existing locked tooling:

```sh
npm run build --workspace=@opensight/api
node ops/serverless/storage-inspect-package.mjs /private/path/inspection-bundle
```

Zip the resulting `index.mjs` and `rds-ca.pem`. The operator creates a temporary
Node.js 24 ARM64 Lambda with handler `index.handler`, 60-second timeout, concurrency
one and the existing private dual-stack subnets/security group. Do not attach a
public URL, HTTP route or event source. Use a temporary dedicated execution role
with GetSecretValue for only the existing operator credential secret, required VPC
ENI permissions (deny ENI actions from application code), and only its own log group.
It needs no S3, SQS, Scheduler, IAM or database-admin permissions. Remove the
function, role/policy and log group after inspection; save receipts privately.

Inject `OPENSIGHT_DEPLOYMENT`, `OPENSIGHT_DB_HOST`, `OPENSIGHT_DB_PORT`,
`OPENSIGHT_DB_NAME`, `OPENSIGHT_OPERATOR_SECRET_ARN` as private environment
configuration. The handler loads credentials at invocation time, verifies TLS and
accepts only `{ "tenantId": "...", "namespaceId": "..." }`. It runs independently
of application startup/schema migrations and never writes the database.

The report is capped at 256 objects, 512 cleanup events and 256 KiB, with bounded
queries. Excess data fails with `STORAGE_INSPECT_LIMIT` rather than returning a
misleading partial total. Raw reports contain private object/event identifiers;
keep them outside repositories. Match event IDs against a bounded DLQ inspection
and check exact S3 object versions with read-only HEAD calls. Never redrive, delete
or adjust counters as part of inspection. A separate reviewed repair is needed
when obsolete/expired cleanup events require replacement.

## AWS acceptance and cleanup defect

The 2026-10-15 inspection is recorded in
[`phase5-issue91-aws-evidence.md`](phase5-issue91-aws-evidence.md). Both pilot gauges
matched their ledgers; no gauge adjustment was indicated. Cleanup had left charged
objects whose S3 versions were already absent.

`AwsObjectDeletion` now recognizes named S3 HEAD 404 responses inside the
`InvocationAws.call` callback. Previously the wrapper replaced those provider
errors with `AWS_REQUEST_FAILED` before the collector could classify absence.
The fix preserves general error redaction and rejects 403, unnamed 404, timeouts
and ambiguous responses. Tests exercise the actual wrapper, ledger release and
duplicate cleanup.

This fix does not revive expired events. Recovery of the existing obligations is
tracked separately in [#96](https://github.com/tomesposito/opensight/issues/96).
Do not blindly redrive them: current execution admission terminalizes expired
events before collector work, which can acknowledge messages without reclaiming
the charged storage.

## Maintenance: audited bounded recompute (specified, not implemented)

If a namespace's gauge ever disagrees with the ledger (the ledger rows are the source
of truth), the fix is a bounded, audited recompute — never a hand-edited counter.
`validateMaintenanceAdjustment()` in `storage-breakdown.ts` specifies and tests the
only permitted operation; there is no implementation yet, by design (the issue
requires specify-and-test before implementation, and the mutating op needs operator
review).

Rules the validation enforces (all covered by tests in
`packages/api/test/storage-breakdown.test.mjs`):

- Action must be exactly `recompute-gauge`; any other action is rejected.
- Exactly one scope: `(deployment, tenant_id, namespace_id)`, all identifier-validated.
- Ledger-derived values must be non-negative safe integers.
- A no-op (ledger values already equal the gauge) is rejected.
- The plan embeds an audit event naming the scope and both values, so any future
  implementation records what it wrote where.

When implemented (operator review required), the command will additionally require
the `frozen` maintenance gate and record the audit event in `h8_audit` before
writing. Deployment configuration and identities stay private to the operator
environment; none of it enters the repo.
