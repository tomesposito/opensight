# Native Insight MetricComparison planner — gap notes

Slice: `parity-insight-metric-comparison-planner` (phase-plan fallback;
no GitHub issue). The supplied run brief is the implementation contract;
`SOLUTION_DESIGN.md` is unchanged.

## Scope and evidence

The native query-engine planner now admits `MetricComparison` Insight
computations alongside the nine kinds admitted earlier (Forecast,
PeriodToDate, UniqueValues, TopBottomMovers, Anomaly, MaximumMinimum,
TopBottomRanked, PeriodOverPeriod, GrowthRate). Validation remains fail
closed and does not change query planning: an admitted computation
derives the insight's single dimension and two SUM measures exactly as
the equivalent already-admitted computation pair over the same fields
does — two PeriodToDate computations for a date `Time`, two
MaximumMinimum computations for a category `Time`. `Time` is a generic
dimension field, dispatched on its variant like MaximumMinimum and
TopBottomRanked, and no date dimension is required. Both `FromValue`
and `TargetValue` are required and must bind distinct measures: the
web compiler resolves an omitted binding positionally, but the planner
derives measures by field identity, so an omitted binding has no
identity whose distinctness can be checked and fails closed instead.
Tests compare the complete plan (dimensions, measures, calculations,
filters, SQL and parameters), omitting only each field's binding path,
which names the computation that owns the binding. Accepted definitions
are checked for mutation.

`packages/query-engine/test/insight-metric-comparison-planner.test.mjs`
adds **49 tests**, automatically included by the query-engine
`test/*.test.mjs` glob reached by root `npm test`. The acceptance matrix
covers MONTH, YEAR, QUARTER, DAY and omitted granularity (default DAY)
across DuckDB, PostgreSQL, MySQL, Redshift and Athena. Each case compares
plans and fixture evaluation against the PeriodToDate pair with the
existing filter and with the filter removed; the MONTH case also asserts
the ordered two-measure SUM series, including its null aggregates.
Category-`Time` cases compare against the MaximumMinimum pair on every
dialect. Companion cases cover omitted `Time` with both a date and a
category companion, and consistent shared field IDs in either
computation order. The prepared-visual path compares the full plan and
fixture results without mutating the definition. Valid shared ID bounds
and string names are covered too.

Negative cases assert exact error codes **and full paths** for missing
`FromValue`/`TargetValue`, a target binding the same measure as the
from binding (same field ID and column), the same field ID rebound to
a different column, unknown properties (including properties belonging
to other kinds), malformed/missing IDs, non-string names, measure or
numerical-dimension fields as `Time`, date- and category-column type
mismatches, unsupported granularity, unbound time/from/target fields,
non-SUM or absent aggregation, nonnumeric from/target values,
duplicate/case-ambiguous computation IDs, inconsistent date-grain or
measure-column rebinding, two derived dimensions, a standalone
MetricComparison with no derived dimension, and movers combinations.
Two distinct field IDs over the same column are admitted as two
distinct measures. TotalAggregation remains rejected at its kind path.
The GrowthRate, PeriodOverPeriod, MaximumMinimum and TopBottomRanked
regression tables no longer treat MetricComparison as unsupported.

## Focused verification

The strict TypeScript query-engine build passed (exit **0**, including
its bundle-parser build dependency). The requested focused command
exited **0** with **227 passed / 0 failed / 0 skipped**, zero
cancellations and zero todos:

```sh
npm run build --workspace @opensight/query-engine
TZ=UTC node --test --test-isolation=none \
  packages/query-engine/test/insight-metric-comparison-planner.test.mjs \
  packages/query-engine/test/planner.test.mjs \
  packages/query-engine/test/insight-growth-rate-planner.test.mjs \
  packages/query-engine/test/insight-period-over-period-planner.test.mjs \
  packages/query-engine/test/insight-maximum-minimum-planner.test.mjs \
  packages/query-engine/test/insight-top-bottom-ranked-planner.test.mjs
```

| Focused file | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| MetricComparison planner | 49 | 0 | 0 |
| Planner | 30 | 0 | 0 |
| GrowthRate planner | 44 | 0 | 0 |
| PeriodOverPeriod planner | 42 | 0 | 0 |
| MaximumMinimum planner | 28 | 0 | 0 |
| TopBottomRanked planner | 34 | 0 | 0 |
| **Total** | **227** | **0** | **0** |

Per-file counts were confirmed by running each file individually with
the same command shape; all passed on the first run, with no
self-correction needed. No browser was needed. No other test commands
were run at this checkpoint.

## Full-suite verification

The supervisor's independent full root run exited **0** with **8,083
passed / 0 failed / 37 skipped** (8,120 tests, zero cancellations and
zero todos), using the installed Playwright headless shell:

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
| Query engine | 2,588 | 0 | 2 |
| Web | 3,402 | 0 | 0 |
| Root checks | 110 | 0 | 0 |
| **Total** | **8,083** | **0** | **37** |

All 37 skips require live PostgreSQL (35 API, 2 query engine). The
total is exactly the GrowthRate slice's baseline (8,034 passed) plus
the 49 new tests, with no other movement. The completed log is
`.opensight/verification/metric-comparison-root.log`, with its exit
code in `metric-comparison-root.exit` in the same directory. A VM
reboot interrupted the run's registry entry between checkpoints 4 and
5; all four checkpoints were already committed on the branch and the
full suite ran in the fresh boot window.

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
It does not claim live database or AWS verification. Comparison math
and sentence rendering remain with the narrative consumer.
TotalAggregation stays fail closed for a future slice; it derives no
dimension, so it needs a contract decision before changing the
exactly-one-dimension rule. With MetricComparison admitted, it is the
only Insight computation kind the native planner still rejects.

No dependencies, package manifests, lockfiles or `SOLUTION_DESIGN.md`
are changed. No AWS calls or network access were used. No contract
ambiguity was encountered; the one judgment call — requiring both
from/target bindings explicitly instead of mirroring the web compiler's
positional fallback for omitted bindings — is recorded in the spec doc
and the run brief.

## Checkpoints and final scope review

The checkpoints follow the GrowthRate slice's pattern:

1. `ba80e982` specifies the admission and planning contract.
2. `5934693b` admits MetricComparison in the native planner.
3. `9f9e07f4` adds focused coverage and updates the regression tables.
4. `622cc18f` records these gap notes, the changelog entry and focused verification.
5. (Supervisor) Records the independent full-suite verification above.

All commits stay on `work/parity-insight-metric-comparison-planner`.
Changed paths are limited to `packages/query-engine/src/planner.ts`,
the new test file, the updated GrowthRate, PeriodOverPeriod,
MaximumMinimum and TopBottomRanked tests, the two new slice docs and
`CHANGELOG.md`. The supervisor owns the subsequent merge, publish, demo
and completion bookkeeping.
