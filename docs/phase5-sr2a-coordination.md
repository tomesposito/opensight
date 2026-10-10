# Phase 5 SR2a — frozen durable coordination contract

This is the first implementation checkpoint of #84, authorized under the
serverless development work. It implements D-23's durable admission and fencing
foundation. Artifacts, uploads, HTTP integration and D-24 recovery remain later
SR2/SR3 checkpoints. No application gate opens, no runtime migration runs
automatically, and no cloud resources change in this build.

## Boundaries and interfaces

Add an internal `DurableCoordinator` using the operator/membership `Database`,
the same `TenantMetadata` that minted the caller's context, a deployment ID and
an explicit `sqlite` or `postgres` dialect. No dependency is added. SQLite is the
local transaction test adapter; PostgreSQL is the deployed authority.

The coordinator receives server-derived context and invocation budgets, never
caller-selected tenant/owner, a database connection, SQL, resource path or fence.
Snapshot structured inputs before the first await. Return an immutable attempt
handle branded to its originating coordinator. A structurally forged handle or
one from another instance cannot publish, renew, revoke or release work.
Background recovery obtains a new admission; it cannot impersonate the old
process's worker-exit acknowledgement.

Internal methods are:

- `admit(context, input)`: input contains a UUID attempt ID, class `query` or
  `refresh`, current authorization/policy/configuration revisions, positive
  platform remaining milliseconds (at most 120,000), and an optional owner-bound
  source/prepared-dataset claim with its expected metadata version. A refresh
  requires that claim; a query cannot request one. Returns an attempt handle.
- `renew(handle)`: verifies current authority and extends only a live claim and
  attempt lease. At most one extension per 10 seconds; earlier calls return the
  unchanged lease. There is no background timer in this module.
- `publish(handle, work)`: rechecks all authority and fence conditions in a
  transaction and runs an internal SQL-only callback in that same transaction.
  The later artifact/operation modules use this boundary for atomic publication;
  this phase does not invent a manifest or expose a callback through HTTP.
- `revoke(handle)`: revokes the original attempt's publication rights. A matching
  claim advances its fence; an obsolete handle cannot revoke a replacement.
- `release(handle)`: records confirmed local worker exit and releases only that
  attempt's reservation. Callers must await worker/socket cleanup first. Logical
  cancellation or lease loss alone must never call release as proof of exit.

## Schema and migration

An explicit `migrateCoordination` runs in one frozen-maintenance transaction,
after SR1 metadata/auth/usage/budget initialization. It requires the matching
`sr_control` row in maintenance, schema/protocol 1 and the existing H8 schema.
It uses the same operation-scoped PostgreSQL advisory migration lock as SR1.
It does not change `sr_control`, activate keys, open admission or start workers.
Foreign pre-existing SR2a tables without the matching schema marker are refused.
Repeat migration verifies the schema marker and exact configuration; it cannot
silently replace limits or reset claims. Later limit changes require a separately
specified drain/migration operation.

| Table | Key and required fields |
| --- | --- |
| `sr_coordination_schema` | deployment FK to `sr_control`, version 1 and frozen DDL checksum |
| `sr_limits` | deployment PK/FK, revision 1, bound `h4_budget_config` version, validated entitlement JSON |
| `sr_admission` | `(deployment, attempt_id)` PK, random token UNIQUE, scope FK, owner, class, control epoch, limits revision, current revisions, immutable working/RSS weights, execution deadline, hold-until, lease-until, next-renew time, state `held/released`, revoked flag |
| `sr_claim` | `(deployment, tenant, namespace, owner, kind, resource)` PK, scope FK, monotonic BIGINT fence/generation, expected resource version, current attempt ID or NULL |

Claims are durable tombstones and have no cascading resource/user deletion.
Deleting/recreating a source cannot reset its fence. Admissions are retained in
this phase so an attempt ID can never be reused or charged twice. Later GC must
preserve an equivalent deduplication tombstone. No cleanup interval is added.

PostgreSQL enables and forces RLS on scoped tables with tenant/namespace policies.
The tenant role receives no grants on coordinator tables. The control repository
always supplies complete scope predicates despite using its separate operator
role. Configuration/marker tables are private. Migration never modifies roles.
Use parameterized values and constant SQL identifiers. Fences/generations are
returned as canonical decimal strings, avoiding BIGINT-to-JavaScript precision
loss; exhaustion fails closed instead of resetting or wrapping.

## Transactions, authority and admission

All coordinator mutations lock in this order: control row → SR2 limits row →
H4 budget row → tenant row → namespace revisions → resource/claim → attempt.
Use row locks in PostgreSQL and the existing SQLite immediate transaction.
The deployment configuration lock serializes aggregate reservations across all
functions, versions and tenants. A COUNT-after-check outside that lock is not
an admission algorithm. Existing H1 tenant edits need no coordinator lock; their
tenant-row serialization and revision increments invalidate publication.

Require an authentic `TenantContext`, active tenant, current authorization
revision, existing user, active H2 membership/identity, exact supplied revisions
and a recognized view role. Refresh additionally requires build capability and
an existing owner-scoped source/prepared dataset at the expected version.
Every renewal/publication repeats these checks, including current tenant state.
The HTTP/session or event layer remains responsible for its additional current
session/job authorization before invoking this internal boundary.

Admission requires `sr_control` open and schema/protocol 1, the matching SR2a
marker, and the exact bound H4 budget version. Capture the control epoch and SR2
limits revision. A maintenance state, epoch/config change or store failure denies
new work and publication. No cached budget, context or local bytes substitutes
for these authoritative reads.

Read and validate current H4 limits under the lock. Count all held reservations
whose hold-until has not passed, including revoked/expired-lease attempts. Honor
the configured tenant and deployment running, working-byte and worker-RSS caps,
and reserve the configured refresh slots from query traffic. Resource weights
are the caller tenant's whole H4 worker ceilings; do not undercount by using only
current RSS. This foundation does not enqueue: capacity denial keeps existing
`TENANT_BUDGET_EXCEEDED` / `NODE_ADMISSION_REFUSED` errors. D-24 later supplies
durable queue admission and expiry rather than process-local waiting closures.

Compute time comes from SQL (`clock_timestamp` in PostgreSQL, `julianday('now')`
in SQLite), not a caller clock. Execution deadline is SQL now plus the smaller of
the tenant execution cap and platform remaining time minus the reserved final
3 seconds. Subtract monotonic time spent waiting for admission from the supplied
platform remaining duration before calculating those deadlines; a lock wait must
not grant extra platform time. This elapsed duration is a containment adjustment,
not a replacement for SQL time as lease authority. Refuse nonpositive remaining
work and recheck SQL time before committing an admission. Hold-until is SQL now
plus the adjusted platform remaining time plus 10 seconds of quarantine. The lease is
the smaller of execution deadline and SQL now + 30 seconds; renewal cannot move
the execution or containment deadlines. Only a confirmed release or the hard
deadline plus quarantine permits aggregate capacity reuse.

A refresh atomically allocates the next claim fence/generation and binds its
attempt. A different live attempt returns `BLAZE_BUSY`; an expired claim may be
replaced only after the new attempt independently obtains aggregate capacity.
The old reservation remains counted. An existing attempt ID always returns
`ATTEMPT_ALREADY_ADMITTED`; duplicate delivery is resolved by the later durable
operation layer, never by executing the same attempt twice.

Preserve H8 usage units: queries do not become new compute charges in this slice;
each admitted refresh consumes exactly one daily `computeAttempts` unit in the
same transaction as its admission/claim. Read the migration-frozen entitlement
snapshot, fail unresolved tenants closed, and use the existing H8 counters/events.
Quota denial commits a denied usage event but creates no admission or claim.
Capacity/authority rejection creates neither a partial reservation nor a charge.

## Fencing and release

Publication/renewal require the original held, unrevoked attempt, live lease,
unexpired execution deadline, unchanged control/limits/H4 versions and current
authority/revisions. Refresh also matches claim attempt, fence, generation,
resource identity/version and ownership. A callback failure rolls back the
entire publication transaction. Recheck SQL time after the callback and before
commit so work cannot cross its lease/execution deadline inside the transaction.
Losing workers cannot publish success or failure. Unexpected database/driver
failures surface as `COORDINATION_UNAVAILABLE`, without raw SQL diagnostics.

Revocation uses token/attempt CAS and increments only its still-current claim's
fence, clears its attempt binding, and leaves capacity reserved. Revocation is
idempotent. At the maximum BIGINT fence, revocation still clears the binding and
revokes the admission without wrapping the counter; further admissions fail
closed with fence exhaustion. Release is
idempotent by token CAS, works even after authority has been revoked, and cannot
release a different attempt's row. Release also prevents later publication and
clears only its own claim binding while retaining its monotonic tombstone.
An expired/obsolete release must not alter a replacement's claim or reservation.

## Acceptance

Wire tests into root `npm test`, using real SQLite transactions and separate
coordinator instances over the same durable store. Prove aggregate and per-tenant
limits, reserved refresh capacity, atomic resource weights and exact usage,
duplicate attempts, admission rollback, caller mutation, forged/cross-instance
handles, tenant/owner/member/role/revision changes, maintenance/config changes,
lease loss, containment retention, replacement fencing and obsolete release.
Include exhausted-fence cancellation, admission lock-wait deadline loss and
expiry during a publication transaction.
Exercise actual callback rollback and simulated authoritative-store failure;
no successful stale response or partial reservation is permitted.

Migration tests prove frozen-only/idempotent behavior, foreign schema/config
refusal, unchanged maintenance and persistent fences across coordinator restart.
PostgreSQL integration tests exercise separate pools, RLS and overlapping
transactions when a dedicated test database is provided; otherwise they are
explicit live-Postgres skips. SQLite evidence alone is not Aurora acceptance.
Run the full root suite, rebuild/screenshot-compare the demo, record exact counts
and keep the runtime storage/dispatch gates closed. No public UI changes or new
bundled dependencies are part of this checkpoint.
