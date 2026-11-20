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

The query-engine package suite and full root suite are recorded in the final
verification checkpoint after they complete.

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
