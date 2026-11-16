# Issue #270 — MySQL and MariaDB hosted sources

MySQL/MariaDB now use the hosted source path with declared table/schema
bindings, operator endpoints, encrypted tenant credentials and current
RLS/CLS admission. See [connector configuration and limits](connector-mysql.md).
No AWS calls, live database verification, deployment or publication occurred.

## Adjustments to the run brief

- MariaDB session settings alone were insufficient for the library executor:
  generated SQL also contained `utf8mb4_0900_bin`. A token-aware conversion
  changes generated collation clauses and preserves quoted identifiers/literals.
- Text-protocol `query` binding uses mysql2's `queryFormat` hook with UTF-8 hex
  literals. Its default backslash escaping is incompatible with the required
  `NO_BACKSLASH_ESCAPES` session; hostile quote/backslash/Unicode values are tested.
- The injectable MySQL streamer is appended to the `HostedData` constructor,
  preserving all existing positional PostgreSQL/budget/cache/analytics callers.
- `compilePrep` only supports DuckDB/PostgreSQL. Hosted prep already stages
  admitted database rows into DuckDB. Browser MySQL/MariaDB prep validation uses
  that same staging model, retaining `sourceDialect: 'mysql'` and the real
  connector separately from the DuckDB transformation SQL. The local PostgreSQL
  prep path is unchanged; no native MySQL prep compiler is claimed.

The wire harness evaluates a narrow SQL subset with SQLite, exercising the
real mysql2 handshake, authentication and text protocol. This proves wiring,
fixture filtering and bounds, not live server SQL equivalence. Live RDS MySQL /
Aurora MySQL verification remains Tom's follow-on.

## Static demo review

The single-file demo was rebuilt. Before/after dashboard captures at 1280 × 800
have zero changed pixels. The connector dialog now includes enabled MySQL and
MariaDB choices; setup still states that an operator-provisioned hosted source
is required, and Select remains disabled without one. Captures have no page
errors, external HTTP requests or horizontal overflow. Setup's longer
environment-name form scrolls within the existing dialog.

Comparison with `qs-2026/qs-data-create-dataset.jpg` retains the existing
centered dialog, source search, upload/create-source actions and footer
selection flow. The existing empty-state illustration, spacing and wider
catalog differences remain; no new layout gap was found in this slice.
QuickSight visual fidelity remains unmeasured. The README tour GIF and source
screenshots were refreshed against the new local static demo.

Capture scripts and results are in the ignored
`.opensight/issue-270-verification/` directory. The tour script was copied from
`~/workspace/tools/screenshots/readme-gif.mjs` with current local paths and
navigation. Standard installed headless Chromium was used because the legacy
`/opt/meta-chromium/chrome` executable requires an unavailable startup policy.
This is a local static demo, not a deployed server.

## Verification

Focused checks: 110 MySQL/protocol/registry/source-plan tests, 48 API/analytics
checks, 9 source lifecycle/migration checks, 8 legacy connector/source checks,
and 79 web connector/prep checks passed with zero failures or skips.
The first root run exposed a race between the driver connection timeout and
the shorter source execution deadline. The streamer now uses one read deadline
across authentication/session/rows, retaining an independent 3-second connection
cap. Per-query driver timers were removed because they survive `destroy()`.
The original bounds/cancellation test and a new stalled-authentication regression
both pass; the assertions were retained. The final root rerun exited **0**:
**5,384 passed / 0 failed / 37 skipped / 0 cancelled**, comprising 5,421 tests
including the 32 Python SDK tests. All skips are existing live-PostgreSQL checks:
36 require `DATABASE_URL`, and one requires live TLS PostgreSQL configuration.
Every MySQL/MariaDB test ran unskipped.

The command was root `npm test` with `TMPDIR=/tmp`, `TZ=UTC` and the installed
headless Chromium selected through `OPENSIGHT_CHROMIUM`. Final output and parsed
counts are in `.opensight/issue-270-verification/root-npm-test.log` and
`root-test-counts.json`; the failed initial run is retained separately.

| Suite | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| API | 1,443 | 0 | 35 |
| Bundle parser | 208 | 0 | 0 |
| CLI | 73 | 0 | 0 |
| Embedding SDK | 10 | 0 | 0 |
| Headless SDK | 28 | 0 | 0 |
| Python SDK | 32 | 0 | 0 |
| MCP server | 74 | 0 | 0 |
| O interpreter | 42 | 0 | 0 |
| Parity | 11 | 0 | 0 |
| Query engine | 636 | 0 | 2 |
| Web | 2,717 | 0 | 0 |
| Root conformance and site | 110 | 0 | 0 |

## Checkpoint file inventory

### Item 1 — `d551e4d3`

- `packages/query-engine/src/connectors.ts`
- `packages/query-engine/src/mysql-executor.ts`
- `packages/query-engine/src/mysql-session.ts`
- `packages/query-engine/test/mysql.test.mjs`

### Item 2 — `e4eb0d36`

- `packages/query-engine/src/index.ts`
- `packages/query-engine/src/prep-stream.ts`
- `packages/query-engine/src/security.ts`
- `packages/query-engine/src/source-mysql.ts`
- `packages/query-engine/src/source-read.ts`
- `packages/query-engine/test/source-read.test.mjs`

### Item 3 — `cebf39e9`

- `packages/api/src/hosted-sources.ts`
- `packages/api/src/source-migration.ts`
- `packages/api/src/source-schema.ts`
- `packages/api/test/source-connectors.test.mjs`
- `packages/api/test/source-migration.test.mjs`

### Item 4 — `91e83afe`

- `packages/api/src/analytics.ts`
- `packages/api/src/hosted-data-routes.ts`
- `packages/api/src/hosted-data.ts`
- `packages/api/test/analytics-routes.test.mjs`
- `packages/api/test/analytics.test.mjs`
- `packages/api/test/source-http.test.mjs`

### Item 5 — `789eb5de`

- `packages/api/test/connectors.test.mjs`
- `packages/api/test/hosted-sources.test.mjs`
- `packages/api/test/mysql-harness.mjs`
- `packages/api/test/source-mysql.test.mjs`
- `packages/query-engine/src/source-mysql.ts`
- `packages/query-engine/test/connectors.test.mjs`

### Item 5 follow-up — `2e797e6e`

- `packages/query-engine/src/source-mysql.ts` — one execution deadline and timer cleanup.
- `packages/api/test/mysql-harness.mjs` — stalled-authentication mode.
- `packages/api/test/source-mysql.test.mjs` — authentication-deadline regression.

### Item 6 — `81e3183f`

- `docs/images/data-sources.png`
- `docs/images/mysql-source-setup.png`
- `docs/images/opensight-tour.gif`
- `packages/web/src/CreateAnalysisDialog.tsx`
- `packages/web/src/CreateDatasetDialog.tsx`
- `packages/web/src/DataPrep.tsx`
- `packages/web/src/DataSources.tsx`
- `packages/web/src/data-prep.ts`
- `packages/web/src/query-connectors.ts`
- `packages/web/test/create-analysis-dialog.test.mjs`
- `packages/web/test/create-dataset-dialog.test.mjs`
- `packages/web/test/data-prep.test.mjs`
- `packages/web/test/data-sources.test.mjs`

### Item 7 — `501d20fe`

- `CHANGELOG.md`
- `docs/connector-mysql.md`
- `docs/issue-270-gap-notes.md`

### Item 8 — full-suite verification

- `docs/issue-270-gap-notes.md` — final root-suite totals and this inventory.
- `README.md` — remove the stale unimplemented-MySQL claim beside the refreshed connector screenshot.
