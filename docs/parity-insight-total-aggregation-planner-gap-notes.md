# Native Insight TotalAggregation planner — gap notes

Slice: `parity-insight-total-aggregation-planner` (phase-plan fallback; no
GitHub issue). The supplied run brief is the implementation contract;
`SOLUTION_DESIGN.md` is unchanged.

## Scope and evidence

The native query-engine planner now admits `TotalAggregation` Insight
computations alongside the ten kinds admitted earlier (Forecast,
PeriodToDate, UniqueValues, TopBottomMovers, Anomaly, MaximumMinimum,
TopBottomRanked, PeriodOverPeriod, GrowthRate, MetricComparison) — every
Insight computation kind the web narrative compiler executes is now
admitted natively. Validation remains fail closed and does not change
query planning: an admitted TotalAggregation derives no dimension and,
when it shares its measure with a sibling computation or omits `Value`,
no new measure, so the collection plans exactly as the equivalent
collection without it does. Tests compare the complete plan (dimensions,
measures, calculations, filters, SQL and parameters) against that
equivalent plan, omitting only each field's binding path, which names
the computation that owns the binding. Both accepted and rejected input
definitions are checked for mutation.

The contract decision the MetricComparison slice deferred is recorded
in the spec doc: TotalAggregation binds only a measure, and the native
planner has no field wells to take a grouping dimension from, so a
collection containing a total must derive its single dimension from a
sibling computation and a TotalAggregation-only collection fails closed
with the existing `INVALID_INPUT` exactly-one-dimension rule.

`packages/query-engine/test/insight-total-aggregation-planner.test.mjs`
adds **27 tests**, automatically included by the query-engine
`test/*.test.mjs` glob reached by root `npm test`. The acceptance matrix
covers a total sharing a MaximumMinimum measure over a category
dimension and a PeriodToDate measure over a date dimension (in either
computation order), a total binding a second distinct measure against
the two-measure MaximumMinimum pair baseline, and a total omitting
`Value` beside a companion, across DuckDB, PostgreSQL, MySQL, Redshift
and Athena; plus the prepared-visual path. Negative cases assert exact
error codes and paths for a standalone total (with, without, and with a
second total), unknown keys, malformed computation IDs and names,
malformed `Value` bindings (wrong variant, non-SUM, missing aggregation,
string column, unbound column), duplicate computation IDs, inconsistent
rebinding of one field ID, a second derived dimension, the three-measure
cap, and a movers combination. Regression assertions in `planner.test.mjs`
and the GrowthRate, PeriodOverPeriod, MetricComparison, MaximumMinimum
and TopBottomRanked planner test files now expect a standalone
TotalAggregation to fail `INVALID_INPUT` under the dimension rule
instead of `UNSUPPORTED_FEATURE`.

## Verification

The strict TypeScript query-engine build passed as part of its test
command. The new test file plus the existing planner and Insight planner
tests passed **254 passed / 0 failed / 0 skipped** (27 new):

```sh
node --test --test-isolation=none \
  packages/query-engine/test/insight-total-aggregation-planner.test.mjs \
  packages/query-engine/test/planner.test.mjs \
  packages/query-engine/test/insight-metric-comparison-planner.test.mjs \
  packages/query-engine/test/insight-growth-rate-planner.test.mjs \
  packages/query-engine/test/insight-period-over-period-planner.test.mjs \
  packages/query-engine/test/insight-maximum-minimum-planner.test.mjs \
  packages/query-engine/test/insight-top-bottom-ranked-planner.test.mjs
```

This slice changes no UI, compiler, narrative or authoring surface, so
there are no demo captures: the rebuilt demo is compared against the
prior baseline in the supervisor's post-merge step and any visual delta
would be a regression, not a feature. The README hero GIF is not
refreshed because no user-visible UI changed (AGENTS.md §4 refreshes it
on phases that change user-visible UI). No new dependencies, AWS calls
or external network access were used. `SOLUTION_DESIGN.md` is unchanged.
Visual fidelity remains unmeasured.

## Full root suite

The complete root command uses the installed Playwright headless shell:

```sh
OPENSIGHT_CHROMIUM="$HOME/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell" TZ=UTC npm test
```

The suite ran in a detached local process and exited **0**:
**8,579 passed / 0 failed / 38 skipped** (**8,617 tests**, no
cancellations or todos). All 38 skips require live PostgreSQL: 36 in API
and 2 in query engine. All **3,595 web tests** passed and the
query-engine suite passed **2,731** (2 skipped), including the 27 new
TotalAggregation planner tests. The run was slow (~50 minutes) under
cross-sweep CPU contention on the shared VM; no test failed or flaked.

| Runner | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| API | 1,630 | 0 | 36 |
| Bundle parser | 213 | 0 | 0 |
| CLI | 78 | 0 | 0 |
| Embedding SDK | 10 | 0 | 0 |
| Headless SDK | 33 | 0 | 0 |
| Python SDK | 34 | 0 | 0 |
| MCP server | 82 | 0 | 0 |
| O interpreter | 42 | 0 | 0 |
| Parity | 11 | 0 | 0 |
| Query engine | 2,731 | 0 | 2 |
| Web | 3,595 | 0 | 0 |
| Root conformance/site checks | 120 | 0 | 0 |
| **Total** | **8,579** | **0** | **38** |

Full log: `/tmp/opensight-total-aggregation-root.log`; exit status:
`/tmp/opensight-total-aggregation-root.exit`. Only this complete run
contributes to the root totals.

All requested slice items are complete. The supervisor's post-merge
publishing shim is deferred as directed; this branch was neither merged
nor pushed.
