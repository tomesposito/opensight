# Issue #39 — H8 verification notes

Pilot, single-node, no HA claims; Blaze is ephemeral. Actual deployment requires
separate authorization. This records the fresh Issue #39 implementation against
HQ-10 B and HQ-14 B. No material from the reverted H8 attempt was used.

## Built and exercised

- Operator-only liveness/readiness/metrics/drain with named dependency failures,
  explicit tenant/embed/forged-header bypass tests, request completion and
  fake-timer scheduler drain.
- Operator-configured API-call, logical-resource-byte and compute-attempt gates.
  Tests cover atomic competing-tenant admission, encrypted source/upload rollback,
  embed usage bypass attempts, successful scheduled/manual refresh accounting,
  restart/UTC rollover, corrupt/unavailable counters and unresolved entitlement.
- Durable append-only lifecycle/maintenance audit and operator-run retention.
  PostgreSQL tests deny tenant SQL reads of private tables and mutation of audit.
- Native PostgreSQL reference CLI, fresh and repeat migration, real readiness
  request, SIGTERM, reconnect/restart, single-process exclusion, encrypted backup,
  held restore, tenant deletion including managed backup purge, and tamper/replay
  refusal. Restored memberships require explicit review; jobs/sessions cannot
  automatically revive. Current-day usage remains closed after restore.
- Named `UNSUPPORTED` failures for H9–H12 opt-ins and operator surface controls;
  mounted-secret conflict/type/path validation without secret diagnostics.
- Compose YAML parses, and the init shell passes `sh -n`. The API is published on
  host loopback only; PostgreSQL has no published host port.

The [runbook](hosted-single-node.md) contains configuration, commands, exact unit
semantics, retention/deletion boundaries and measured synthetic results.

## Validation environment and limits

Node 24.20.0 and the repository's existing local PostgreSQL 16.4 test service.
All Postgres fixtures create and remove isolated schemas/roles. The H8 process
and maintenance drills use that service; SMTP tests use stub delivery. No source
customer data or real credentials were used.

The sandbox aborted Node during the first focused test run and could not reach
the existing loopback PostgreSQL service. Approved local execution outside the
sandbox passed. A disposable cluster was initialized in `/tmp` while diagnosing
the environment and removed afterward; the required drills ultimately used the
already running repository test service, without changing its configuration.

The focused PostgreSQL CLI/migration/restart/restore/delete run measured 9,035 ms,
with a 64-request admission batch taking 2,990 ms (16 accepted, 48 named denials),
and an 89-row, 22,910-byte encrypted snapshot. These are small correctness drills,
not performance or recovery commitments. H4's full containment/load suites also
run under root `npm test`.

Docker is not installed, so no image build or Compose service startup was run.
Actual TLS proxy configuration, image selection, SMTP delivery, external backup
copy inventory/purge and storage-media erasure remain operator work. The native
CLI, database roles, scheduler and HTTP lifecycle were tested directly. No AWS,
deployment, merge, push, issue closure, static-demo rebuild or screenshot update
was performed; those final project actions remain with the outer loop.

The reference reuses `pg` 8.23.0 and `@types/pg` 8.23.1, both MIT per their installed
package manifests, and adds no new resolved package. `npm ls pg @types/pg` verifies
the API and query engine share those existing locked versions.

## Full root test run

**Final root result: 1,671 passed / 0 failed / 0 skipped; exit code 0.**
No cancelled tests. This was independently run after the final source change.

| Runner | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| API (including 16 H8 tests) | 313 | 0 | 0 |
| Bundle parser | 197 | 0 | 0 |
| Embedding SDK | 9 | 0 | 0 |
| Interpreter | 32 | 0 | 0 |
| Query engine | 514 | 0 | 0 |
| Web | 600 | 0 | 0 |
| Root conformance | 6 | 0 | 0 |
| **Total** | **1,671** | **0** | **0** |

The exact command was:

```sh
TZ=UTC DATABASE_URL=postgresql://postgres@127.0.0.1:5433/opensight npm test
```

The command runs every workspace and root conformance suite, including live
PostgreSQL. It does not invoke the static demo build.

## File inventory

Added:

- `.dockerignore`; `ops/single-node/{compose.yaml,Dockerfile,init-tenant.sh}`.
- `packages/api/src/hosted-health.ts`, `hosted-usage.ts`, `single-node-config.ts`,
  `single-node.ts`, `single-node-cli.ts`, `single-node-maintenance.ts`.
- `packages/api/test/h8-helpers.mjs`, `hosted-health.test.mjs`,
  `hosted-usage.test.mjs`, `single-node-config.test.mjs`,
  `single-node-maintenance.test.mjs`, `single-node-postgres.test.mjs`.
- `docs/hosted-single-node.md` and this verification record.

Updated:

- `packages/api/src/cli.ts`, `hosted-server.ts`, `embed-session-routes.ts` for
  graceful shutdown, operator endpoints and authenticated API/embed metering.
- `packages/api/src/metadata.ts`, `hosted-data.ts`, `job-renderer.ts`,
  `job-runner.ts`, `job-store.ts` for atomic storage gating, compute accounting,
  drain and audit.
- `packages/api/src/hosted-auth.ts` for durable membership-acceptance audit.
- `packages/api/package.json` and `package-lock.json` for the reference command
  and explicit reuse of the existing PostgreSQL dependencies.

`SOLUTION_DESIGN.md`, the phase plan, static demo, screenshots and README media
were not changed.
