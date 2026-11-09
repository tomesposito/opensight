# Hosted monthly usage (#154)

`HostedUsage` maintains a durable billing record in `h8_monthly_usage`, keyed
by `(tenant_id, namespace_id, period)`. `initializeUsage` creates the table
idempotently with a foreign key to `h1_namespaces`. This is the record shape
for the future Stripe integration (D-81); this slice does not invoice or charge.
API-call and query quotas are enforced per UTC calendar month (#225), using
the daily ledger directly; admission does not depend on a billing rollup.

## Monthly admission (#225)

`HostedUsage.consume()` sums admitted `apiCalls` or `computeAttempts` across
the tenant/namespace's daily rows from `YYYY-MM-01` through `YYYY-MM-31`.
Within the existing transaction, the active-tenant lock and authorization
revision check run before reading these counters. A total at or above the
entitlement denies the call with `USAGE_LIMIT_EXCEEDED` (429); zero denies
everything. Allowance resets at the next UTC month, with no overage.

Admissions and denials still increment today's row and append one event with
the call's timestamp. Every daily admitted/denied counter and the admitted sum
must be non-negative safe integers. Corrupt rows or an unsafe sum fail with
`ENTITLEMENT_UNRESOLVED` (503) and roll back all writes.

The operator overview reads the same live monthly API/query totals and labels
them with `period` (`YYYY-MM`). Its `day` field remains available, storage stays
a live gauge, and NLQ stays monthly. Prometheus gauges retain daily periods.
AI spend caps remain per UTC day; monthly AI credits and egress are unchanged.

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

Egress is **recorded from actual transfers**. `recordEgressBytes(scope, bytes)`
accepts an actual non-negative safe integer byte count and atomically updates
the daily admitted counter and appends an `h8_usage_events` row
(`metric: egressBytes`, `unit: byte`, `outcome: admitted`). It uses the
existing active-tenant serialization and scope checks. The hosted server
supplies it with the real response body bytes of authenticated tenant API
requests (the same population that consumes `apiCalls` there); it is counted
after the response is sent, never estimated from API calls. Operator,
health/metrics and pre-auth responses have no tenant context and are not
counted, and embed-session responses are not counted in this slice.
`egress.ts` remains an unrelated endpoint allowlist.

When the tenant's entitlement sets the optional `egressBytes` cap (#193),
egress is also **hard-capped per UTC calendar month**. The hosted path checks
the month's recorded admitted total before routing a tenant request
(check-before / record-after, like the AI spend cap): at or over the cap the
request is refused with `USAGE_LIMIT_EXCEEDED` (429) before routing and
before the `apiCalls` charge, and the refusal records no admitted bytes. The
response that crosses the cap is admitted and recorded in full; the next
request is denied. A tenant whose entitlement omits `egressBytes` is metered
but never denied by this gate. A recording failure after a response is sent
is surfaced as `EGRESS_RECORD_FAILED` on the server console rather than
hidden; the gate reads only durably recorded bytes, and corrupt or unsafe
monthly counters fail closed with `ENTITLEMENT_UNRESOLVED` (503).

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
object deployment. These routes add no tenant-plane route; the #193 egress
quota is enforced on the existing tenant API path, not through a new route.
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

Operators must retain the current month's API/query ledger rows for admission,
roll up completed months before pruning any of their daily source rows,
and keep daily rows through any required recomputation window. Recomputing
after daily retention only sees remaining rows and cannot reconstruct deleted
history. Reading an existing monthly record preserves its stored totals after
daily pruning. Restore quota fences remain unchanged; do not interpret a
restored day's conservative quota-fence counters as measured usage for charging.

Billing tables are private operator data. The meter stores scoped counts,
byte amounts and timestamps, never customer content. This slice sends no
analytics events externally; any future analytics egress must remain counts
and flags only under the usage-tracking rules.
