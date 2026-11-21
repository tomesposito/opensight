# Native Insight PeriodOverPeriod planning

Slice: `parity-insight-period-over-period-planner`, a phase-plan fallback
with no GitHub issue. Native/API `InsightVisual` definitions can pass
query planning with a `PeriodOverPeriod` computation. This extends the
native planner boundary established for Insight computations in issue
#257 (Forecast, PeriodToDate, UniqueValues, TopBottomMovers), the
anomaly slice, the MaximumMinimum slice and the TopBottomRanked slice;
the web narrative compiler already executes all eleven computation
kinds, but the native planner admitted only seven.

## Admitted configuration

`planVisual` consumes native PascalCase definitions. This is an
`InsightConfiguration.Computations` entry:

```json
{
  "PeriodOverPeriod": {
    "ComputationId": "period",
    "Name": "Revenue period comparison",
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
    }
  }
}
```

## Validation

- The computation admits only `ComputationId`, `Name`, `Time` and
  `Value`. Unknown properties fail through the existing `keys()`
  validator with `UNSUPPORTED_FEATURE`. In particular, `PeriodSize` is
  not admitted: that property belongs to GrowthRate, while the web
  compiler allows only `time` and `value` beyond computationId/name for
  periodOverPeriod.
- `ComputationId` and `Name` follow the shared insight rules: a required
  ID matching `/^[\w-]{1,512}$/`, unique across the computation collection,
  and a string name when present. Invalid IDs, duplicate IDs and
  non-string names fail with `INVALID_INPUT` at their property paths.
- `Time`, when present, binds through the existing insight dimension
  validator with expected `date`: only a `DateDimensionField` over a
  datetime column, with granularity `YEAR`, `QUARTER`, `MONTH` or `DAY`
  (default `DAY`). Category and measure field variants fail closed.
- `Value`, when present, binds through the existing insight measure
  validator: a `NumericalMeasureField` with an explicit `SUM`
  aggregation over a numeric column.
- PeriodOverPeriod requires a date dimension, joining the existing
  Forecast/PeriodToDate/Anomaly date-required rule. When `Time` is
  omitted and a companion derives a category dimension, validation
  fails with `UNSUPPORTED_FEATURE` at the `InsightConfiguration` path,
  just like a category-bound Forecast. This matches the web compiler's
  `INSIGHT_TIME_REQUIRED` rule for period computations.
- Every collection rule is unchanged: a non-movers insight still
  derives exactly one dimension and at least one measure (unless every
  computation is UniqueValues, which carries its COUNT carrier), the
  same field ID must bind consistently across computations, and
  TopBottomMovers still cannot combine with any other computation. A
  standalone PeriodOverPeriod therefore effectively requires both
  `Time` and `Value`; either may be omitted only when a companion
  computation derives the same dimension or measure.
- The other unadmitted kinds (`TotalAggregation`, `GrowthRate`,
  `MetricComparison`) still fail with `UNSUPPORTED_FEATURE`.

## Planning contract and limits

This is **admissibility validation only**. An admitted PeriodOverPeriod
computation derives the same dimensions and measures as the equivalent
already-admitted PeriodToDate computation over the same fields: the
returned plan — dimensions, measures, calculations, filters, SQL and
parameters — is identical apart from each field's binding path, which
names the computation that owns the binding. Planning does not mutate
the input, and `evaluatePlan` results are unchanged across DuckDB,
PostgreSQL, MySQL, Redshift and Athena.

Period comparison math and sentence rendering remain with the narrative
consumer. TotalAggregation derives no dimension and needs a separate
contract decision; GrowthRate and MetricComparison remain future slices.
This slice changes no compiler, narrative, authoring UI, dependencies
or hosted infrastructure, and makes no live database or broader
QuickSight fidelity claim. See
[verification and scope limits](parity-insight-period-over-period-planner-gap-notes.md).
