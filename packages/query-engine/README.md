# Query engine

`@opensight/query-engine` compiles validated visual requests and calculated fields
for the mapped renderable-sales dataset. It compiles visuals into DuckDB SQL for an explicitly mapped local CSV, or Postgres SQL for an
existing table. DuckDB remains the default local dev/test engine; the opt-in Postgres
executor is the D12 production data-plane seam. There are no AWS calls or `.qs`
archive handling.

From the repository root (Node 24+):

```sh
npm ci
npm run build
npm test
```

The official [DuckDB Node API](https://duckdb.org/docs/current/clients/node_neo/overview)
depends on native `@duckdb/node-bindings`. Both are pinned to `1.5.5-r.5`; native
DuckDB is `v1.5.5`. Installation succeeded on Linux x64/glibc; no executor fallback
was needed or implemented. [duckdb-lock.json](duckdb-lock.json) records the observed
native build and statically linked extensions. Root `package-lock.json` pins package
integrities, including platform artifacts. Postgres uses the
[pg driver](https://node-postgres.com/apis/client), with its dependency pinned in the
root lockfile.

## Public API

After building, run this as an ES module from the repository root:

```js
import { readFileSync } from 'node:fs';
import { planVisual, executeLocal } from '@opensight/query-engine';

const dataRoot = 'fixtures/renderable-sales';
const read = name => JSON.parse(readFileSync(`${dataRoot}/${name}`, 'utf8'));
const request = {
  analysis: read('analysis.json'),
  dataSet: read('describe-data-set.response.json'),
  dataSource: read('describe-data-source.response.json'),
  localData: read('local-data.json'),
  visualId: 'sales-table',
};
const plan = planVisual(request);
console.log(plan.sql, plan.parameters);
const { rows } = await executeLocal(request, { dataRoot });
console.log(rows); // [{ region: 'East', revenue: 500, discounted_revenue: 450 }]
```

Planning needs the containing analysis definition to resolve calculated fields and
filter scopes; a bare visual is insufficient to authorize execution. The parser's
inventory validation does not certify execution. `executeLocal` always replans before
opening files. There is no public raw-SQL or caller-modified-plan execution method.
`QueryEngineError` exposes a stable `code`, a JSON `path`, and a human-readable message.

For Postgres, reuse the request above and supply trusted connection details explicitly:

```js
import { executePostgres } from '@opensight/query-engine';

const postgresPlan = planVisual(request, { dialect: 'postgres' });
const result = await executePostgres(request, {
  connectionString: process.env.DATABASE_URL,
});
console.log(result.rows);
```

`planVisual(request)` and `{ dialect: 'duckdb' }` retain the original DuckDB SQL.
Both dialects quote identifiers and use `$1`, `$2`, … parameters (DuckDB already used
this parameter syntax). Postgres uses `DOUBLE PRECISION` for row arithmetic and
`to_char(date_trunc('month', ...), 'YYYY-MM')` for the existing month result format.
Its table reference includes the physical metadata's schema and table as separately
quoted identifiers, independent of the server's search path.

`executePostgres` performs the same complete planning, capability and security
validation as `executeLocal` before constructing a client. The current `PlanRequest`
still requires the trusted `localData` binding, including its security declarations;
Postgres validates that binding but never reads its CSV. Source metadata never supplies
connection credentials. The caller must provision a table with the declared columns
and compatible Postgres types (for example BIGINT, DOUBLE PRECISION/NUMERIC, TEXT,
and DATE/TIMESTAMP/TIMESTAMPTZ). No CSV import, migration or infrastructure is performed.

Each Postgres call creates one client, sets the session timezone to UTC, executes the
parameterized plan and awaits client cleanup on success or failure. Result rows use
the same JSON-compatible scalar shape: nulls remain null, numeric aggregates become
numbers, and large integer results remain decimal strings. Fractional numeric results
use JavaScript's approximate floating point; nonfinite numeric results are rejected.
Type parsing is local to the query. Driver failures become `EXECUTION_ERROR` at
`$.postgres` without exposing raw driver messages or connection details. Neither the
executor nor its returned plan logs or contains the connection string.

## Postgres tests

Root `npm test` includes exact SQL tests for both dialects, DuckDB snapshots captured
before the dialect expansion, shared rejection tests and mocked Postgres lifecycle tests.
Function differential tests also execute PostgreSQL locally through the Apache-2.0
PGlite development dependency and compare with DuckDB and the client evaluator. The live Postgres suite skips cleanly when `DATABASE_URL` is absent.
To enable it, set `DATABASE_URL` to a disposable test database and run `npm test` (or
`npm test --workspace @opensight/query-engine`). The database role must be able to
create and drop a schema. The suite creates a uniquely named schema with a sales-like
table, checks fixture results, calculations, filters, all five aggregations, nulls,
large integers and UTC months, then removes that schema in `finally`.

The embedded PostgreSQL differential suite always runs, including when the optional
external-server suite has no connection configured.

The plan includes typed source columns, row expression trees with source spans,
dependency-ordered calculations, filters, dimensions, measures, SQL and parameters.
Each dimension/measure maps its original `fieldId` to `outputName`; output names use
field IDs except a month dimension uses `month` to match the fixture oracle. Duplicate
or case-ambiguous identifiers/output aliases are rejected (including two month aliases).

## Supported local semantics

- One untransformed physical/logical dataset and its linked source reconstruction.
- Bar, line, ordinary table, KPI and pie field-well shapes from the fixture.
- Multiple categorical dimensions; date dimensions grouped by year, quarter, month or day in UTC.
  Dimensions order ascending, nulls first; no missing periods are synthesized.
- Explicit SUM, AVG, COUNT, MIN and MAX over numeric fields. COUNT counts non-null
  values, and SUM/AVG/MIN/MAX of all-null or empty input return null.
- The Phase 2c [calculated-field catalog](../../docs/calculated-fields.md): string,
  numeric, datetime, conditional, aggregation, table, level-aware and conversion
  functions. The browser-safe parser shares signatures and validation with the editor.
- Scalar parameters, comparisons, boolean logic and arithmetic with null propagation,
  forward dependencies and cycle detection. Only reachable expressions execute.
- Static string category equality with `NON_NULLS_ONLY`, one or more selected values per filter.
  Groups intersect. `AllSheets` and fully resolved selected-sheet/visual scopes work;
  disabled filters are omitted. Unresolved scopes block the analysis. Applicable
  unsupported filters block execution; independent visuals can run.

Row calculation CTEs precede filters and visual grouping for ordinary SQL plans.
For table calculations and level-aware stages, both SQL engines return source rows
and pushed scalar calculations to the shared processing layer. See the
[stage ordering and semantics](../../docs/calculated-fields.md#execution).
Identifiers are quoted; literal and parameter values are bound. Joins, source
transforms, arbitrary SQL and unsupported visual configuration still fail closed.

The three historically deferred expressions in `semantic-cases.json` now execute:
calendar period differences, guarded division, and row-versus-aggregate ratios.
The independent SQLite and DuckDB reference oracles are retained. No AWS calls or
captured AWS conformance results are claimed.

## Local binding and limits

`localData.security` explicitly declares `{ dataset: 'unrestricted', source:
'unrestricted' }`. It belongs to **trusted caller-owned test configuration**, never
to an imported asset or a future untrusted HTTP request. Absent declarations and
any dataset RLS/CLS/policy or source restriction cause rejection. This is a test
execution boundary, not policy enforcement or a production authentication system.

The CSV must resolve to a regular file under the caller's `dataRoot`; URI/glob and
traversal bindings and symlink escapes are rejected. Headers must exactly match
declared columns. CSV quoting works; empty cells mean null. INTEGER uses BIGINT,
DECIMAL uses DOUBLE, STRING uses VARCHAR, and the initial DATETIME input subset is
ISO `YYYY-MM-DD` dates interpreted as midnight UTC. Offset timestamps and other date
formats are rejected pending a broader temporal contract. DOUBLE and arithmetic use
approximate floating point, not a financial decimal precision guarantee. Nonfinite
input/results are rejected. Safe integer results become JSON numbers; larger integer
results become decimal strings to avoid silent precision loss.

Each execution closes its connection and in-memory database on success or failure.
DuckDB has one thread, a 256 MiB memory limit, no disk spill, disabled extension
autoload/install, and external access disabled after CSV import. This is intended for
small trusted fixtures; cancellation, source-size/result budgets, pooling and caching
remain open. Native runtime failures propagate as located execution errors; failures
do not trigger a different SQL backend.
