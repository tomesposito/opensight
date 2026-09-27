# Parameters and controls (Phase 2a)

In Author mode, open **Parameters** in the Data panel, create a string, number,
or datetime parameter, and set its default. Strings and numbers can be single
or multi-valued; datetime is single-valued. Integer declarations retain integer
validation. An empty selection means no matches; it does not mean all values.

Use **Add control** above the sheet to bind a dropdown, numeric slider, date
picker, or text input. Dropdowns support single and multiple selections. Sliders
require a single number, text inputs a single string, and date pickers a datetime.
Control settings include rebinding, left/right ordering and removal. Reset restores
the declared default. **Use current values as default** explicitly changes the
exported default; ordinary selections only change the device's current draft.

In visual Properties, **Parameter filter** binds a compatible column to a
parameter. Equality supports multiple string/number selections. Inclusive lower
and upper comparisons accept single numbers or datetimes. Calculated fields use
`${Name}` for a single parameter and `{column}` for a field. The existing row
arithmetic subset (`+`, `-`, `*`, parentheses and references) remains the expression
boundary; values are SQL bindings, never interpolated expression text.

Dropdown options can come from a local text column. A parent control can filter
that column's distinct query using a matching dataset column. Imported cascades
can have several parents. Pending/error options are unavailable for selection;
selected values that no longer occur remain explicitly marked unavailable, with
no silent change to the parameter. Cycles, unresolved parents and foreign dataset
sources are reported. Imported dataset connections are never opened.

API visual requests involving parameters wait 250 ms after the last edit. The
visual immediately hides old data and displays loading during that interval and
the request. Abort and request/client identity checks discard late results and
errors. Only reachable calculations and parameters enter a visual's query key.

When a sheet has parameters, fixture Author previews recompute over the pinned
synthetic sales CSV using the same typed planner and a browser evaluator. They
cover all regions, preserve null aggregation and use UTC dates. Legacy parameter-free
fixture drafts retain the Builder v1 precomputed East previews. The explorer's
whole-definition fixture boundary is unchanged. No browser database or network
connection is used for fixture recomputation.

## Local HTTP contract

`POST /api/datasets/sales/query` accepts the existing dimensions, measures,
filters and optional calculatedFields, plus these optional fields:

```json
{
  "parameterDeclarations": [
    { "name": "Region", "type": "string", "multiple": true },
    { "name": "Scale", "type": "number", "multiple": false }
  ],
  "parameterBindings": { "Region": ["West"], "Scale": [2] }
}
```

A filter can have `{ "columnName": "region", "parameterName": "Region" }`;
its optional `operator` is `EQUALS`, `GREATER_THAN_OR_EQUAL_TO`, or
`LESS_THAN_OR_EQUAL_TO`. A parameter selector is mutually exclusive with static
`value`/`values`. Declarations use `string`, `number`, or `datetime`, a boolean
`multiple`, and optional boolean `integer` for numbers. Bindings are arrays even
for single-value parameters. Dates use ISO dates or UTC datetime strings.

Unknown properties, duplicate declarations, unknown/missing bindings, wrong types,
invalid dates, fractional integers and wrong cardinality return HTTP 400 with a
located message. Column type mismatch and unsupported expressions return engine
422 diagnostics. Declarations accompany this stateless builder request; there
is no server-side parameter catalog/default evaluation. Dataset/security metadata
remains server-owned and is never accepted from the request.

## Bundles and validation

Exports use camelCase parameter declarations, parameter-referencing filter groups,
and per-sheet `parameterControls`. Compatible imported controls become live;
unsupported controls/options retain their original JSON and appear in the import
report. Parameters with the same name in different members remain independent.
Editing a shared parameter filter splits the edited visual's scope. Unchanged
imports retain structural JSON equality, including absent fields and unknown
properties. Edited resources preserve the existing round-trip snapshots.

Server-side/rolling defaults, cross-visual actions, drill-down and the full
calculated-function library remain outside Phase 2a. Foreign visual/data semantics
continue to produce explicit unavailable states. Native control shapes are local
synthetic regression coverage, not evidence of AWS reimport conformance.

Root `npm test` runs workspace tests and controls → reducer → parameter filter →
local HTTP/DuckDB integration tests, plus the same interaction in fixtures mode.
It covers debounce, pending and late responses, type rejection, cascades, defaults,
controls import reports and JSON/ZIP round trips. HTTP tests bind only loopback.
`npm run build:demo --workspace @opensight/web` rebuilds the offline single-file demo.

No third-party dependency was added for this phase. The web package now imports
browser-safe entry points from the repository's existing `@opensight/query-engine`
workspace; its package metadata and repository LICENSE declare Apache-2.0.
Native database drivers are not imported by the browser entry points.

## Verification (2026-09-27)

`env -u DATABASE_URL npm test` exited 0:

| Suite | Tests | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: | ---: |
| API | 31 | 31 | 0 | 0 |
| Bundle parser | 183 | 183 | 0 | 0 |
| Query engine | 166 | 165 | 0 | 1 |
| Web | 232 | 232 | 0 | 0 |
| Root controls integration | 2 | 2 | 0 | 0 |
| Total | 614 | 613 | 0 | 1 |

The external PostgreSQL integration test was skipped because `DATABASE_URL` was
unset. All suites had zero cancellations and zero todo tests. Local API integration
used loopback; no AWS or external service calls were made.

After the final decimal-slider form adjustment, strict TypeScript compilation and
six focused control/UI regressions passed (6 tests, 6 passed, 0 failed/skipped).
`npm run build` and `npm run build:demo --workspace @opensight/web` both exited 0.
The rebuilt `packages/web/dist/opensight-demo.html` is 1,096,026 bytes and was checked
for inline script/CSS and included parameter/control code. `git diff --check` passed.
The build retains the existing ECharts chunk-size warning; test rendering uses the
existing deprecated react-test-renderer dependency.
