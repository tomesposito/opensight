# Native Insight MaximumMinimum planning

Slice: `parity-insight-maximum-minimum-planner`, a phase-plan fallback with
no GitHub issue. Native/API `InsightVisual` definitions can pass query
planning with a `MaximumMinimum` computation. This extends the native
planner boundary established for Insight computations in issue #257
(Forecast, PeriodToDate, UniqueValues, TopBottomMovers) and the anomaly
slice; the web narrative compiler already executes all eleven computation
kinds, but the native planner admitted only five.

## Admitted configuration

`planVisual` consumes native PascalCase definitions. This is an
`InsightConfiguration.Computations` entry:

```json
{
  "MaximumMinimum": {
    "ComputationId": "extremes",
    "Name": "Revenue extremes",
    "Time": {
      "DateDimensionField": {
        "FieldId": "order_date",
        "Column": { "DataSetIdentifier": "sales_data", "ColumnName": "order_date" },
        "DateGranularity": "MONTH"
      }
    },
    "Value": {
      "NumericalMeasureField": {
        "FieldId": "revenue",
        "Column": { "DataSetIdentifier": "sales_data", "ColumnName": "revenue" },
        "AggregationFunction": { "SimpleNumericalAggregation": "SUM" }
      }
    },
    "Type": "MAXIMUM"
  }
}
```

## Validation

- The computation admits only `ComputationId`, `Name`, `Time`, `Value` and
  `Type`. Unknown properties fail through the existing `keys()` validator
  with `UNSUPPORTED_FEATURE`. `ComputationId` and `Name` follow the shared
  insight rules (ID pattern and uniqueness; name must be a string).
- `Type` is required and must be `MAXIMUM` or `MINIMUM`; a missing or other
  value fails with `INVALID_INPUT` at the computation's `.Type` path,
  mirroring the TopBottomMovers type rule and the web compiler's
  `INSIGHT_COMPUTATION_INVALID` check.
- `Time` binds a single dimension field. QuickSight types it as a generic
  dimension field and the web binding resolves `category ?? time` against
  the insight's one dimension, so both `DateDimensionField` and
  `CategoricalDimensionField` are admitted, dispatched on the variant;
  any other field variant fails closed through the existing insight
  dimension validator. Date bindings keep the existing granularity and
  datetime-type rules; category bindings keep the string-type rule.
- `Value` binds through the existing insight measure validator: a
  `NumericalMeasureField` with an explicit `SUM` aggregation over a numeric
  column.
- MaximumMinimum does **not** require a date dimension: the narrative picks
  the highest or lowest group of the single bound dimension, date or
  category. It is not added to the Forecast/PeriodToDate/Anomaly
  date-required rule.
- Every collection rule is unchanged: a non-movers insight still derives
  exactly one dimension and at least one measure (unless every computation
  is UniqueValues, which carries its COUNT carrier), the same field ID must
  bind consistently across computations, and TopBottomMovers still cannot
  combine with any other computation. A standalone MaximumMinimum therefore
  effectively requires both `Time` and `Value`; either may be omitted only
  when a companion computation derives the same dimension or measure.
- The other unadmitted kinds (`TotalAggregation`, `TopBottomRanked`,
  `GrowthRate`, `PeriodOverPeriod`, `MetricComparison`) still fail with
  `UNSUPPORTED_FEATURE`.

## Planning contract and limits

This is **admissibility validation only**. An admitted MaximumMinimum
computation derives the same dimensions and measures as the equivalent
already-admitted computation over the same fields: the returned plan —
dimensions, measures, calculations, filters, SQL and parameters — is
identical, planning does not mutate the input, and `evaluatePlan` results
are unchanged across DuckDB, PostgreSQL, MySQL, Redshift and Athena.

The narrative consumer still owns picking the highest/lowest group and
rendering the sentence, including its share-of-total and tie behavior.
This slice changes no compiler, narrative, authoring UI, dependencies or
hosted infrastructure, and makes no live database or broader QuickSight
fidelity claim. See
[verification and scope limits](parity-insight-maximum-minimum-planner-gap-notes.md).
