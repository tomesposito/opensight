# H4 (#24): single-node budgets and containment

H4 adds an operator-configured admission gate after H3 authorization. No product
limits, tiers or entitlements are supplied. HQ-8 remains open. No dependencies
were added. This is a backend slice; the static demo has no hosted execution.

## Execution and admission

A single `TenantBudgets` instance serves the hosted node. Verified context objects
are checked by H1's identity registry; copied, missing and foreign contexts fail.
H3 checks source ownership, policy, columns and the entire prepared graph before
queue admission. Rejected submissions open no connector, load no payload, change
no cache and make no durable write. Authentication/authorization metadata reads
necessarily precede this decision. HTTP body intake retains its existing bound.

Each tenant has a bounded FIFO queue. A bounded node total covers all tenant
queues. Tenant round-robin scheduling uses equal turns, with an explicit node
refresh reserve; refreshes may pass queries waiting for the general pool.
Concurrent work also reserves its configured working-memory and worker-RSS
allowance against node ceilings. A waiting tenant keeps its turn while memory
reservations drain; smaller jobs cannot continually bypass it. A running slot
remains charged through cleanup,
including subprocess reaping and PostgreSQL cancellation. Queue expiry is
`QUEUE_WAIT_EXCEEDED`; capacity refusal is `TENANT_BUDGET_EXCEEDED` or
`NODE_ADMISSION_REFUSED`. No capacity is inferred for an unconfigured node.

At dequeue and publication, the gate rechecks source/graph revisions and the
current verified HTTP session. H3 named denials remain authoritative under load.
Accounting records running/queued counts, peaks, completed/cancelled/rejected
work, elapsed execution and queue time, source rows, working bytes, worker starts
and sampled worker RSS. `snapshot(tenantId)` and `node()` expose these internal
operator measurements; there is no new tenant-accessible metrics endpoint.

| Reachable hosted path | Containment |
| --- | --- |
| PostgreSQL source query, preview, rows/output and raw Blaze fill | Dedicated read-only cursor; server statement timeout; request/deadline cancellation through a separate `pg_cancel_backend` connection; original backend held until cancellation completes, then closed |
| Uploaded source direct/cached reads; prepared graph, preview and refresh | Disposable process owns DuckDB; one DuckDB thread, explicit memory budget, no external access, extension install/load or disk spilling |
| Interactive aggregation over source/prepared results | Same disposable process owns the synchronous shared evaluator |
| Upload parsing | Admission before parsing; disposable process; cancellation checked before the atomic source/secret write |
| File intake and IPC table construction | Bounded row/cell/byte accounting with cooperative yields every 256 rows |
| Discovery and AI schema | Existing H3 metadata-only authorization; no worker execution |
| Generative AI execution, hosted scheduled reports/alerts/refresh and legacy query/embed routes | Still unavailable in hosted mode; cannot reach fixture executors or ownerless schedulers |

The fixture server's DuckDB/PostgreSQL/MySQL executors and legacy scheduler remain
separate from the hosted router. H4 does not turn those development paths into
verified hosted entry points. A future hosted path must enter this admission gate.

Cancellation returns `EXECUTION_CANCELLED`, never a partial payload. The parent
kills and reaps compute processes; an independent watchdog thread also kills a
blocked evaluator on deadline, excessive RSS or API-parent death. Credentials and
metadata paths are absent from the compute child's environment. Linux procfs
must expose the node's PID namespace; otherwise compute refuses with
`WORKER_CONTAINMENT_UNAVAILABLE`. An unobservable RSS value is not treated as zero.

The hosted source/prepared cache shares one accounted node store. It evicts only
within the requesting tenant, refuses when node capacity remains unavailable,
and removes previous readability before refresh. Failed/cancelled refreshes and
failed final checks invalidate their publication. There is no half-filled or
known-stale snapshot advertised as current. Entry overhead counts toward capacity.

Source pressure means rows delivered by the source cursor, decoded upload intake
or cached input reads, accumulated across a whole prepared graph. PostgreSQL's
cursor exposes neither scanned rows nor executor cost: these metrics do **not**
claim physical rows scanned. A refused sentinel row can count as observed pressure;
it is never returned. Each execution opens at most one data connection at a time;
PostgreSQL cancellation can temporarily add one bounded control connection.

## Frozen configuration and restart

`h4_budget_config` stores a versioned, validated configuration atomically in the
operator metadata database. Runtime startup never creates or guesses it. Stop the
node, provide `OPENSIGHT_METADATA_DATABASE`, `OPENSIGHT_MAINTENANCE=frozen`,
`OPENSIGHT_NODE_LIMITS` and `OPENSIGHT_TENANT_LIMIT_DEFAULTS`, then run:

```sh
npm run budgets:migrate --workspace=@opensight/api
```

Both limits variables contain JSON objects. Tenant overrides, when needed, enter
through `OPENSIGHT_TENANT_LIMIT_OVERRIDES` as a JSON object keyed by tenant ID.
Every limits object requires `running`, `queued`, `executionMs`, `queueMs`,
`sourceRows`, `resultBytes`, `workingBytes`, `cacheBytes`, `workerRssBytes`,
`workerHeapMb`, `duckdbMemoryMb`, and `cellChars`. The node additionally requires
`refreshSlots` (at least one, fewer than `running`). Limits use integer bytes,
rows, milliseconds and MiB as indicated. Only queue capacity may be zero.
Tenant/default values cannot exceed node ceilings. Node memory/RSS fields also
bound the sum of active execution reservations. The checked-in test helper is a
synthetic measurement configuration, **not** a recommended product configuration.

The CLI node and migration command share an OS-released SQLite lifetime lock.
Graceful shutdown cancels/drains work before releasing it. Embedded server or
PostgreSQL-adapter operators must likewise stop their sole node before invoking
the maintenance API; this is not a distributed coordinator. Unknown tenant IDs
and unresolved legacy `h1_tenants.limit_policy` values require repair, not deletion.
Explicitly mapped legacy values are cleared in the same transaction as cutover;
there is one authoritative store. An interrupted transaction preserves the prior
configuration. Missing/invalid stores refuse startup.

Restart reloads the same configuration and admission decisions. Counters and
queues are intentionally process-local, and ephemeral caches start empty. Work
is never replayed from old closures or trusted because an old process admitted
it. New verified identities, H3 gates and resource admission are required again.
Orphaned compute processes terminate independently; source sessions close and
also have server-side timeouts. This is single-node containment, not H10 failover.

## HQ-8 measurements and proposed regression triggers

The deterministic contention scenario uses two tenants, 4,096 synthetic rows per
query, one general execution slot plus one reserved refresh slot, one execution
per tenant, four queued jobs per tenant and twelve node queue entries. Tenant A
submits one running query plus sixteen contenders; twelve are refused. Tenant B
submits one query while A is saturated. Cross-tenant, missing-context and protected
source bypasses are attempted during the flood and produce H3 denials without
source I/O. Source usage is exactly 20,480 rows for A and 4,096 for B.

The local Linux x64/Node 24.20.0 regression run after process isolation measured:

| Measurement | Observed | Checked regression ceiling / proposed investigation trigger |
| --- | ---: | ---: |
| Tenant B completion under flood | 2,502 ms | 6,000 ms |
| Longest admitted A execution | 1,308 ms | 3,000 ms |
| Maximum event-loop delay | 25.95 ms | 250 ms |
| Parent RSS growth during flood | 34.82 MiB | 128 MiB |
| Sampled worker RSS during flood | 159.53 MiB | 384 MiB |
| Accounted working data per query | 3.32 MiB | 16 MiB |
| Cancel-to-reaped-worker maximum | 8.94 ms | 750 ms |
| PostgreSQL cancel-to-closed maximum | 11.65 ms | 1,500 ms |
| Tenant A running / queued peak | 1 / 4 | 1 / 4 |

These are engineering regression checks, not tier sizes or promised SLOs. Tests
also force source-row, result-byte, cache-byte and worker-RSS violations; prove
another tenant's cache survives eviction; and kill blocked workers on parent death.
Every full root suite runs these checks and the live PostgreSQL checks when
`DATABASE_URL` is supplied. The metrics are emitted as test diagnostics.

RSS is sampled every 20 ms and includes native memory; a sample-triggered kill
is not a kernel memory ceiling. Working-data accounting is conservative but is
not total API RSS: request bodies, metadata, serialization, runtime and allocator
costs exist outside it. Broader joins, adversarial expression shapes, many tenants,
slow sources and deployment-specific cgroup limits still need owner-approved
workload measurements. Exceeding a regression trigger calls for investigation,
a narrower admitted envelope or stronger worker placement. HQ-8 owns production
ceilings, acceptable latency, admission shares and isolation class; HQ-14 owns
product tiers. None are decided by this slice.
