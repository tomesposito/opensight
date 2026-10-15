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
- `pendingCleanupBytes` — charged bytes across every non-deleted object.
- `pendingCleanup` — per object: `id`, `purpose`, `state` (`reserved`|`live`|`retiring`),
  `capacityBytes`, `bytes` (when bound), `nextReclamationAt` (ms epoch), `overdue`.
- `nextReclamationAt` — the earliest reclamation time across pending objects, null when
  nothing is pending. Per object it is `max(retention_until, created_at + 24h,
  signature_until + 10min)` — the same gate `ObjectLedger.retire()` enforces, so the
  reported time is the time the collector may actually act.
- `overdueCount` — retiring objects past their reclamation time. These are obligations
  the collector owes: the exact-version absence proof has not been recorded.

A namespace sees only its own rows. The operator command takes the tenant and
namespace explicitly; there is no cross-tenant listing.

## Explained quota error

`ObjectLedger.reserve()` throws `USAGE_LIMIT_EXCEEDED` (429) with a `detail` payload:

```json
{ "summary": "Storage limit 1 MiB exceeded: ... retained by 2 earlier upload attempt(s) ... next eligible reclamation 2026-10-15T...Z. Failed or cancelled uploads keep their reservation until the collector proves exact-version absence after the minimum 24-hour window; counters are never hand-edited.",
  "requestedBytes": 600000,
  "breakdown": { "limitBytes": 1048576, "metadataBytes": 0, "liveBytes": 0, "reservedBytes": 600000,
                 "pendingCleanupBytes": 600000, "pendingCleanupCount": 1, "overdueCount": 0,
                 "nextReclamationAt": "2026-10-15T..." } }
```

`MetadataError` carries an optional `detail` (third constructor argument). Both HTTP
serializers (`packages/api/src/index.ts` and the v1 `sendError`) include it; the v1
message uses `detail.summary` when present. `errorCode` stays `USAGE_LIMIT_EXCEEDED`
so existing clients keep matching on the code.

## Operator procedure: inspecting pending cleanup

Read-only diagnostic command (no writes, no locks beyond a reader):

```
node dist/storage-inspect-cli.js --tenant <id> --namespace <id> [--deployment <name>]
```

Database selection, in order:

- `OPENSIGHT_METADATA_DATABASE=<sqlite file>` — opened with `file:<path>?mode=ro`;
  any write attempt fails with "attempt to write a readonly database".
- `OPENSIGHT_METADATA_POSTGRES=<connection string>` — single `pg` connection with
  `default_transaction_read_only=on`; any write fails at the server.

The command prints the breakdown JSON on stdout. Exit 0 on success; a
`MetadataError` code on stderr with exit 1 otherwise (`STORAGE_INSPECT_USAGE`,
`STORAGE_INSPECT_CONFIG_INVALID`, `ENTITLEMENT_UNRESOLVED`).

Diagnosing a stuck workspace:

1. Run the command for the affected tenant/namespace.
2. `pendingCleanup` shows which objects still charge the quota and when each becomes
   eligible (`nextReclamationAt`).
3. `overdueCount > 0` means retiring objects are past eligibility and the collector has
   not recorded the exact-version deletion proof — that is a collector problem, not a
   quota problem. Do not touch counters; investigate the collector run for those
   object ids.
4. If `nextReclamationAt` is in the future, the quota is working as designed: the
   reservations release when the retention window expires. The 24-hour minimum hold
   is a protocol guarantee and must not be shortened to clear a test quota.

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
