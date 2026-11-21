# Native table row-sort planner — gap notes

Slice: `parity-table-row-sort-planner` (phase-plan fallback; no GitHub issue).
The supplied run brief is the implementation contract; `SOLUTION_DESIGN.md`
is unchanged.

## Scope and evidence

The native query-engine planner admits `RowSort` for `TableVisual` only.
Validation remains fail closed and does not change query planning, measure
aggregation or SQL ordering. Tests compare the complete plan without omitting
fields, SQL strings and `evaluatePlan` results with the corresponding no-sort
request. Both accepted and rejected input definitions are checked for mutation.

`packages/query-engine/test/table-row-sort-planner.test.mjs` adds **196 tests**,
automatically included by the query-engine `test/*.test.mjs` glob reached by
root `npm test`. The acceptance matrix covers ASC, DESC and omitted direction;
first and later categorical/date dimensions; both bound Values measures,
including a calculation; a measure without dimensions; an empty RowSort list;
and an empty SortConfiguration. Every case runs across DuckDB, PostgreSQL,
MySQL, Redshift and Athena. Additional checks preserve an existing AVG measure,
calculation, nonempty filter parameters, null aggregates and native dimension
ordering even when sorting by a measure.

Negative cases assert exact error codes and paths for malformed configuration,
list, wrapper, FieldSort, field ID and direction values, multiple entries,
unknown or mixed wrappers, AggregationSort, unknown FieldSort properties,
unbound/removed IDs, column names substituted for distinct IDs and date output
aliases substituted for field IDs. Unknown table SortConfiguration keys retain
the whole-block path and message, alone or alongside valid RowSort.

Bar, line, pie and KPI still reject RowSort. Tables still reject CategorySort
and CategoryItemsLimit. Pivot and other unsupported visual kinds gain nothing.
Existing planner, category-sort, category-limit and KPI test files are untouched.

## Verification

The strict TypeScript query-engine build passed as part of its test command.
The new test file passed **196 passed / 0 failed / 0 skipped**. The focused
new tests plus planner/category-sort/category-limit/KPI regressions passed
**1,554 passed / 0 failed / 0 skipped**:

```sh
node --test --test-isolation=none \
  packages/query-engine/test/table-row-sort-planner.test.mjs \
  packages/query-engine/test/category-sort-planner.test.mjs \
  packages/query-engine/test/category-limit-planner.test.mjs \
  packages/query-engine/test/planner.test.mjs \
  packages/query-engine/test/kpi-trend.test.mjs \
  packages/query-engine/test/kpi-trend-agg-sort.test.mjs
```

Logs: `/tmp/os-table-row-sort-planner-new.log` and
`/tmp/os-table-row-sort-planner-focused.log`.

An initial sandboxed query-engine run reported **2,174 passed / 21 failed /
2 skipped**. All 21 failures were existing MySQL/Redshift loopback tests denied
socket creation (`listen EPERM`); this run preceded discovery of the new test
file. The final full suite ran with loopback permissions and passed, including
all of those tests. No tests were disabled to work around the sandbox.

The full root suite exited **0** with **7,886 passed / 0 failed / 37 skipped**
(7,923 tests, zero cancellations and zero todos):

```sh
OPENSIGHT_CHROMIUM="$HOME/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell" TZ=UTC npm test
```

| Runner | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| API | 1,500 | 0 | 35 |
| Bundle parser | 213 | 0 | 0 |
| CLI | 73 | 0 | 0 |
| Embedding SDK | 10 | 0 | 0 |
| Headless SDK | 28 | 0 | 0 |
| Python SDK | 32 | 0 | 0 |
| MCP server | 74 | 0 | 0 |
| O interpreter | 42 | 0 | 0 |
| Parity | 11 | 0 | 0 |
| Query engine | 2,391 | 0 | 2 |
| Web | 3,402 | 0 | 0 |
| Root checks | 110 | 0 | 0 |
| **Total** | **7,886** | **0** | **37** |

All 37 skips require live PostgreSQL (35 API, 2 query engine). All 196 new
planner tests ran in the query-engine suite. Full log:
`/tmp/os-table-row-sort-planner-root.log`; machine-readable counts:
`/tmp/os-table-row-sort-planner-counts.json`.

## Offline demo and reference comparison

`npm run build:demo --workspace @opensight/web` passed, including strict
TypeScript and embed builds. The local single-file demo is **2,539,700 bytes**.
Build log: `/tmp/os-table-row-sort-planner-demo.log`.

The existing `packages/web/scripts/capture-table-row-sort.mjs` passed against
the rebuilt `file://` demo using the installed Chromium shell. All HTTP/HTTPS
requests were blocked; it recorded **zero page errors and zero external
requests**. It verified default/ascending/descending row order, measure-sort
defaults, clearing, save/reload and sorted-field removal. Light and dark
captures both retain 12px Arial controls and no page overflow at 1440×1000.

Captures and `acceptance.json` are in
`/tmp/os-table-row-sort-planner-captures`; the log is
`/tmp/os-table-row-sort-planner-capture.log`.
Both descending captures are byte-identical (matching SHA-256) to the existing
`docs/images/parity-table-row-sort-light.png` and
`docs/images/parity-table-row-sort-dark.png` reference captures.

Visual review against the supplied `qs-2026/qs-properties-display-settings.jpg`
and `qs-2026/qs-properties-group-color.jpg` references confirms the Data →
Visuals → canvas flow and docked Properties sections. Existing differences
remain: more explanatory chrome, the offline notice and a narrower default
card. The existing light-theme direction button has no selected fill, while
dark theme highlights it; the capture verifies `aria-pressed` in both themes.
These differences were already recorded in the compiler slice's
[gap notes](parity-table-row-sort-gap-notes.md); this planner slice adds no UI
change or new visual gap. There is no dedicated table-sort reference and no
measured fidelity claim. README images and the hero GIF remain unchanged
because this slice changes no rendered UI.

## Limits

This slice verifies planner admission and unchanged SQL/fixture results. It
does not claim live database or AWS verification. Display ordering remains
with the compiler/consumer; native query results alone do not acquire it.

There is no authoring or rendering change. The static demo is rebuilt and
captured locally for the repository verification loop; it is not a deployed
server. Visual fidelity is not measured. No dependencies, package manifests,
lockfiles or `SOLUTION_DESIGN.md` are changed. No AWS calls, network downloads,
GitHub issue activity, push or merge are part of this work.

## Checkpoints and final scope review

All numbered checkpoints are committed only on
`work/parity-table-row-sort-planner`: the admission contract, planner validation,
tests, and documentation/verification. Changed paths are limited to
`packages/query-engine/src/planner.ts`, the new test file, the two new slice
docs, the corrected category-limit planner doc, the table-row-sort follow-up
and `CHANGELOG.md`.
