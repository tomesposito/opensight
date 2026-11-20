# Native category-sort planner — gap notes

Slice: `parity-category-sort-planner` (phase-plan fallback; no GitHub issue).
The supplied run brief is the implementation contract; `SOLUTION_DESIGN.md`
is unchanged.

## Scope and evidence

The native query-engine planner admits `CategorySort.FieldSort` and
`CategorySort.AggregationSort` for bar, line (including AREA) and pie visuals.
Validation remains fail closed and does not change query ordering or measure
aggregation. Tests compare the complete plan without omitting fields, SQL
strings and `evaluatePlan` results with the corresponding no-sort request.
Input definitions are also checked for mutation.

`packages/query-engine/test/category-sort-planner.test.mjs` adds **915 tests**.
The acceptance matrix covers all six aggregations, ASC/DESC/omitted direction,
categorical/date dimensions, bar/line/area/pie and all five SQL dialects. It
checks multiple groups, null aggregates, multiple Values measures, existing
AVG measures, calculated measures and nonempty filter parameters.

Negative cases cover malformed objects/lists, empty/multiple entries,
mixed/absent variants, unknown keys at each level, wrong field IDs, invalid
directions, dimension/unbound columns, missing/wrong datasets and malformed or
unsupported aggregation functions. Direct and calculated attempts to access a
denied column retain the binder's concealed-column diagnostic. Table/KPI
CategorySort and unsupported visual kinds remain rejected. KPI TrendGroupSort
still admits both variants with unchanged plans.

No existing tests or expectations were changed. In particular, the previous
KPI aggregation-sort regression expects TrendGroupSort on category charts to
fail at the whole `SortConfiguration` path. Unsupported sort keys retain that
diagnostic. Field-well inspection also found that the existing planner permits
multiple category dimensions; this slice leaves those gates unchanged and
requires the sort's field ID to reference the first dimension, rejecting a
second dimension's ID.

Earlier category-sort docs did not explicitly claim this native planner
boundary was closed. Short follow-up notes link the new contract from the
compiler slice and its gap notes, preserving their historical evidence.

## Verification

The strict TypeScript package build passed:

```sh
npm run build --workspace @opensight/query-engine
```

Log: `/tmp/opensight-category-sort-planner-build.log`.

The focused new tests and planner/KPI regressions passed:

```sh
TZ=UTC node --test --test-isolation=none \
  packages/query-engine/test/category-sort-planner.test.mjs \
  packages/query-engine/test/planner.test.mjs \
  packages/query-engine/test/kpi-trend.test.mjs \
  packages/query-engine/test/kpi-trend-agg-sort.test.mjs
```

Result: **1,106 passed / 0 failed / 0 skipped**, with zero cancellations or
todos. Log: `/tmp/opensight-category-sort-planner-focused.log`.
An initial run identified missing required policy fields in the new security
test setup; the setup was corrected without relaxing any assertions.

The full query-engine workspace command is:

```sh
TZ=UTC npm test --workspace @opensight/query-engine
```

The initial sandboxed run completed with **1,922 passed / 21 failed / 2
skipped** (1,945 tests), with zero cancellations or todos. All 21 failures were
existing MySQL/Redshift tests opening local TCP sockets: `listen EPERM` on
`127.0.0.1`. A standalone loopback bind probe confirmed the sandbox restriction.
Log: `/tmp/opensight-category-sort-planner-query-engine-sandbox.log`.
The same full suite then passed with sandbox escalation so those existing
loopback tests could execute; no assertions, skips or thresholds were changed.

Final result: **1,943 passed / 0 failed / 2 skipped** (1,945 tests), with zero
cancellations or todos. The command exited **0**. Log:
`/tmp/opensight-category-sort-planner-query-engine.log`.
The workspace command includes the strict package and test TypeScript builds.

Both skips are existing live-Postgres integration tests (`postgres-live` and
`prep-branching-live`) requiring `DATABASE_URL`. No new tests are skipped.
The full root suite is left to the supervisor's independent verification,
as permitted by the run brief; these counts cover the query-engine workspace.

## Limits

This slice verifies planner admission and unchanged SQL/fixture results. It
does not claim live database or AWS verification. Display ordering remains
with the compiler/consumer, with no new raw-source sort aggregation semantics.
Other sort configuration keys and visual-kind gates remain unchanged.

There is no UI change. Per the run brief, no static-demo rebuild, screenshots,
reference comparison, README changes or hero GIF regeneration are performed.
Visual fidelity is not measured. No dependencies, package manifests, lockfiles
or `SOLUTION_DESIGN.md` are changed. No AWS calls, network downloads, GitHub
issue activity, push or merge are part of this work.
