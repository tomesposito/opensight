# Native Insight TotalAggregation planning

Slice: `parity-insight-total-aggregation-planner`, a phase-plan fallback
with no GitHub issue. Native/API `InsightVisual` definitions can pass
query planning with a `TotalAggregation` computation. This extends the
native planner boundary established for Insight computations in issue
#257 and the per-kind admission slices that followed (Anomaly,
MaximumMinimum, TopBottomRanked, PeriodOverPeriod, GrowthRate,
MetricComparison); the web narrative compiler already executes all
eleven computation kinds, but the native planner admitted only ten.
With this slice, every web-supported Insight computation kind is
admitted by the native planner.

## Admitted configuration

`planVisual` consumes native PascalCase definitions. This is an
`InsightConfiguration.Computations` entry:

```json
{
  "TotalAggregation": {
    "ComputationId": "total",
    "Name": "Total revenue",
    "Value": {
      "NumericalMeasureField": {
        "FieldId": "revenue",
        "Column": { "DataSetIdentifier": "sales_data", "ColumnName": "revenue" },
        "AggregationFunction": { "SimpleNumericalAggregation": "SUM" }
      }
    }
  }
}
```

## Validation

- The computation admits only `ComputationId`, `Name` and `Value`.
  Unknown properties fail through the existing `keys()` validator with
  `UNSUPPORTED_FEATURE`. `ComputationId` and `Name` follow the shared
  insight rules (ID pattern and uniqueness; name must be a string).
- `Value`, when present, binds through the existing insight measure
  validator: a `NumericalMeasureField` with an explicit `SUM`
  aggregation over a numeric column. `Value` may be omitted only when a
  companion computation derives the insight's measure (the omission
  pattern the earlier slices established: bindings resolve
  per-computation and measures deduplicate by field identity).
- TotalAggregation derives **no dimension** — the QuickSight API types
  it with a value binding only. In the web flow the grouping dimension
  comes from the visual's category well (the author-query tests supply
  a dimension for a total-only configuration); the native planner has
  no field wells, because the computations own the fields. The planner
  therefore holds the explicit line: a collection containing
  TotalAggregation must derive the insight's single dimension from a
  sibling computation, and a TotalAggregation-only collection fails
  closed with the existing `INVALID_INPUT` "exactly one dimension"
  rule at the Computations path. This is the contract decision the
  MetricComparison slice deferred.
- TotalAggregation does **not** require a date dimension: its
  narrative sums the bound measure over the derived dimension's
  groups, whatever dimension kind a sibling binds.
- Every collection rule is unchanged: a non-movers insight still
  derives exactly one dimension and at most two distinct measures
  (issue #321), the same field ID must bind consistently across
  computations, and TopBottomMovers still cannot combine with any
  other computation — a TotalAggregation alongside a movers
  computation fails under the movers rule. A TotalAggregation binding a
  second distinct measure counts toward the two-measure cap exactly
  like any other computation's measure.

## Planning contract and limits

This is **admissibility validation only**. An admitted TotalAggregation
computation derives the same dimensions and measures as the equivalent
already-admitted collection over the same fields without it — a
MaximumMinimum over a category dimension, a PeriodToDate over a date
dimension, or a two-measure MaximumMinimum pair: the returned plan —
dimensions, measures, calculations, filters, SQL and parameters — is
identical apart from each field's binding path, which names the
computation that owns the binding. Planning does not mutate the input,
and `evaluatePlan` results are unchanged across DuckDB, PostgreSQL,
MySQL, Redshift and Athena.

Total math and sentence rendering remain with the narrative consumer.
This slice changes no compiler, narrative, authoring UI, dependencies
or hosted infrastructure, and makes no live database or broader
QuickSight fidelity claim. See
[verification and scope limits](parity-insight-total-aggregation-planner-gap-notes.md).
