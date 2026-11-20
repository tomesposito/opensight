# Native KPI trend aggregation-sort planner — gap notes

Slice: `parity-kpi-trend-agg-sort-planner` (phase-plan fallback; no GitHub issue).

## Scope and evidence

The query-engine KPI validator now admits the compiler's supported
`AggregationSort` shape for `TrendGroupSort`. Validation remains fail closed and
does not change grouped query ordering. The full plan is deep-equal to its
no-sort counterpart, without omitting any fields. SQL strings and `evaluatePlan`
outputs are also compared directly, including null aggregates, multiple groups,
and a target that remains the second SUM measure.

`packages/query-engine/test/kpi-trend-agg-sort.test.mjs` adds 158 tests. The
acceptance matrix covers all six aggregations, ASC/DESC/omitted direction,
categorical/date trends and direct/wrapped wells across DuckDB, PostgreSQL,
MySQL, Redshift and Athena. Negative cases verify named error codes and paths
for malformed/mixed/unknown shapes, invalid bindings, target-only columns,
unsupported aggregations and non-KPI gates. FieldSort retains explicit
admission and error-message regression coverage; the pre-existing DESC case is
unchanged.

The documentation search covered `docs/` and `packages/query-engine/README.md`.
Only the preceding aggregation-sort slice and its gap notes stated that this
planner boundary was open. Both retain their historical evidence and receive
an appended closure note. No other planner-rejection statement needed changing.

## Verification

The strict TypeScript package build passed. The focused regression command was:

```sh
TZ=UTC node --test --test-isolation=none \
  packages/query-engine/test/kpi-trend.test.mjs \
  packages/query-engine/test/kpi-trend-agg-sort.test.mjs
```

Result: **161 passed / 0 failed / 0 skipped**, with zero cancellations or todos.
Log: `/tmp/opensight-kpi-trend-agg-sort-planner-focused.log`.

The query-engine package suite then passed:

```sh
TZ=UTC npm test --workspace @opensight/query-engine
```

Result: **1,028 passed / 0 failed / 2 skipped** (1,030 tests), with zero
cancellations or todos. Log:
`/tmp/opensight-kpi-trend-agg-sort-planner-query-engine.log`.

Before the full root run, a direct startup probe of the default
`/opt/meta-chromium/chrome` against `about:blank` exited 13 with
`Hatch WebGL domain policy is required for browser startup`. The full suite uses
the brief's installed Playwright headless-shell fallback:

```sh
TZ=UTC OPENSIGHT_CHROMIUM="$HOME/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell" npm test
```

The probe log is `/tmp/opensight-kpi-trend-agg-sort-planner-chromium-probe.log`.
The full root command exited **0**:

| Suite | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| API | 1,500 | 0 | 35 |
| Bundle parser | 213 | 0 | 0 |
| CLI | 73 | 0 | 0 |
| Embedding SDK | 10 | 0 | 0 |
| Headless SDK | 28 | 0 | 0 |
| Python headless SDK | 32 | 0 | 0 |
| MCP server | 74 | 0 | 0 |
| O interpreter | 42 | 0 | 0 |
| Parity | 11 | 0 | 0 |
| Query engine | 1,028 | 0 | 2 |
| Web | 3,402 | 0 | 0 |
| Root conformance and site | 110 | 0 | 0 |
| **Total** | **6,523** | **0** | **37** |

There were **6,560 tests**, including the separately reported 32 Python tests,
with **zero cancellations and zero todos**. All 37 skips are existing
live-Postgres cases: 36 require `DATABASE_URL` and one requires live TLS
PostgreSQL. The focused query-engine suite's two skips are included in that
same set. No test was newly skipped, and no assertion or timing threshold was
relaxed. Browser tests passed using the fallback above.

Full log: `/tmp/opensight-kpi-trend-agg-sort-planner-root.log`. Parsed per-suite
counts: `/tmp/opensight-kpi-trend-agg-sort-planner-test-counts.json`.

## Limits

This slice verifies native planner admission and unchanged SQL/fixture results;
it does not claim live database or AWS verification. The compiler/consumer still
owns display sorting. Sort aggregates do not replace primary/target SUM queries
or expand the earlier compiler's result-based aggregation semantics.

There is no UI change. Per the slice brief, no static-demo rebuild, screenshots,
reference comparison or README GIF regeneration is performed; the supervisor
rebuilds the demo after merge. Visual fidelity is not measured. No dependencies,
package manifests, lockfiles or `SOLUTION_DESIGN.md` are changed. No AWS calls,
network downloads, push or merge are part of this work.

All five numbered checkpoints are committed only on
`work/parity-kpi-trend-agg-sort-planner`. Final whitespace and scope checks pass;
the changes are limited to the planner, its new tests, the slice documentation,
historical addenda and the changelog.
