# Native Insight PeriodOverPeriod planner — gap notes

Slice: `parity-insight-period-over-period-planner` (phase-plan fallback;
no GitHub issue). The supplied run brief is the implementation contract;
`SOLUTION_DESIGN.md` is unchanged.

## Scope and evidence

The native query-engine planner now admits `PeriodOverPeriod` Insight
computations alongside the seven kinds admitted earlier (Forecast,
PeriodToDate, UniqueValues, TopBottomMovers, Anomaly, MaximumMinimum,
TopBottomRanked). Validation remains fail closed and does not change
query planning: an admitted computation derives the insight's single
date dimension and SUM measure exactly as the equivalent already-admitted
PeriodToDate computation over the same fields does. Tests compare the
complete plan (dimensions, measures, calculations, filters, SQL and
parameters), omitting only each field's binding path, which names the
computation that owns the binding. Accepted definitions are checked for
mutation.

`packages/query-engine/test/insight-period-over-period-planner.test.mjs`
adds **42 tests**, automatically included by the query-engine
`test/*.test.mjs` glob reached by root `npm test`. The acceptance matrix
covers MONTH, YEAR, QUARTER, DAY and omitted granularity (default DAY)
across DuckDB, PostgreSQL, MySQL, Redshift and Athena. Each case compares
plans and fixture evaluation against PeriodToDate with the existing
filter and with the filter removed; the MONTH case also asserts the
ordered SUM series, including its null aggregate. Companion cases cover
omitted `Time`, omitted `Value`, both omitted, and consistent shared
field IDs in either computation order. The prepared-visual path compares
the full plan and fixture results without mutating the definition.
Valid shared ID bounds and string names are covered too.

Negative cases assert exact error codes **and full paths** for unknown
properties (including `PeriodSize` and properties belonging to other
kinds), malformed/missing IDs, non-string names, category or measure
fields as `Time`, date-column type mismatches, unsupported granularity,
unbound time/value fields, non-SUM or absent aggregation, nonnumeric
values, duplicate/case-ambiguous computation IDs, inconsistent date-grain
or measure-column rebinding, two derived dimensions, missing standalone
dimension/measure bindings, a UniqueValues companion that cannot supply
a COUNT carrier, category-derived companion dimensions, and movers
combinations. TotalAggregation, GrowthRate and MetricComparison remain
rejected at their kind paths. The MaximumMinimum and TopBottomRanked
regression tables no longer treat PeriodOverPeriod as unsupported.

## Focused verification

The strict TypeScript query-engine build passed (exit **0**, including
its bundle-parser build dependency). The requested focused command
exited **0** with **134 passed / 0 failed / 0 skipped**, zero
cancellations and zero todos:

```sh
npm run build --workspace @opensight/query-engine
TZ=UTC node --test --test-isolation=none \
  packages/query-engine/test/insight-period-over-period-planner.test.mjs \
  packages/query-engine/test/planner.test.mjs \
  packages/query-engine/test/insight-maximum-minimum-planner.test.mjs \
  packages/query-engine/test/insight-top-bottom-ranked-planner.test.mjs
```

| Focused file | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| PeriodOverPeriod planner | 42 | 0 | 0 |
| Planner | 30 | 0 | 0 |
| MaximumMinimum planner | 28 | 0 | 0 |
| TopBottomRanked planner | 34 | 0 | 0 |
| **Total** | **134** | **0** | **0** |

The first focused run exited **1** with **129 passed / 5 failed / 0
skipped**, zero cancellations and zero todos. Its five MONTH fixture
assertions expected `YYYY-MM-DD`; the existing evaluator returns
`YYYY-MM` for MONTH groups. The plan-equivalence assertions passed.
Only those expected fixture labels were corrected, then the identical
focused command was rerun successfully; no planner behavior was changed
to satisfy the assertion.

Logs are retained under the ignored `.opensight/verification/` directory:
`period-over-period-build.log`, `period-over-period-focused-initial.log`
and `period-over-period-focused.log`. No browser was needed. No other
test commands were run.

## Full-suite verification

The supervisor's independent full root run exited **0** with **7,990
passed / 0 failed / 37 skipped** (8,027 tests, zero cancellations and
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
| Query engine | 2,495 | 0 | 2 |
| Web | 3,402 | 0 | 0 |
| Root checks | 110 | 0 | 0 |
| **Total** | **7,990** | **0** | **37** |

All 37 skips require live PostgreSQL (35 API, 2 query engine). The
total is exactly the TopBottomRanked slice's baseline (7,948 passed)
plus the 42 new tests, with no other movement. The completed log is
`.opensight/verification/period-over-period-root.log`, with its exit
code in `period-over-period-root.exit` in the same directory.

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
It does not claim live database or AWS verification. Period comparison
math and sentence rendering remain with the narrative consumer.
TotalAggregation, GrowthRate and MetricComparison stay fail closed for
future slices; TotalAggregation derives no dimension, so it needs a
contract decision before changing the exactly-one-dimension rule.

No dependencies, package manifests, lockfiles or `SOLUTION_DESIGN.md`
are changed. No AWS calls or network access were used. No contract
ambiguity was encountered.

## Checkpoints and final scope review

The four checkpoints follow the TopBottomRanked slice's pattern:

1. `875925b1` specifies the admission and planning contract.
2. `ae05be07` admits PeriodOverPeriod and requires a date dimension.
3. `c3bd2b1b` adds focused coverage and updates the regression tables.
4. Records these gap notes, the changelog entry and focused verification.
5. (Supervisor) Records the independent full-suite verification above.

All commits stay on `work/parity-insight-period-over-period-planner`.
Final scope review and `git diff --check` passed. Changed paths are
limited to `packages/query-engine/src/planner.ts`, the new test file,
the updated MaximumMinimum and TopBottomRanked tests, the two new slice
docs and `CHANGELOG.md`. The supervisor owns the subsequent merge,
publish, demo and completion bookkeeping.
