# Native Insight GrowthRate planner — gap notes

Slice: `parity-insight-growth-rate-planner` (phase-plan fallback;
no GitHub issue). The supplied run brief is the implementation contract;
`SOLUTION_DESIGN.md` is unchanged.

## Scope and evidence

The native query-engine planner now admits `GrowthRate` Insight
computations alongside the eight kinds admitted earlier (Forecast,
PeriodToDate, UniqueValues, TopBottomMovers, Anomaly, MaximumMinimum,
TopBottomRanked, PeriodOverPeriod). Validation remains fail closed and
does not change query planning: an admitted computation derives the
insight's single date dimension and SUM measure exactly as the
equivalent already-admitted PeriodToDate computation over the same
fields does. GrowthRate's own `PeriodSize` is admitted only at exactly
`2` — the web narrative compiler supports only the latest period versus
the previous period — and any other value fails closed. Tests compare
the complete plan (dimensions, measures, calculations, filters, SQL and
parameters), omitting only each field's binding path, which names the
computation that owns the binding. Accepted definitions are checked for
mutation.

`packages/query-engine/test/insight-growth-rate-planner.test.mjs`
adds **44 tests**, automatically included by the query-engine
`test/*.test.mjs` glob reached by root `npm test`. The acceptance matrix
covers MONTH, YEAR, QUARTER, DAY and omitted granularity (default DAY)
across DuckDB, PostgreSQL, MySQL, Redshift and Athena. Each case compares
plans and fixture evaluation against PeriodToDate with the existing
filter and with the filter removed; the MONTH case also asserts the
ordered SUM series, including its null aggregate. Companion cases cover
omitted `Time`, omitted `Value`, both omitted, and consistent shared
field IDs in either computation order. The prepared-visual path compares
the full plan and fixture results without mutating the definition.
Valid shared ID bounds and string names are covered too, as are
`PeriodSize` 2 and an omitted `PeriodSize` planning identically.

Negative cases assert exact error codes **and full paths** for
`PeriodSize` values other than 2 (0, 1, 3, -2, 2.5, the string "2",
null, booleans, objects and arrays), unknown properties (including
properties belonging to other kinds), malformed/missing IDs, non-string
names, category or measure fields as `Time`, date-column type
mismatches, unsupported granularity, unbound time/value fields, non-SUM
or absent aggregation, nonnumeric values, duplicate/case-ambiguous
computation IDs, inconsistent date-grain or measure-column rebinding,
two derived dimensions, missing standalone dimension/measure bindings,
a UniqueValues companion that cannot supply a COUNT carrier,
category-derived companion dimensions, and movers combinations.
TotalAggregation and MetricComparison remain rejected at their kind
paths. The PeriodOverPeriod, MaximumMinimum and TopBottomRanked
regression tables no longer treat GrowthRate as unsupported.

## Focused verification

The strict TypeScript query-engine build passed (exit **0**, including
its bundle-parser build dependency). The requested focused command
exited **0** with **178 passed / 0 failed / 0 skipped**, zero
cancellations and zero todos:

```sh
npm run build --workspace @opensight/query-engine
TZ=UTC node --test --test-isolation=none \
  packages/query-engine/test/insight-growth-rate-planner.test.mjs \
  packages/query-engine/test/planner.test.mjs \
  packages/query-engine/test/insight-maximum-minimum-planner.test.mjs \
  packages/query-engine/test/insight-top-bottom-ranked-planner.test.mjs \
  packages/query-engine/test/insight-period-over-period-planner.test.mjs
```

| Focused file | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| GrowthRate planner | 44 | 0 | 0 |
| Planner | 30 | 0 | 0 |
| MaximumMinimum planner | 28 | 0 | 0 |
| TopBottomRanked planner | 34 | 0 | 0 |
| PeriodOverPeriod planner | 42 | 0 | 0 |
| **Total** | **178** | **0** | **0** |

Per-file counts were confirmed by running each file individually with
the same command shape; all passed on the first run, with no
self-correction needed.

Logs are retained under the ignored `.opensight/verification/` directory:
`growth-rate-build.log` and `growth-rate-focused.log`. No browser was
needed. No other test commands were run at this checkpoint.

## Full-suite verification

Pending the supervisor's independent full root run; this section is
completed in the final checkpoint before merge.

## Offline demo and reference comparison

This slice changes no rendering, authoring or UI code: it admits a
computation kind at the native planning boundary only. The expected
visual delta is therefore none. Demo rebuilding and reference comparison
remain with the supervisor after handoff; neither is claimed as completed
here. The README hero GIF and feature screenshots need no refresh for
this planner-only slice (AGENTS.md §4 refreshes media when user-visible
UI changes). The demo remains a local static artifact, not a deployed
server. Visual fidelity is not measured.

## Limits

This slice verifies planner admission and unchanged SQL/fixture results.
It does not claim live database or AWS verification. Growth-rate math
and sentence rendering remain with the narrative consumer.
TotalAggregation and MetricComparison stay fail closed for future
slices; TotalAggregation derives no dimension, so it needs a contract
decision before changing the exactly-one-dimension rule, and
MetricComparison binds two measures, which needs its own derivation
contract.

No dependencies, package manifests, lockfiles or `SOLUTION_DESIGN.md`
are changed. No AWS calls or network access were used. No contract
ambiguity was encountered.

## Checkpoints and final scope review

The checkpoints follow the PeriodOverPeriod slice's pattern:

1. `7ad52c9c` specifies the admission and planning contract.
2. `5d907093` admits GrowthRate and requires a date dimension.
3. `44d65b2c` adds focused coverage and updates the regression tables.
4. Records these gap notes, the changelog entry and focused verification.
5. (Supervisor) Records the independent full-suite verification above.

All commits stay on `work/parity-insight-growth-rate-planner`.
Final scope review and `git diff --check` passed at checkpoint 4.
Changed paths are limited to `packages/query-engine/src/planner.ts`,
the new test file, the updated PeriodOverPeriod, MaximumMinimum and
TopBottomRanked tests, the two new slice docs and `CHANGELOG.md`. The
supervisor owns the subsequent merge, publish, demo and completion
bookkeeping.
