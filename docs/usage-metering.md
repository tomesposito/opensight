# Hosted monthly usage (#154)

`HostedUsage` maintains a durable billing record in `h8_monthly_usage`, keyed
by `(tenant_id, namespace_id, period)`. `initializeUsage` creates the table
idempotently with a foreign key to `h1_namespaces`. This is the record shape
for the future Stripe integration (D-81); this slice does not invoice or charge.
Existing #91 entitlement checks and daily quota enforcement are unchanged.

## Dimensions and periods

| Field | Unit | Meaning |
| --- | --- | --- |
| `apiCallsAdmitted` | call | Sum of admitted daily `apiCalls` |
| `apiCallsDenied` | call | Sum of denied daily `apiCalls` |
| `computeAttemptsAdmitted` | attempt | Sum of admitted daily `computeAttempts` |
| `computeAttemptsDenied` | attempt | Sum of denied daily `computeAttempts` |
| `storageBytes` | byte | Current logical storage gauge at rollup time |
| `storageAsOf` | UTC ISO timestamp or null | When storage was sampled; null means no rollup exists |
| `egressBytes` | byte | Sum of explicitly recorded daily `egressBytes` |

Periods are UTC calendar months in strict `YYYY-MM` form (years 0001–9999,
months 01–12). Daily rows use UTC `YYYY-MM-DD`. Only rows in the selected
month and tenant/namespace contribute; AI metrics do not enter these totals.
Denied calls and attempts are reported separately, without deciding whether
they are billable. Values and totals must be non-negative safe integers;
corrupt or unsafe values fail with `ENTITLEMENT_UNRESOLVED` (503).

`rollupMonthlyUsage(scope, month)` recomputes counters from daily `h8_usage`
rows and upserts the result, replacing rather than incrementing old totals.
Repeated runs with unchanged daily rows produce identical counters. New daily
rows appear on the next rollup. Rollups serialize with tenant writes and meters.

Storage is **never summed**: summing repeated byte gauges would count the same
stored data repeatedly. Each rollup samples `storageBytes(c, scope)`: H1 logical
resource bytes, plus reserved/live object bytes when an object deployment is
configured. It replaces `storageBytes` and `storageAsOf`. Even a past-month
rollup uses current storage, not a reconstructed month-end or byte-time value.
Thus a rerun can change the timestamp and storage snapshot without changing
the counters. This is a refreshable record, not an immutable invoice.

Egress is **recorded-only**. `recordEgressBytes(scope, bytes)` accepts an actual
non-negative safe integer byte count and atomically updates the daily admitted
counter and appends an `h8_usage_events` row (`metric: egressBytes`, `unit: byte`,
`outcome: admitted`). It uses the existing active-tenant serialization and
scope checks. No runtime surface currently calls it with real transfer counts;
no request/response estimates are made. Zero means no bytes were recorded,
not proof of zero traffic. `egress.ts` remains an unrelated endpoint allowlist.

## Operator access and D-81 record

The existing operator plane accepts these paths (no query strings):

- `GET /api/host/usage/YYYY-MM`: read stored records for all non-deleted tenants.
- `GET /api/host/usage/YYYY-MM/tenants/TENANT_ID`: filter to one tenant.
- `POST` to either path with `{}`: explicitly recompute and persist those records.

Every route requires `Authorization: Operator <key>` and no `Origin` header.
Tenant sessions, browser administrators and embed credentials cannot access it.
Invocation/serverless HTTP mode returns `RESOURCE_NOT_FOUND` (404), including
for valid operator credentials. Trusted operator processes can use the
`HostedUsage` methods directly with the operator database and the configured
object deployment. No additional tenant-plane route or quota is introduced.
Missing/malformed months return `USAGE_PERIOD_INVALID` (400); unknown/deleted
tenants return `TENANT_UNAVAILABLE` (403). A mismatched namespace fails with
`ENTITLEMENT_UNRESOLVED` (503). A hosted server without usage configured also
returns `ENTITLEMENT_UNRESOLVED` (503).

Responses have the shape `{ "period": "2026-10", "records": [...] }`, sorted
by tenant and namespace. Each D-81 record has these plain fields:

```json
{
  "tenantId": "tenant-example",
  "namespaceId": "example",
  "period": "2026-10",
  "apiCallsAdmitted": 42,
  "apiCallsDenied": 2,
  "computeAttemptsAdmitted": 7,
  "computeAttemptsDenied": 1,
  "storageBytes": 4096,
  "storageAsOf": "2026-10-29T00:00:00.000Z",
  "egressBytes": 0
}
```

`monthlyUsage(scope, month)` and `monthlyUsageForPeriod(month, tenantId?)`
read persisted records. Reads never refresh storage or mutate enforcement
counters. Before the first rollup, they return an explicit empty record with
all numeric fields zero and `storageAsOf: null`, even if daily counters exist.
Consumers must treat this as **unrolled, not measured zero**, and request a
rollup before billing. `rollupMonthlyUsageForPeriod(month, tenantId?)` refreshes
all matching scopes, each in its own transaction; a partially completed batch
can be retried safely. Suspended tenants remain reportable; erased tenants do not.

## Retention, recovery and privacy

Monthly records survive process restarts and daily usage/event retention.
They are included in single-node and serverless backups, restored as stored,
and removed with tenant erasure by single-node maintenance. Older backups
without the table remain accepted and restore without billing snapshots.
No time-based monthly pruning or automatic monthly scheduler is added.

Operators must roll up months before pruning any of their daily source rows,
and keep daily rows through any required recomputation window. Recomputing
after daily retention only sees remaining rows and cannot reconstruct deleted
history. Reading an existing monthly record preserves its stored totals after
daily pruning. Restore quota fences remain unchanged; do not interpret a
restored day's conservative quota-fence counters as measured usage for charging.

Billing tables are private operator data. The meter stores scoped counts,
byte amounts and timestamps, never customer content. This slice sends no
analytics events externally; any future analytics egress must remain counts
and flags only under the usage-tracking rules.
