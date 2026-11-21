# Native Insight GrowthRate planning

Slice: `parity-insight-growth-rate-planner`, a phase-plan fallback
with no GitHub issue. Native/API `InsightVisual` definitions can pass
query planning with a `GrowthRate` computation. This extends the
native planner boundary established for Insight computations in issue
#257 (Forecast, PeriodToDate, UniqueValues, TopBottomMovers), the
anomaly slice, the MaximumMinimum slice, the TopBottomRanked slice
and the PeriodOverPeriod slice; the web narrative compiler already
executes all eleven computation kinds, but the native planner admitted
only eight.

## Admitted configuration

`planVisual` consumes native PascalCase definitions. This is an
`InsightConfiguration.Computations` entry:

```json
{
  "GrowthRate": {
    "ComputationId": "growth",
    "Name": "Revenue growth rate",
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
    "PeriodSize": 2
  }
}
```

## Validation

- The computation admits only `ComputationId`, `Name`, `Time`,
  `Value` and `PeriodSize`. Unknown properties fail through the
  existing `keys()` validator with `UNSUPPORTED_FEATURE`. In
  particular, properties belonging to other kinds (`Category`,
  `PeriodTimeGranularity`, `ForecastProperties`, `AnomalyDetection`,
  `Type`, `ResultSize`) are not admitted.
- `PeriodSize` is GrowthRate's own property (the PeriodOverPeriod
  slice rejected it there as an unknown key). When present it must be
  exactly `2`: the web compiler's `normalizeInsight` supports only
  the latest period versus the previous period and fails any other
  period size with `INSIGHT_PERIOD_UNSUPPORTED`. Any other value —
  another number, a non-number, or null — fails with
  `UNSUPPORTED_FEATURE` at the `PeriodSize` property path. When
  `PeriodSize` is omitted the same latest-versus-previous semantics
  apply, matching the web compiler, which treats an omitted period
  size the same way.
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
- GrowthRate requires a date dimension, joining the existing
  Forecast/PeriodToDate/Anomaly/PeriodOverPeriod date-required rule.
  When `Time` is omitted and a companion derives a category dimension,
  validation fails with `UNSUPPORTED_FEATURE` at the
  `InsightConfiguration` path, just like a category-bound Forecast.
  This matches the web compiler's `INSIGHT_TIME_REQUIRED` rule for
  period computations.
- Every collection rule is unchanged: a non-movers insight still
  derives exactly one dimension and at least one measure (unless every
  computation is UniqueValues, which carries its COUNT carrier), the
  same field ID must bind consistently across computations, and
  TopBottomMovers still cannot combine with any other computation. A
  standalone GrowthRate therefore effectively requires both `Time` and
  `Value`; either may be omitted only when a companion computation
  derives the same dimension or measure.
- The other unadmitted kinds (`TotalAggregation`, `MetricComparison`)
  still fail with `UNSUPPORTED_FEATURE`.

## Planning contract and limits

This is **admissibility validation only**. An admitted GrowthRate
computation derives the same dimensions and measures as the equivalent
already-admitted PeriodToDate computation over the same fields: the
returned plan — dimensions, measures, calculations, filters, SQL and
parameters — is identical apart from each field's binding path, which
names the computation that owns the binding. Planning does not mutate
the input, and `evaluatePlan` results are unchanged across DuckDB,
PostgreSQL, MySQL, Redshift and Athena.

Growth-rate math and sentence rendering remain with the narrative
consumer. TotalAggregation derives no dimension and needs a separate
contract decision; MetricComparison remains a future slice (it binds
two measures, `FromValue` and `TargetValue`, against the planner's
current one-measure-per-field-ID derivation). This slice changes no
compiler, narrative, authoring UI, dependencies or hosted
infrastructure, and makes no live database or broader QuickSight
fidelity claim. See
[verification and scope limits](parity-insight-growth-rate-planner-gap-notes.md).
