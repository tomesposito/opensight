# Issue #154: usage metering verification

The monthly billing record is documented in [usage metering](usage-metering.md).
The implementation adds measurement and reporting; existing entitlement and
quota enforcement tests remain unmodified. No dependencies, pricing amounts,
limits, analytics transports, design documents or frontend code changed.

## Registry review

| Registry | Decision |
| --- | --- |
| `runtime-initial.ts` initial empty tables | Include `h8_monthly_usage`; initial setup must not adopt existing billing data. |
| `runtime-initial.ts` second emptiness check | Include it alongside daily usage to prevent bootstrap work from creating billing state. |
| `serverless-migration.ts` | Include it in `additiveTables`, which feeds ownership, grants and backup inventory. Keep it out of `baseTables` so existing installations can upgrade. Tenant roles receive no billing grants. |
| `single-node-maintenance.ts` core/backup list | Include it in `referenceTables` so backup and restore preserve records. Accept the previously supported inventories without the new table. |
| `single-node-maintenance.ts` tenant deletion | Delete billing rows alongside daily usage; no records remain for an erased tenant. |
| `single-node-maintenance.ts` retention | Do not prune monthly records with daily counters/events. Billing snapshots persist until tenant erasure; roll up before pruning daily source rows. |
| `hosted-server.ts` startup and readiness probes | Include it in both probes because the operator billing route requires a complete migration, just as existing H8 tables do. |
| `serverless-backup-schema.ts` and `serverless-backup.ts` | Version the additive billing inventory, accept pre-billing backups and verify that their migration creates an empty billing table. Existing snapshots retain exact rows. |

Other `h8_usage` references are counter producers/readers or restore quota
fences, not table inventories. Those remain unchanged: monthly records are
recomputed only by an explicit rollup, and restore fences are not fabricated
monthly measurements.

## Regression coverage

The new `hosted-billing-usage.test.mjs` runs automatically under the existing API
workspace/root scripts. Its 16 tests cover month boundaries, admitted/denied
sums, recomputation without double counting, changing storage snapshots,
recorded-only egress and concurrent recording, overflow/corruption rollback,
exact record shape, tenant isolation, missing/erased scopes, suspended-tenant
reporting, operator authorization and invocation denial, restart durability,
unchanged quota denials, daily retention, deletion, backup/restore, additive
upgrades and missing-migration readiness. The live PostgreSQL test covers
concurrent tenant-row locking, exact totals and denied tenant-role SQL access.

The focused run of billing, existing usage, serverless backup and single-node
maintenance tests passed **37 / 0 failed / 0 skipped**, including live Postgres.
The final root-suite results are recorded below.

Earlier diagnostic runs are not final results: the sandboxed HTTP attempt
aborted under local socket restrictions; the first local-access run exposed
fixture tombstone, unsupported-route expectation and HTTP teardown mistakes.
Those tests were corrected. The first root run was stopped for a final
record-shape hardening change and restarted against the final source.

## Static demo comparison

`npm run build:demo --workspace=@opensight/web` passed. Captured the rebuilt
`packages/web/dist/opensight-demo.html` dashboard and author editor at 1440×900
with `/tmp/issue154-capture.mjs`; HTTP/HTTPS requests were blocked and Chromium
reported zero page errors. Captures are `/tmp/issue154-demo/dashboard.png` and
`/tmp/issue154-demo/author.png`.

Compared the dashboard to `docs/images/sample-dashboard.png`: synthetic chart
values and card placement remain intact. Branding and navigation differences
predate this issue. Compared the editor to the local QuickSight reference
`qs-2026/qs-autograph-empty.jpg`: Data → Visuals → canvas ordering remains intact.
Existing differences include offline notices, larger controls, the dotted
canvas and docked Properties. No issue-specific UI regression was identified.
Visual fidelity remains unmeasured. These are static artifacts, not a deployed
server. No frontend UI changed, so README screenshots and the hero GIF remain
unchanged.

## Full root verification

`npm test` ran from the repository root with `TZ=UTC` and the supplied local
Postgres `DATABASE_URL`. It exited **0**: **4,338 passed / 0 failed / 1 skipped**,
with no cancelled tests or TODOs. This includes all **32 Python SDK tests**
(`unittest` reported `OK`), as well as **4,306 Node test passes**.

The single skip is the existing real-TLS Postgres storage CLI integration test:
`OPENSIGHT_TEST_POSTGRES_CA` was not configured. Every integration test enabled
by the supplied `DATABASE_URL`, including monthly billing, ran successfully.

| Suite | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| API | 859 | 0 | 1 |
| Bundle parser | 199 | 0 | 0 |
| CLI | 73 | 0 | 0 |
| Embedding SDK | 10 | 0 | 0 |
| TypeScript headless SDK | 28 | 0 | 0 |
| Python headless SDK | 32 | 0 | 0 |
| MCP server | 74 | 0 | 0 |
| O interpreter | 32 | 0 | 0 |
| Parity | 11 | 0 | 0 |
| Query engine | 523 | 0 | 0 |
| Web | 2,409 | 0 | 0 |
| Root conformance | 88 | 0 | 0 |
| **Total** | **4,338** | **0** | **1** |

The full log and parsed counts are `/tmp/issue154-root-tests-final.log` and
`/tmp/issue154-root-counts.json`. The focused regression log is
`/tmp/issue154-focused-final.log`; demo build and capture logs are
`/tmp/issue154-demo-build.log` and `/tmp/issue154-capture.log`.

No push, merge, deployment, AWS call or dependency installation was performed.
