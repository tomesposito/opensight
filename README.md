# OpenSight

An open-source BI platform aiming for full QuickSight capability parity and
bidirectional asset compatibility.

**Start here:** [SOLUTION_DESIGN.md](SOLUTION_DESIGN.md) records the vision,
architecture, decisions and phased plan.

## Status

The parser reads real QuickSight `.qs` ZIP exports with
analysis, dashboard, dataset and datasource members, grounded in the sanitized
[AWS sample](fixtures/real-bundle-sample/README.md). Its camelCase archive types
are separate from the existing PascalCase synthetic inventory. See the
[observed format and API mapping](docs/research/bundle-format.md).

The [fixtures](fixtures/README.md) include an inventory smoke sample and a separate
query/render specification with five visual types, field wells, layouts, source/dataset
response reconstructions, CSV data and SQL result oracles. The
[local query engine](packages/query-engine/README.md) compiles that synthetic subset
to DuckDB SQL and runs it over CSV without AWS. The web app renders and authors
this subset, and the local API serves definitions and queries. Broader archive
schemas, AWS reimport and source
conformance still need evidence from more complex exports.

The Author UI supports client-side `.qs` import, dataset remapping and ZIP export.
See [bundle round-trip usage and preservation](docs/bundle-roundtrip.md).
Parameters and per-sheet controls now drive typed filters, calculated fields,
cascading dropdowns and debounced queries. See [interactive controls](docs/parameters-controls.md).
The gallery now includes 19 visual types, offline maps, analysis themes and
formatting, with author menus and canvas fitting. See [Phase 2d capabilities
and validation](docs/phase2d-visuals-themes.md).
The API also supports scheduled DuckDB refreshes, SMTP dashboard reports and
metric threshold alerts. See [Phase 3a resources and configuration](docs/scheduled-refresh-reports-alerts.md).

## Quick start

Requires Node 24+ and npm. From the repository root:

```bash
npm ci
npm run build
npm test
npm run summarize --workspace @opensight/bundle-parser -- ../../fixtures/sample-sales-analysis.json
npm run summarize --workspace @opensight/bundle-parser -- ../../fixtures/real-bundle-sample/TotalDeathByCountry.sanitized.qs
```

Expected [CLI output](fixtures/sample-sales-analysis.summary.txt) and
[JSON summary](fixtures/sample-sales-analysis.summary.json) are checked by tests.
The suite includes malformed-input regressions, public-entry typechecking and local
SQL data-oracle checks, generated DuckDB query/result comparisons and fail-closed
execution checks for unsupported features and protected/unresolved datasets.

After building, workspace consumers can import the public API:

```ts
import { loadQsBundle, summarizeQsBundle } from '@opensight/bundle-parser';
const inventory = summarizeQsBundle(await loadQsBundle('fixtures/real-bundle-sample/TotalDeathByCountry.sanitized.qs'));
```

`loadBundle` remains a historical alias for `loadSyntheticAnalysis`. Validation errors
include JSON paths and, for archive members, their ZIP path. Unknown properties are
retained; inventory success does not imply full schema validity or execution support.
Synthetic summary titles retain their `plain`/`rich` format; rich markup is raw text
and must not be inserted directly into HTML.

## Layout

```
packages/bundle-parser  Observed .qs archive import + synthetic JSON inventory
packages/api            Local definition and dataset-query API
packages/web            React renderer + authoring and bundle round trips
packages/query-engine   Typed synthetic planner + local DuckDB CSV executor
packages/cli            Archive import/export/validate (planned)
docs/research           Observed format and API contract research
fixtures                Sanitized real export + synthetic regression specifications
conformance             Controls-to-query integration; source fidelity planned
```
