# Native Insight TopBottomRanked planning

Slice: `parity-insight-top-bottom-ranked-planner`, a phase-plan fallback
with no GitHub issue. Native/API `InsightVisual` definitions can pass
query planning with a `TopBottomRanked` computation. This extends the
native planner boundary established for Insight computations in issue
#257 (Forecast, PeriodToDate, UniqueValues, TopBottomMovers), the
anomaly slice and the MaximumMinimum slice; the web narrative compiler
already executes all eleven computation kinds, but the native planner
admitted only six.

## Admitted configuration

`planVisual` consumes native PascalCase definitions. This is an
`InsightConfiguration.Computations` entry:

```json
{
  "TopBottomRanked": {
    "ComputationId": "ranked",
    "Name": "Revenue ranking",
    "Category": {
      "CategoricalDimensionField": {
        "FieldId": "region",
        "Column": { "DataSetIdentifier": "sales_data", "ColumnName": "region" }
      }
    },
    "Value": {
      "NumericalMeasureField": {
        "FieldId": "revenue",
        "Column": { "DataSetIdentifier": "sales_data", "ColumnName": "revenue" },
        "AggregationFunction": { "SimpleNumericalAggregation": "SUM" }
      }
    },
    "Type": "TOP",
    "ResultSize": 3
  }
}
```

## Validation

- The computation admits only `ComputationId`, `Name`, `Category`,
  `Value`, `Type` and `ResultSize`. Unknown properties fail through the
  existing `keys()` validator with `UNSUPPORTED_FEATURE`.
  `ComputationId` and `Name` follow the shared insight rules (ID
  pattern and uniqueness; name must be a string).
- `Type` is required and must be `TOP` or `BOTTOM`; a missing or other
  value fails with `INVALID_INPUT` at the computation's `.Type` path,
  mirroring the MaximumMinimum and TopBottomMovers type rules and the
  web compiler's `INSIGHT_COMPUTATION_INVALID` check.
- `ResultSize` is optional; when present it must be an integer between
  1 and 20, failing with `INVALID_INPUT` at the computation's
  `.ResultSize` path. This mirrors the web compiler's
  `ResultSize must be 1–20` rule. The web default of 3 is a narrative
  concern, not a planning input.
- `Category` binds a single dimension field. QuickSight types it as a
  generic dimension field and the web binding resolves
  `category ?? time` against the insight's one dimension, so both
  `CategoricalDimensionField` and `DateDimensionField` are admitted,
  dispatched on the variant; any other field variant fails closed
  through the existing insight dimension validator. Category bindings
  keep the string-type rule; date bindings keep the existing
  granularity and datetime-type rules.
- `Value` binds through the existing insight measure validator: a
  `NumericalMeasureField` with an explicit `SUM` aggregation over a
  numeric column.
- TopBottomRanked does **not** require a date dimension: the narrative
  ranks the groups of the single bound dimension, date or category, by
  the bound measure. It is not added to the
  Forecast/PeriodToDate/Anomaly date-required rule.
- Every collection rule is unchanged: a non-movers insight still
  derives exactly one dimension and at least one measure (unless every
  computation is UniqueValues, which carries its COUNT carrier), the
  same field ID must bind consistently across computations, and
  TopBottomMovers still cannot combine with any other computation. A
  standalone TopBottomRanked therefore effectively requires both
  `Category` and `Value`; either may be omitted only when a companion
  computation derives the same dimension or measure.
- The other unadmitted kinds (`TotalAggregation`, `GrowthRate`,
  `PeriodOverPeriod`, `MetricComparison`) still fail with
  `UNSUPPORTED_FEATURE`.

## Planning contract and limits

This is **admissibility validation only**. An admitted TopBottomRanked
computation derives the same dimensions and measures as the equivalent
already-admitted computation over the same fields: the returned plan —
dimensions, measures, calculations, filters, SQL and parameters — is
identical apart from each field's binding path, which names the
computation that owns the binding. Planning does not mutate the input,
and `evaluatePlan` results are unchanged across DuckDB, PostgreSQL,
MySQL, Redshift and Athena.

The narrative consumer still owns ranking the groups, applying
`ResultSize`, and rendering the sentence, including its tie behavior.
This slice changes no compiler, narrative, authoring UI, dependencies
or hosted infrastructure, and makes no live database or broader
QuickSight fidelity claim. See
[verification and scope limits](parity-insight-top-bottom-ranked-planner-gap-notes.md).
