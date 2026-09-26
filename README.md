# OpenSight

An open-source BI platform aiming for full QuickSight capability parity and
bidirectional asset compatibility.

**Start here:** [SOLUTION_DESIGN.md](SOLUTION_DESIGN.md) records the vision,
architecture, decisions and phased plan.

## Status

Phase 0 — research. The parser inventories **provisional synthetic JSON reconstructed
from AWS documentation**. It does not load real QuickSight `.qs` ZIP exports or API
response envelopes. A sanitized real export is an explicit Phase 1 entry requirement;
archive layout and resource schemas will be documented from that evidence.

The [fixtures](fixtures/README.md) include an inventory smoke sample and a separate
query/render specification with five visual types, field wells, layouts, source/dataset
response reconstructions, CSV data and SQL result oracles. There is no renderer,
query compiler or QuickSight-compatible API implemented yet.

## Quick start

Requires Node 24+ and npm. From the repository root:

```bash
npm ci
npm run build
npm test
npm run summarize --workspace @opensight/bundle-parser -- ../../fixtures/sample-sales-analysis.json
```

Expected [CLI output](fixtures/sample-sales-analysis.summary.txt) and
[JSON summary](fixtures/sample-sales-analysis.summary.json) are checked by tests.
The suite includes malformed-input regressions, public-entry typechecking and local
SQL data-oracle checks. CI runs build and tests.

After building, workspace consumers can import the public API:

```ts
import { loadSyntheticAnalysis, summarizeBundle } from '@opensight/bundle-parser';
const inventory = summarizeBundle(loadSyntheticAnalysis('fixtures/sample-sales-analysis.json'));
```

`loadBundle` remains a historical alias for `loadSyntheticAnalysis`. Validation errors
include JSON paths. Unknown properties are retained; inventory success does not imply
full schema validity or execution support. Summary titles retain their `plain`/`rich`
format; rich markup is raw text and must not be inserted directly into HTML.

## Layout

```
packages/bundle-parser  Provisional JSON inventory, validation and summary
packages/api            QuickSight-compatible REST API (planned)
packages/web            React renderer + authoring (planned)
packages/query-engine   Typed planner + expression compiler on DuckDB (planned)
packages/cli            Archive import/export/validate (planned)
docs/research           Observed format and API contract research
fixtures                Reconstructed regression and query/render specifications
conformance             Real-export round trips + source fidelity (planned)
```
