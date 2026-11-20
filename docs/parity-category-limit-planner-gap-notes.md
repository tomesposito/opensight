# Native category-items-limit planner — gap notes

Slice: `parity-category-limit-planner` (phase-plan fallback; no GitHub issue).
The supplied run brief is the implementation contract; `SOLUTION_DESIGN.md`
is unchanged.

## Scope and evidence

The native query-engine planner admits `CategoryItemsLimit` for bar, line
(including AREA) and pie visuals, alone or alongside a valid `CategorySort`.
Validation remains fail closed and does not change query planning or measure
aggregation. Tests compare the complete plan without omitting fields, SQL
strings and `evaluatePlan` results with the corresponding no-limit request.
Input definitions are also checked for mutation.

`packages/query-engine/test/category-limit-planner.test.mjs` adds **256
tests**. The acceptance matrix covers counts 1 and 100, INCLUDE/EXCLUDE,
an omitted count, an omitted `OtherCategories`, an empty limit object,
categorical and date dimensions, bar/line/area/pie and all five SQL dialects.
It checks coexistence with `CategorySort`, multiple Values measures, an
existing AVG measure, a calculation and nonempty filter parameters.

Negative cases cover non-object limits, unknown keys, out-of-range,
fractional, string, null, boolean and NaN counts, and invalid
`OtherCategories` values. Other `SortConfiguration` keys on category charts
retain the whole-block rejection, including alongside a valid limit. Table
and KPI visuals keep rejecting `CategoryItemsLimit`, and unsupported visual
kinds gain nothing.

One existing expectation changed, by design: the CategorySort planner suite's
rejected-keys list no longer includes `CategoryItemsLimit`, because this
slice admits it; every other key in that list is unchanged.

## Verification

The strict TypeScript package build passed:

```sh
npm run build --workspace @opensight/query-engine
```

Log: `/tmp/os-limit-planner-build.log`.

The focused new tests and planner/KPI regressions passed:

```sh
TZ=UTC node --test --test-isolation=none \
  packages/query-engine/test/category-limit-planner.test.mjs \
  packages/query-engine/test/category-sort-planner.test.mjs \
  packages/query-engine/test/planner.test.mjs \
  packages/query-engine/test/kpi-trend.test.mjs \
  packages/query-engine/test/kpi-trend-agg-sort.test.mjs
```

Result: **1,358 passed / 0 failed / 0 skipped** (the new file alone: 256
passed / 0 failed / 0 skipped). Log: `/tmp/os-limit-planner-focused.log`.
The full root suite is the supervisor's independent verification, recorded
in the sweep report.

## Limits

This slice verifies planner admission and unchanged SQL/fixture results. It
does not claim live database or AWS verification. Computing the limit over
result rows remains with the compiler/consumer, with no new raw-source
limiting semantics. Other sort configuration keys and visual-kind gates
remain unchanged.

There is no UI change, so no static-demo rebuild, screenshots, reference
comparison, README changes or hero GIF regeneration are performed by the
builder; the supervisor still rebuilds the demo after merge per the sweep
contract. Visual fidelity is not measured. No dependencies, package
manifests, lockfiles or `SOLUTION_DESIGN.md` are changed. No AWS calls,
network downloads, GitHub issue activity, push or merge are part of this
work.

## Checkpoints and final scope review

All numbered checkpoints are committed only on
`work/parity-category-limit-planner`: planner admission, tests (including
the one superseded rejection expectation), documentation and this final
scope review. The changed paths are limited to `planner.ts`, the new test
file, the one-line expectation update in the CategorySort planner test, the
two new slice docs, the addendum in the CategorySort planner doc,
`CHANGELOG.md` and this gap-notes file.
