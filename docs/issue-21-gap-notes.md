# H1 (#21): verification and visual review

Work remains on `work/issue-21-h1-tenant-metadata`, based on H0 merge
`9c8f2291`. After the VM reboot, the existing five checkpoint commits through
the durable outbox were retained. Work resumed at migration. No design document,
dependency lockfile, HTTP session/provisioning surface, deployed service, or
multi-node component was added or changed. No merge, push, or issue closure is
part of this slice.

## Metadata acceptance evidence

The H1 suites cover every resource kind with identical IDs in two tenants,
namespace/owner isolation through get/list, unknown-versus-foreign not-found
responses, and missing/fabricated context rejection through every tenant accessor.
They exercise database composite foreign keys directly as well as through the
repository, transaction rollback, concurrent tenant provisioning and resource
updates, stale authorization/configuration checks, suspension, restart,
idempotency and deletion tombstones. Outbox events commit with their state and
contain scope/revision metadata rather than resource contents.

Actual PostgreSQL tests use temporary schemas and a separate restricted login
role, FORCE RLS, and reused pool connections. They prove unscoped reads see no
tenant rows, cross-tenant SQL writes fail, unsafe roles are rejected, a pooled
connection retains no tenant context after commit/rollback, and racing writes
leave one winner with coherent revisions. Cleanup failures discard connections.
The live run found and fixed the PostgreSQL reserved identifier `authorization`
by quoting that column consistently in the shared SQL.

Migration tests preserve security, folders/shares, invitations, owner-scoped prep,
source bindings, portable definitions, encrypted AI settings and default-only
legacy automation. Tests reject missing mappings/owners/sources, duplicate IDs,
policy/ARN mismatches, corrupt encryption, prep cycles, fixture/customer mappings,
changed inputs and tampered backups. They test in-flight legacy write versus
freeze, concurrent migrate versus rollback, CLI reporting, the seal boundary,
backup permissions, and retained frozen legacy files after cutover.

Six child-process SIGKILL scenarios stop migration after freeze, inventory,
tenant insertion, resource insertion, immediately before commit, and immediately
after commit. Each restart rejects authentication to unsealed tenants and resumes
to the same complete inventory, without duplicate events or partially served
metadata. Locks use SQLite OS locking and release on process death. The operator
must still stop and drain the legacy API/scheduler: existing in-memory read
snapshots are not revoked by filesystem freeze markers.

The offline migration runbook and library/CLI contracts are in
[h1-tenant-metadata.md](h1-tenant-metadata.md). H1 does not provide hosted HTTP
composition; H2/H3/H7 retain their scheduled responsibilities. No hosted parity,
production deployment, or distributed-safety claim follows from these tests.

## Demo rebuild and screenshot comparison

`TZ=UTC npm run build:demo --workspace @opensight/web` rebuilt
`packages/web/dist/opensight-demo.html`. Chromium loaded that local file with
HTTP requests blocked, captured dashboard/author/prep at 1440×1000, and recorded
zero page errors, zero external requests and no page-wide horizontal overflow.
The footer continues to say “visual fidelity not measured.”

The author capture is pixel-identical to `docs/images/author.png` at the same
viewport. Visual comparison with the available `qs-author-light-flow.jpg`
reference retains the Data → Visuals → sheet flow, navy/blue chrome and docked
controls. The reference contains a populated sheet while this capture is the
empty builder; this is a layout/regression check, not a measured fidelity score.
The prep view retains the existing offline/hosted-API explanations and disabled
server controls. No new user-visible defect was found. H1 changes no UI, so the
existing README screenshots and hero GIF remain current; no replacement is needed.
Temporary browser evidence is in `/tmp/h1-browser/`.

## Full verification

The final root `npm test` exited **0** with **1,402 passed / 0 failed / 0 skipped**.
It ran with `TZ=UTC` and the brief's `DATABASE_URL` pointing at local PostgreSQL
on port 5433.
The existing test cluster was restarted after the reboot; no new infrastructure
or dependency was installed. Both existing live query-engine checks and the new
metadata PostgreSQL isolation check are enabled. The final log is
`/tmp/h1-full-tests-final.log`.


| Runner | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| API | 178 | 0 | 0 |
| Bundle parser | 197 | 0 | 0 |
| Embedding SDK | 4 | 0 | 0 |
| O interpreter | 32 | 0 | 0 |
| Query engine | 511 | 0 | 0 |
| Web | 477 | 0 | 0 |
| Root conformance | 3 | 0 | 0 |
| **Total** | **1,402** | **0** | **0** |

The API includes 34 H1 tests: 9 scoped repository/lifecycle/outbox checks,
23 migration/CLI/recovery checks, and 2 PostgreSQL adapter/isolation checks.
`git diff --check` passes. `SOLUTION_DESIGN.md` and `package-lock.json` are
unchanged from the H0 base. Every H1 change is checkpointed on the requested
branch; the static demo is a local artifact, not a deployed server.
