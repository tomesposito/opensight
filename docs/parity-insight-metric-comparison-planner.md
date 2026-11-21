# Native Insight MetricComparison planning

Slice: `parity-insight-metric-comparison-planner`, a phase-plan fallback
with no GitHub issue. Native/API `InsightVisual` definitions can pass
query planning with a `MetricComparison` computation. This extends the
native planner boundary established for Insight computations in issue
#257 (Forecast, PeriodToDate, UniqueValues, TopBottomMovers), the
anomaly slice, the MaximumMinimum slice, the TopBottomRanked slice,
the PeriodOverPeriod slice and the GrowthRate slice; the web narrative
compiler already executes all eleven computation kinds, but the native
planner admitted only nine.

## Admitted configuration

`planVisual` consumes native PascalCase definitions. This is an
`InsightConfiguration.Computations` entry:

```json
{
  "MetricComparison": {
    "ComputationId": "comparison",
    "Name": "Revenue vs profit",
    "Time": {
      "DateDimensionField": {
        "FieldId": "order_date",
        "Column": { "DataSetIdentifier": "sales_data", "ColumnName": "order_date" },
        "DateGranularity": "MONTH"
      }
    },
    "FromValue": {
      "NumericalMeasureField": {
        "FieldId": "revenue",
        "Column": { "DataSetIdentifier": "sales_data", "ColumnName": "revenue" },
        "AggregationFunction": { "SimpleNumericalAggregation": "SUM" }
      }
    },
    "TargetValue": {
      "NumericalMeasureField": {
        "FieldId": "profit",
        "Column": { "DataSetIdentifier": "sales_data", "ColumnName": "profit" },
        "AggregationFunction": { "SimpleNumericalAggregation": "SUM" }
      }
    }
  }
}
```

## Validation

- The computation admits only `ComputationId`, `Name`, `Time`,
  `FromValue` and `TargetValue`. Unknown properties fail through the
  existing `keys()` validator with `UNSUPPORTED_FEATURE`. In
  particular, properties belonging to other kinds (`Value`, `Category`,
  `PeriodTimeGranularity`, `ForecastProperties`, `AnomalyDetection`,
  `Type`, `ResultSize`, `PeriodSize`) are not admitted.
- `ComputationId` and `Name` follow the shared insight rules: a required
  ID matching `/^[\w-]{1,512}$/`, unique across the computation collection,
  and a string name when present. Invalid IDs, duplicate IDs and
  non-string names fail with `INVALID_INPUT` at their property paths.
- `Time`, when present, is a generic dimension field (the QuickSight
  API type for this computation): a `DateDimensionField` over a
  datetime column binds as a date dimension, and a
  `CategoricalDimensionField` over a string column binds as a category
  dimension — the same variant dispatch MaximumMinimum and
  TopBottomRanked use. Any other field variant fails closed. Unlike
  the period computations, MetricComparison does **not** require a
  date dimension: the web compiler has no time-required rule for this
  kind, because its narrative sums both measures over all rows.
- `FromValue` and `TargetValue`, when present, bind through the
  existing insight measure validator: a `NumericalMeasureField` with
  an explicit `SUM` aggregation over a numeric column.
- Both `FromValue` and `TargetValue` are **required**. The web
  compiler resolves an omitted binding positionally (the from-measure
  is measure index 0, the target is measure index 1), but the planner
  derives measures by field identity, not by position — an omitted
  binding has no identity whose distinctness can be checked. The
  planner therefore holds the stricter explicit line: a missing
  `FromValue` or `TargetValue` fails with `INVALID_INPUT` at the
  missing property path.
- The two bindings must be **distinct measures**. When both bind the
  same field ID over the same column, validation fails with
  `INVALID_INPUT` at the `TargetValue` property path — the web
  compiler's rule is that a metric comparison requires two distinct
  bound measures. The same field ID over a different column already
  fails with `UNRESOLVED_BINDING` inside the shared measure derivation.
- Every collection rule is unchanged: a non-movers insight still
  derives exactly one dimension and at least one measure (unless every
  computation is UniqueValues, which carries its COUNT carrier), the
  same field ID must bind consistently across computations, and
  TopBottomMovers still cannot combine with any other computation. A
  standalone MetricComparison therefore effectively requires `Time`
  as well; `Time` may be omitted only when a companion computation
  derives the same dimension. Its two required measures already
  satisfy the at-least-one-measure rule.
- The one remaining unadmitted kind (`TotalAggregation`) still fails
  with `UNSUPPORTED_FEATURE`.

## Planning contract and limits

This is **admissibility validation only**. An admitted MetricComparison
computation derives the same dimensions and measures as the equivalent
already-admitted computation pair over the same fields — two
PeriodToDate computations for a date `Time`, two MaximumMinimum
computations for a category `Time`: the returned plan — dimensions,
measures, calculations, filters, SQL and parameters — is identical
apart from each field's binding path, which names the computation that
owns the binding. Planning does not mutate the input, and
`evaluatePlan` results are unchanged across DuckDB, PostgreSQL, MySQL,
Redshift and Athena.

Comparison math (totals, difference, relative difference) and sentence
rendering remain with the narrative consumer. TotalAggregation derives
no dimension and needs a separate contract decision. This slice
changes no compiler, narrative, authoring UI, dependencies or hosted
infrastructure, and makes no live database or broader QuickSight
fidelity claim. See
[verification and scope limits](parity-insight-metric-comparison-planner-gap-notes.md).
