# H8 reference verification (#37)

Branch: `work/issue-37-h8-single-node-reference`. No deployment, merge, push or
AWS operation was performed. `SOLUTION_DESIGN.md` is unchanged. The build follows
[the operator runbook](hosted-operation.md); HQ-10 and HQ-14 remain open for Tom.

## Native reference measurements

The native PostgreSQL reference test ran on the build VM (Linux x64, Node
24.20.0, local PostgreSQL 16). It uses the same reference database composition,
private owner/restricted tenant roles, built-in password/MFA sessions, hosted HTTP
router, real contained workers and single scheduler. Synthetic inputs only;
invitation delivery uses the stub transport. This does **not** include Docker,
ingress TLS, image cgroups or a production network.

One initial run measured:

| Measurement | Observed |
| --- | ---: |
| Concurrent tenants | 2 |
| Rows per query | 4096 |
| Tenant A flood | 12 submitted, 5 admitted, 7 rejected |
| Flood duration (including tenant B query) | 8438 ms |
| Successful data queries/second during flood | 0.71 |
| Authenticated metadata requests/second (40 requests, batches of 4) | 129.62 |
| Scheduler source refresh jobs/second (2 jobs) | 4.18 |
| Accounted Blaze bytes after refresh | 264192 |
| API RSS at metrics capture | 207298560 bytes |
| Peak sampled worker RSS | 158007296 bytes |

These are narrow regression-workload observations, not capacity limits or SLOs.
The initial envelope is the explicitly synthetic H4 test configuration: one
running/four queued tasks per tenant, three node tasks including a refresh
reservation, twelve queued node tasks, and 64 MiB node cache allowance. There is
no inferred entitlement. Root tests emit the measurements again, so timing varies.

The probe verifies identical source IDs return different correct tenant totals,
foreign source/namespace/header attacks fail, protected data is refused during
flood, neighboring work completes, tenant audit stays scoped, separate operator
audit credentials are required, scheduler history completes, PostgreSQL ownership
excludes a second node, restart clears Blaze, and tenant recovery suspends access.
The broader H1–H7 isolation/RLS/CLS, embed, containment, migration and delivery
suites remain part of root `npm test`.

## Compose gate

Docker tooling/daemon is unavailable on this VM. The Docker-marked integration
test therefore skips cleanly. The TLS Compose topology, exact image/distribution
licenses, cgroup envelope and total-volume-loss drill have **not been measured**
here. The new integration test exercises them with reviewed, preloaded images on
a Docker-capable runner; it never pulls images. This is an outstanding pilot gate,
not a passed deployment or HA claim. No Compose request rate or recovery time is
invented from the native measurement.

## Recovery and regression evidence

Focused recovery tests cover tenant restore, retention of newer member revocations,
newer deletion tombstones, total-loss suspension, encryption-key recovery,
interrupted schema migration and atomic rollback on corrupt records. Encryption
rotation also tests actual TOTP/invitation envelopes and corrupted-record rollback.
The affected tenant/auth/scheduler/source PostgreSQL regression run passed
**100 / 0 / 0** (passed / failed / skipped).

The final full-suite and demo comparison records are added after verification.
