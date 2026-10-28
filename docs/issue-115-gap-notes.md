# Issue #115 verification and boundaries

## Scope

The approved build brief targets `ReferenceMaintenance.deleteTenant`. Inspection
confirmed that the existing single-node flow already removed H1 metadata assets
on its first completion. The missing coverage included repeat-run asset cleanup,
AI warnings, login selections, workspace names/slugs, read-only inventory,
confirmation, independently checked leftovers, and a completion receipt sharing
the purge transaction. Audit history remains under normal retention (D-84).

The single-node runtime stores upload bytes encrypted in H1 metadata; its Blaze
cache is ephemeral. Serverless durable objects use a separate runtime, tables,
object versions and dispatch/recovery fences. This command rejects that schema
and durable object references before writing. Serverless erasure is not
implemented or claimed by this branch. Unsupported storage fails closed.

No dependency or license changes, AWS calls, deployment, merge, push, or
publication. `SOLUTION_DESIGN.md` remains unchanged. All checkpoint commits are
on `work/issue-115-tenant-erasure`, based on `89c3b670`.

## Focused verification

Strict API TypeScript compilation passed. The focused tenant-erasure and
single-node maintenance run passed **21 / 0 / 0** (passed / failed / skipped).
It exercises dry-run bytes and directory immutability, explicit confirmation,
tenant isolation, asset categories, shared identities, silent skipped deletions,
audit insertion failure, backup fencing before partial retries, cache leftovers,
legacy checkpoints, interrupted first-registry initialization, symlink bypasses,
reintroduced assets, and no-op retries after normal audit retention.

The original live PostgreSQL maintenance drill now explicitly confirms its real
deletion call. It remains gated by `DATABASE_URL` with the rest of the existing
PostgreSQL integration tests.

## Root verification

The final full root run against the committed implementation exited **0**:

```sh
TZ=UTC TMPDIR=/tmp npm test
```

**4,293 passed / 0 failed / 34 skipped**, with no cancellations or TODOs.
All skips are live PostgreSQL integrations: `DATABASE_URL` or the TLS PostgreSQL
fixture was unavailable. The total includes all **32 Python SDK tests** as well
as Node test-runner totals (4,261 passed). No other skips were accepted.

| Suite | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| API | 829 | 0 | 32 |
| Bundle parser | 199 | 0 | 0 |
| CLI | 73 | 0 | 0 |
| Embedding SDK | 10 | 0 | 0 |
| Headless SDK | 28 | 0 | 0 |
| Python SDK | 32 | 0 | 0 |
| MCP server | 74 | 0 | 0 |
| O interpreter | 32 | 0 | 0 |
| Parity | 11 | 0 | 0 |
| Query engine | 508 | 0 | 2 |
| Web | 2,409 | 0 | 0 |
| Root conformance | 88 | 0 | 0 |
| **Total** | **4,293** | **0** | **34** |

The initial sandbox attempt could not open localhost listeners (`listen EPERM`).
The final run used local-process permissions and a real `TMPDIR=/tmp`; it ran
all workspaces and root conformance. Local log, exit status and counts are
`.opensight/issue-115-verification/root-npm-test.log`, `root-npm-test.exit`, and
`root-test-counts.json`. Earlier interrupted runs have separate log filenames
and are excluded from these totals. No implementation changes followed this
successful run.

## Static demo review

Rebuilt `packages/web/dist` with
`npm run build:demo --workspace=@opensight/web`. Captured the rebuilt file demo
at 1280 × 800 in Chromium, blocking all HTTP requests: **0 page errors, 0 external
requests, no horizontal overflow**. Captures and machine-readable checks remain
in `.opensight/issue-115-verification/`.

Compared the author capture with the private `qs-author-light-flow.jpg`
reference: the Data → Visuals/field wells → canvas order and docked properties
remain intact. The demo's explanatory banners and compact empty canvas differ
from the populated QuickSight reference; this phase does not change them.
Compared the dashboard with `docs/images/sample-dashboard.png`: synthetic values
and chart arrangement agree; the navigation and branding differences predate
this issue and were also recorded in issue #152's review. No new UI gap was
introduced or filed. The README hero and feature screenshots were not regenerated
because this branch changes the offline operator command, not web UI. Visual
fidelity remains unmeasured; this is a static demo, not a deployed server.
