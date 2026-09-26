# Local query engine

`@opensight/query-engine` is a **synthetic/provisional Phase 0 slice**, not proof of
QuickSight export or expression compatibility. It compiles the five renderable-sales
visuals into DuckDB SQL and executes them over an explicitly mapped local CSV. There
are no AWS calls, Postgres connections or `.qs` archive handling.

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
integrities, including platform artifacts. Postgres remains disabled under D8.

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

The plan includes typed source columns, row expression trees with source spans,
dependency-ordered calculations, filters, dimensions, measures, SQL and parameters.
Each dimension/measure maps its original `fieldId` to `outputName`; output names use
field IDs except a month dimension uses `month` to match the fixture oracle. Duplicate
or case-ambiguous identifiers/output aliases are rejected (including two month aliases).

## Supported local semantics

- One untransformed physical/logical dataset and its linked source reconstruction.
- Bar, line, ordinary table, KPI and pie field-well shapes from the fixture.
- Multiple categorical dimensions; date dimensions grouped by calendar month in UTC.
  Dimensions order ascending, nulls first; no missing periods are synthesized.
- Explicit SUM, AVG, COUNT, MIN and MAX over numeric fields. COUNT counts non-null
  values, and SUM/AVG/MIN/MAX of all-null or empty input return null.
- Numeric literals, column references, parentheses, row `+`, `-`, `*`; null propagation,
  normal arithmetic precedence, forward dependencies and cycle detection. A direct
  column reference can also alias a string/date field. Only reachable expressions run.
- Static string category equality with `NON_NULLS_ONLY`, one value/filter per group.
  Groups intersect. `AllSheets` and fully resolved selected-sheet/visual scopes work;
  disabled filters are omitted. Unresolved scopes block the analysis. Applicable
  unsupported filters block execution; independent visuals can run.

Row calculation CTEs precede filter CTEs, which precede the explicit visual GROUP BY
and aggregation. Identifiers are quoted and filter values are bound parameters.
Division, aggregate expressions, windows, period offsets, joins, transforms, custom
SQL, parameters, controls, sorting and other unrecognized execution options fail
closed. Harmless fixture titles/layouts are accepted but not rendered here.

`semantic-cases.json` is authoritative about deferred cases. Tests reject all three
deferred expressions in the planner/executor and separately run the proposed reference
SQL in DuckDB, adapting the SQLite calendar-date function in test code only. The
all-null case uses CSV row 6 (the reference SQL's selected row), since numeric equality
filters are outside this slice. The existing SQLite oracle tests remain independent.

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
