---
status: 🚧 Draft
owner: Tom Esposito
date: 2026-10-10
labels: [itd]
---

## Purpose

Replace H8 process-lifetime guarantees before Lambda can serve tenant work.

## Scope

SQL cleanup, durable admission/claims, asynchronous artifacts and invalidation.

The [SR2a build contract](../phase5-sr2a-coordination.md) now freezes the first
coordination checkpoint. It binds existing H4 budget versions in `sr_limits`
rather than duplicating per-tenant budget configuration, preserves existing H8
refresh accounting and named admission errors, and leaves queues/artifacts and
runtime integration to subsequent contracts. Its exact schema/interfaces govern
that checkpoint. The [SR2b artifact transfer contract](../phase5-sr2b-artifact-transfer.md)
freezes the bounded codec and immutable-object mechanism. The broader
manifest/invalidation and runtime-integration proposal below remains draft.

## Out of Scope

Changing query semantics, metadata engines, owner-only prep or HA commitments.

### 🚧 ITD D-23 — What durable state makes process replacement and overlap safe?

#### CONTEXT

`PostgresMetadataDatabase.close()` currently leaves pool ownership to its caller.
H8 holds a lifetime advisory lock, and budgets/Blaze live in process memory.
H9/H10 already require immutable artifacts, authoritative revision checks and
fenced publication. Lambda may freeze or replace a process; old/new versions
and API/background workers can overlap even when one function's concurrency is 1.

#### THE PROBLEM

How should bounded invocation resources and durable SQL state replace process
identity as the authority for admission, artifacts and publication?

#### OPTIONS CONSIDERED

1. [WIP] Invocation-owned connections and PostgreSQL transactions for global/
   tenant admission, monotonic fencing and immutable artifact manifests.
2. [WIP] Keep warm pools/local budgets and reserve one concurrent invocation.
3. [WIP] Add an always-on distributed coordinator for leases and counters.

#### REASONING

Option 1 is proposed and follows the SR0 plan's initial PostgreSQL coordinator.
It adds short transactions but avoids another idle service and places checks
beside authoritative metadata. Option 2 fails on process death and overlaps
across functions/versions; it is not a correctness option. Option 3 could improve
coordination throughput later but adds cost and still needs SQL publication
fencing and revision checks; no demand measurement justifies it here.

#### IMPLICATIONS

**Invocation lifetime:** the Lambda composition must not construct H8's launcher,
acquire its lifetime lock, run migrations/key activation or start interval jobs.
At entry create a resource scope owning every pool/client, source connection,
worker, timer, object stream and temporary path. Membership/control and restricted
tenant pools have separate credentials and `max:1` each. Close connections after
each short transaction when no immediate SQL work remains; keep none across
artifact fetch/analytics/network mail waits. Never cache a transaction or tenant
context globally. A configuration-only factory may be reused.

Retain BEGIN/COMMIT/ROLLBACK, unsafe-role rejection, transaction-local tenant/
namespace settings and RESET ALL. The outer owner must additionally call pool
`end()`; releasing a client or `callbackWaitsForEmptyEventLoop=false` does not
close it. One invocation cannot borrow another invocation's pool. All connect,
query and source I/O have cancellation and remaining-deadline bounds. A timed-out
connect must destroy its socket even if its promise resolves late.

On success, rejection, timeout, client abort or handler exception: abort workers,
await exit, close streams, roll back/discard clients, end pools, remove sensitive
temporary files and clear timers before returning. Reserve D-21's final 3 seconds;
after a bounded graceful phase force-kill children and destroy sockets. If cleanup
cannot prove completion, return failure if possible and terminate/quarantine the
runtime, never reuse it as healthy. Entry also clears remnants of an interrupted
invocation before accepting work. Hard process kill cannot execute finally;
durable leases, server-side statement/idle timeouts and orphan cleanup handle it.
No claim of a successful finally on platform termination is permitted.

Set metadata statement timeout ≤2s, lock timeout ≤500ms, idle-in-transaction
timeout ≤3s and idle-session timeout ≤5s for runtime roles, adjusted only by a
reviewed readiness budget. Bound source SQL separately by H4 execution remaining
time. No RDS Proxy, unbounded pool idle timeout, lifetime advisory lock or startup
readiness polling. Maintenance uses a separate entrypoint and role.

**Proposed durable schema (names are new, not shipped migrations):**

| Table/key | Required fields and invariants |
| --- | --- |
| `sr_control` singleton | maintenance epoch, admitted schema/protocol range, state `open/draining/maintenance`; lock before admission |
| `sr_admission` `(deployment, token)` | scope/owner, operation/attempt, class, resource weights, admitted time, execution deadline, non-reusable-until, state; unique live attempt |
| `sr_scope_budget` `(deployment, tenant)` plus deployment row | versioned H4 ceilings; atomic accounting for all API/job functions and versions |
| `sr_claim` `(tenant, namespace, owner, kind, resource)` | monotonically increasing BIGINT fence, attempt UUID, lease deadline, generation, state; never reset fence on delete/recreate |
| `sr_manifest` `(tenant, namespace, owner, dataset)` | generation/fence/state, definition/policy/source/dependency revisions, invalidation epoch, object key/version/SHA-256, format/schema, rows/encoded/decoded bytes, refresh time/provenance, safe failure code |
| `sr_invalidation` `(scope, epoch, resource)` | tombstone/walk progress and revision cause; namespace gate prevents stale descendants while walk pending |

Use composite scope foreign keys and RLS for tenant-readable records. Coordinator
tables are not writable by the tenant SQL role; a narrow control repository
validates active membership/owner using server-derived scope before mutation.
No unscoped query supplied by a request. Parameterize identifiers/values and
never embed S3 paths in imported definitions. Migration tests exercise restricted
and control roles separately on real PostgreSQL/Aurora.

**Admission algorithm:** use one short transaction with lock order control →
deployment budget → tenant → namespace revisions → resource claim → operation.
Use a deployment budget row lock to serialize aggregate slot/byte reservations;
COUNT-after-check without that serialization is forbidden. Validate active tenant,
current owner/policies, H8 entitlement, maintenance/schema gate, durable running/
queued counts and aggregate reserved resource weights. Atomically insert the
admission row and claim only if every limit permits. A failure leaves no partial
reservation. Database time, not worker time, decides lease validity.

Proposed initial aggregate limits are 2 running workers/deployment, 1/tenant,
one refresh slot reserved from query traffic, 8 queued/deployment and 4/tenant.
H4 per-worker and H8 usage gates still apply; these are candidate settings for
measurement, not capacity promises. Queues store authorized operation IDs, never
closures/credentials. Denial retains `TENANT_BUDGET_EXCEEDED`,
`NODE_BUDGET_EXCEEDED` or `USAGE_LIMIT_EXCEEDED`; async queue expiry is 120s.
Count compute attempts once per durable attempt; duplicate event delivery does
not create usage twice, but a new executed retry consumes a new attempt.

**Lease and containment distinction:** a worker gets a 30s logical lease and
renews with a short fenced transaction at most every 10s only while actively
working. Renewal cannot extend the immutable invocation execution deadline.
Lease loss revokes publication immediately and cancels local work. It does not
prove the old process stopped: hold its aggregate resource reservation until
confirmed worker exit or the platform hard deadline plus 10s quarantine. A retry
may claim a higher fence but cannot start until it separately obtains capacity
while that old reservation is still counted. This prevents expired leases from
creating unlimited overlapping resource use. Healthy exit releases by token CAS;
late cleanup cannot release a replacement's reservation. Expiry/recovery events
are armed through D-24, not an idle database sweeper.

**Refresh/publication protocol:** acquire admission and a per-dataset fence for
both manual and scheduled refresh. Increment generation; atomically set running,
remove old readable authority and append invalidation/outbox. Use bounded worker
batches to write complete immutable Parquet, recording exact source/dependency
versions. Verify uploaded object version/digest before publication. Final SQL CAS
must match scope, attempt, fence, generation, lease still valid, unchanged revisions,
active tenant/owner, no cancellation and compatible maintenance epoch. Require
one updated row. In the same transaction publish ready manifest and completion
outbox; failure publication has the identical fence conditions. A losing worker
can only discard its own objects; it cannot publish failure over a newer success.

**Asynchronous seam:** define internal `read(key, context, signal) → Promise<handle>`
and `refresh(key, context, load, signal) → Promise<status>` adapters. A handle
offers bounded batch/column access plus async disposal; it contains provenance
and verified manifest identity, never authorization reusable across requests.
Keep the local in-memory adapter for H8. Convert every compiler/evaluator/prep/
report caller that needs hydration to await it; do not claim the synchronous
`BlazeTable` method can perform network I/O unchanged.

Before any read, load current authorization/revisions/manifest from PostgreSQL.
Hydrate only ready artifacts into an invocation-private temporary path; enforce
encoded, decoded, row, column and schema bounds, then SHA-256 and scalar semantics
before atomic local promotion. Cache identity includes tenant/namespace/owner,
dataset/generation/version/digest. Do not deduplicate across tenants. Default
serverless profile disposes sensitive local bytes at exit; later measured warm
cache reuse still needs fresh SQL checks and bounded eviction. No memory-mapping
or zero-copy benefit is assumed without a measurement.

Recheck revisions and authority immediately before result publication. Save,
mode switch, source expiry/delete, policy change, owner removal and suspension
atomically invalidate affected manifests and advance the invalidation epoch.
For large dependency graphs, first block the namespace's artifact publication/
read gate, then walk descendants in bounded durable batches; reopen only after
the walk is complete. Preserve explicit freshness of valid cached dependencies
and original refresh timestamps; do not substitute live sources on a miss.
Outbox invalidations only accelerate eviction. Lost/reordered notifications
cannot confer authority. Metadata unavailable means no protected result, even
if the bytes and signature are valid. Keep H9's named Blaze states/errors.

Object GC requires no current manifest or backup pin and a 24h grace longer than
any reader/worker deadline. Security tombstones/fences and backup registry outlive
object cleanup. A restore cannot reset fence epochs or revive deleted authority.

**Acceptance:** fault injection at connect/BEGIN/COMMIT/RESET/end, late connection
resolution, process termination, two tenants with equal resource IDs, concurrent
API/background admission, expired-but-running worker, late release/failure,
delete/recreate, old/new schema versions, missing invalidation, paused metadata,
corrupt/partial/oversize artifacts and revocation during hydration. Differential
queries/prep/reports must match local Blaze/DuckDB/PostgreSQL semantics and
provenance. Real Aurora role/RLS and hard-timeout behavior remain SR5 gates.

Evidence: [H9/H10 contract](../hosted-architecture.md#5-scaling-plan),
[Lambda lifecycle](https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtime-environment.html).
