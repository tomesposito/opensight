# Issue #225 — monthly API/query quotas

## Admission and reporting

`HostedUsage.consume()` sums admitted usage for the requested metric and
tenant/namespace across every daily ledger row from `YYYY-MM-01` through
`YYYY-MM-31`. The existing transaction still takes the active-tenant lock and
checks the authorization revision before reading usage. A monthly total at or
above the entitlement records a denial on today's row and returns
`USAGE_LIMIT_EXCEEDED` (429). Otherwise it records today's admission. Events
retain their per-call UTC timestamps. Each daily admitted/denied counter, the
running admitted sum and the counter being incremented are checked with
`usageInteger`; corrupt or unsafe accounting returns `ENTITLEMENT_UNRESOLVED`
(503) and rolls back all writes.

The operator overview uses the same monthly reader. API calls and Queries show
`usage.period`, and the explanatory note describes monthly UTC quotas. The
response/type shape, live storage gauge, monthly NLQ, daily Prometheus series,
AI spend cap, AI credits and egress paths are unchanged.

## Tests added and updated

Added in `packages/api/test/hosted-usage.test.mjs`:

- `225 monthly API/query quotas exhaust across days and concurrent instances, retain daily ledgers and reset next month`:
  both metrics, October 1/31 and November 1, two meter instances, concurrent
  exhaustion, tenant isolation, exact daily ledger/events, rollup inputs and
  daily Prometheus values.
- `225 monthly admission fails closed on corrupt earlier-day counters and unsafe sums without recording anything`:
  negative, fractional, unsafe and malformed admitted/denied values on another
  day, unsafe monthly sums, denial-counter overflow and rollback of all writes.
- `225 monthly admission isolates the UTC month and metric, and zero limits deny across months`:
  month/metric boundaries, corrupt rows outside the month and zero allowances.

Added in `packages/api/test/hosted-billing-usage.test.mjs`:

- `225 operator overview validates earlier-day API/query counters and safe monthly sums`.

Added in `packages/web/test/operator-provisioning.test.mjs`:

- `225: tenant usage labels API calls, queries and NLQ with the UTC month and storage as current`.

Updated:

- `H8 competing tenants have atomic durable monthly limits, exact events, restart and UTC month reset`:
  denial after one day, admission at the next UTC month; the shared one-day
  `advance()` helper is unchanged.
- `Issue 192 B / 225: operator overview matches monthly API/query enforcement, live storage and monthly NLQ quotas`:
  API calls are 107, queries 3 and NLQ 6; other tenants and months are excluded.
- The single-node maintenance test's restore-fence comment now describes its
  monthly effect. Its test behavior is unchanged, as are the single-node
  PostgreSQL 64-consume/8-per-tenant drill and the billing quota-denial test.

## Verification

- `npm run build --workspace=@opensight/api`: passed, including strict TypeScript.
- `npm run build:demo --workspace=@opensight/web`: passed; rebuilt
  `packages/web/dist/opensight-demo.html` and the embed entries.
- Web test TypeScript compilation: passed.
- Focused API run (`hosted-usage`, `hosted-billing-usage`,
  `single-node-maintenance`, `single-node-postgres`): **35 passed / 0 failed /
  2 skipped**. Both skips require live PostgreSQL, including the unchanged
  64-concurrent-consume drill. The existing billing quota-denial test passed.
- Operator provisioning component tests: **12 passed / 0 failed / 0 skipped**.
- `git diff --check`: passed.

The full root `npm test` was run. All workspaces executed, but the web workspace
failed at Chromium startup, so npm's `&&` prevented the final conformance/site
command from running. That exact final command was then run separately:
`node --test --test-isolation=none conformance/*.test.mjs site/build-docs.test.mjs`.

| Run | Passed | Failed | Skipped | Cancelled |
| --- | ---: | ---: | ---: | ---: |
| Root `npm test` workspaces | 4,434 | 4 | 36 | 390 |
| Remaining root conformance/site checks | 103 | 0 | 0 | 0 |
| Combined coverage | 4,537 | 4 | 36 | 390 |

The workspace totals include all 32 Python SDK tests. The API workspace passed
**1,195 / 0 / 34 skipped**; query-engine passed **619 / 0 / 2 skipped**. Every
skip requires live PostgreSQL (`DATABASE_URL` or live TLS configuration).
The web workspace recorded **2,151 passed / 4 failed / 0 skipped / 390 cancelled**.
Its browser errors are `read ECONNRESET`; a direct Chromium startup and the
README capture attempt identify the missing Hatch WebGL domain policy below.
All issue #225 tests passed in the full run. No test assertions were disabled
or thresholds changed. The full suite is **not green** in this environment.

Logs and machine-counted workspace totals are local verification artifacts:
`/tmp/opensight-225-root-test.log`, `/tmp/opensight-225-conformance-test.log`,
`/tmp/opensight-225-affected-api-test.log`, `/tmp/opensight-225-operator-test.log`,
`/tmp/opensight-225-test-counts.json` and `/tmp/opensight-225-capture.log`.

## Visual review

The rebuilt static demo is a local artifact, not a deployed hosted server.
The README capture script was attempted against that rebuilt demo. Chromium
exits before creating a page with
`Hatch WebGL domain policy is required for browser startup`, including outside
the filesystem/network sandbox. The same startup issue affects the repository's
browser-test harness. Static demo/reference comparison and the README GIF and
operator-detail screenshot refresh could not be completed; existing images
remain unchanged. No visual-parity claim is made.

## Files changed

- `CHANGELOG.md`
- `docs/h2-tenant-sessions.md`
- `docs/hosted-single-node.md`
- `docs/issue-192-gap-notes.md`
- `docs/issue-225-gap-notes.md`
- `docs/phase5-sr2a-coordination.md`
- `docs/usage-metering.md`
- `packages/api/src/hosted-usage.ts`
- `packages/api/test/hosted-billing-usage.test.mjs`
- `packages/api/test/hosted-usage.test.mjs`
- `packages/api/test/single-node-maintenance.test.mjs`
- `packages/web/scripts/persona-journeys/j7-operator.mjs`
- `packages/web/src/OperatorTenant.tsx`
- `packages/web/test/operator-provisioning.test.mjs`

All commits stay on `work/issue-225-monthly-quotas`. Nothing is merged or pushed.
`SOLUTION_DESIGN.md`, terms, pricing, tier values and dependency manifests are
unchanged; no dependencies were added.

## Independent verification addendum (sweep, 2026-11-08)

The Chromium startup failure above is the known exec-context limit (missing
Hatch WebGL domain policy), not a code failure. The sweep re-ran the full root
`npm test` independently on this branch with `OPENSIGHT_CHROMIUM` pointed at
the Playwright headless shell: **4,885 tests, 4,849 passed, 0 failed,
36 skipped, exit 0** — the complete suite green in one run, including the web
workspace and the final conformance/site checks. The 36 skips are the
live-Postgres tests (no DATABASE_URL). Merged on that verification.
