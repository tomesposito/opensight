# Native Insight TopBottomRanked planner — gap notes

Slice: `parity-insight-top-bottom-ranked-planner` (phase-plan fallback; no
GitHub issue). The supplied run brief is the implementation contract;
`SOLUTION_DESIGN.md` is unchanged.

## Scope and evidence

The native query-engine planner now admits `TopBottomRanked` Insight
computations alongside the six kinds admitted earlier (Forecast,
PeriodToDate, UniqueValues, TopBottomMovers, Anomaly, MaximumMinimum).
Validation remains fail closed and does not change query planning: an
admitted computation derives the insight's single dimension and SUM
measure exactly as the equivalent already-admitted computation over the
same fields does. Tests compare the complete plan (dimensions, measures,
calculations, filters, SQL and parameters) against that equivalent plan,
omitting only each field's binding path, which names the computation
that owns the binding. Accepted definitions are checked for mutation.

`packages/query-engine/test/insight-top-bottom-ranked-planner.test.mjs`
adds **34 tests**, automatically included by the query-engine
`test/*.test.mjs` glob reached by root `npm test`. The acceptance matrix
covers TOP and BOTTOM over a category dimension (plan-identical to the
admitted MaximumMinimum series) and a MONTH-grain date dimension
(plan-identical to the admitted Anomaly series), across DuckDB,
PostgreSQL, MySQL, Redshift and Athena; `ResultSize` absent and at bounds
1 and 20; companion computations that derive the same dimension or
measure when TopBottomRanked omits `Category` or `Value`; and the
prepared-visual path. Negative cases assert exact error codes (and the
`.Type` and `.ResultSize` paths) for a missing/invalid `Type`, invalid
`ResultSize`, unknown keys, malformed names/IDs, a measure field as
`Category`, date/category type mismatches, an unsupported granularity,
a non-SUM or unbound value, an unbound category, duplicate computation
IDs, inconsistent rebinding of one field ID, two derived dimensions,
a standalone TopBottomRanked missing its dimension or measure, a movers
combination, and continued rejection of TotalAggregation, GrowthRate,
PeriodOverPeriod and MetricComparison. The MaximumMinimum regression
table no longer treats TopBottomRanked as unsupported.

## Verification

The strict TypeScript query-engine build passed. Focused verification
exited **0** with **92 passed / 0 failed / 0 skipped** (34 new + 30
planner + 28 MaximumMinimum tests), with zero cancellations and zero
todos:

```sh
npm run build --workspace @opensight/query-engine
TZ=UTC node --test --test-isolation=none \
  packages/query-engine/test/insight-top-bottom-ranked-planner.test.mjs \
  packages/query-engine/test/planner.test.mjs \
  packages/query-engine/test/insight-maximum-minimum-planner.test.mjs
```

The full root suite remains pending at checkpoint 4. Its command uses
the installed Playwright headless shell:

```sh
OPENSIGHT_CHROMIUM="$HOME/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell" TZ=UTC npm test
```

The focused log is `.opensight/verification/top-bottom-ranked-focused.log`.
Local verification logs are kept under the ignored
`.opensight/verification/` directory so they survive a VM reboot without
adding generated output to Git.

## Offline demo and reference comparison

This slice changes no rendering, authoring or UI code: it admits a
computation kind at the native planning boundary only. The expected
visual delta is therefore none. Demo rebuilding and reference comparison
are delegated to the watchdog after this branch is handed off; neither
is claimed as completed here. The README hero GIF and feature screenshots
need no refresh for this planner-only slice (AGENTS.md §4 refreshes media
when user-visible UI changes). The demo remains a local static artifact,
not a deployed server. Visual fidelity is not measured.

## Limits

This slice verifies planner admission and unchanged SQL/fixture results.
It does not claim live database or AWS verification. Ranking groups by
their SUM measure, applying `ResultSize` (including the default of 3),
typed-category tie-breaking and sentence rendering remain with the
narrative consumer. The remaining unadmitted computation kinds
(TotalAggregation, GrowthRate, PeriodOverPeriod, MetricComparison) stay
fail closed for a future slice; TotalAggregation in particular derives
no dimension, so it does not fit the planner's exactly-one-dimension rule
without a contract decision.

No dependencies, package manifests, lockfiles or `SOLUTION_DESIGN.md`
are changed. No AWS calls or network downloads were made.

## Checkpoints and final scope review

Checkpoints 1–3 were already committed before the VM interruption and
were preserved: the admission contract, planner validation, and tests.
Documentation and verification continue on
`work/parity-insight-top-bottom-ranked-planner`. Changed paths are limited
to `packages/query-engine/src/planner.ts`, the new test file, the updated
MaximumMinimum test, the two new slice docs and `CHANGELOG.md`.

The watchdog owns the subsequent merge, publish, demo and completion
bookkeeping loop; this resumption does not merge to `master` or publish.
