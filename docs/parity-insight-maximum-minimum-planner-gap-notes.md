# Native Insight MaximumMinimum planner — gap notes

Slice: `parity-insight-maximum-minimum-planner` (phase-plan fallback; no
GitHub issue). The supplied run brief is the implementation contract;
`SOLUTION_DESIGN.md` is unchanged.

## Scope and evidence

The native query-engine planner now admits `MaximumMinimum` Insight
computations alongside the five kinds admitted earlier (Forecast,
PeriodToDate, UniqueValues, TopBottomMovers, Anomaly). Validation remains
fail closed and does not change query planning: an admitted computation
derives the insight's single dimension and SUM measure exactly as the
equivalent already-admitted computation over the same fields does. Tests
compare the complete plan (dimensions, measures, calculations, filters,
SQL and parameters) against that equivalent plan, omitting only each
field's binding path, which names the computation that owns the binding.
Both accepted and rejected input definitions are checked for mutation.

`packages/query-engine/test/insight-maximum-minimum-planner.test.mjs` adds
**28 tests**, automatically included by the query-engine `test/*.test.mjs`
glob reached by root `npm test`. The acceptance matrix covers MAXIMUM and
MINIMUM over a MONTH-grain date dimension (plan-identical to the admitted
anomaly series) and over a category dimension, across DuckDB, PostgreSQL,
MySQL, Redshift and Athena; companion computations that derive the same
dimension or measure when MaximumMinimum omits `Time` or `Value`; and the
prepared-visual path. Negative cases assert exact error codes (and the
`.Type` path) for a missing/invalid `Type`, unknown keys, a measure field
as `Time`, date/category type mismatches, an unsupported granularity, a
non-SUM or unbound value, duplicate computation IDs, inconsistent
rebinding of one field ID, two derived dimensions, a standalone
MaximumMinimum missing its dimension or measure, a movers combination,
and continued rejection of TotalAggregation, TopBottomRanked, GrowthRate,
PeriodOverPeriod and MetricComparison.

## Verification

The strict TypeScript query-engine build passed as part of its test
command. The new test file plus the existing planner tests passed
**58 passed / 0 failed / 0 skipped** (28 new + 30 planner):

```sh
node --test --test-isolation=none \
  packages/query-engine/test/insight-maximum-minimum-planner.test.mjs \
  packages/query-engine/test/planner.test.mjs
```

One correction during development: the first focused run failed the
category case's `evaluatePlan` expectation because the shared fixture
request carries an East filter group; the test now clears `FilterGroups`
for that case (the table-row-sort planner test uses the same pattern),
and the evaluated groups are East 50, North null, West 10 in dimension
order.

The first full-suite run was killed by a VM reboot at ~6 minutes and its
log was lost with `/tmp`; the suite was re-run from the same committed
tree in the fresh boot window. The full root suite exited **0** with
**7,914 passed / 0 failed / 37 skipped** (7,951 tests, zero cancellations
and zero todos):

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
| Query engine | 2,419 | 0 | 2 |
| Web | 3,402 | 0 | 0 |
| Root checks | 110 | 0 | 0 |
| **Total** | **7,914** | **0** | **37** |

All 37 skips require live PostgreSQL (35 API, 2 query engine). All 28 new
planner tests ran in the query-engine suite. This is exactly the prior
slice's baseline (7,886 passed) plus the 28 new tests, with no other
movement. Full log:
`~/workspace/goals/opensight/hidden_files/os-mm-planner-root.log`.

## Offline demo and reference comparison

This slice changes no rendering, authoring or UI code — it admits a
computation kind at the native planning boundary only — so there is no
visual delta against the prior baseline to capture: the rebuilt static
demo is byte-equivalent in behavior for every surface, and the README
hero GIF and feature screenshots need no refresh (AGENTS.md §4 refreshes
media on phases that change user-visible UI; this one does not). The
demo remains a local static artifact, not a deployed server. Visual
fidelity is not measured.

## Limits

This slice verifies planner admission and unchanged SQL/fixture results.
It does not claim live database or AWS verification. Picking the
highest/lowest group, its share-of-total and tie behavior remain with the
narrative consumer. The remaining unadmitted computation kinds
(TotalAggregation, TopBottomRanked, GrowthRate, PeriodOverPeriod,
MetricComparison) stay fail-closed for a future slice; TotalAggregation
in particular derives no dimension, so it does not fit the planner's
exactly-one-dimension rule without a contract decision.

No dependencies, package manifests, lockfiles or `SOLUTION_DESIGN.md`
are changed. No AWS calls or network downloads were made.

## Checkpoints and final scope review

All numbered checkpoints are committed only on
`work/parity-insight-maximum-minimum-planner`: the admission contract,
planner validation, tests, and documentation/verification. Changed paths
are limited to `packages/query-engine/src/planner.ts`, the new test file,
the two new slice docs and `CHANGELOG.md`.
