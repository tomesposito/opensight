# Native KPI trend aggregation-sort planning

Slice: `parity-kpi-trend-agg-sort-planner`, a phase-plan fallback with no GitHub
issue. Native KPI definitions with a measure-based `TrendGroupSort` can now pass
the query-engine planner and proceed through native query execution. This closes
the planner boundary recorded by the earlier
[compiler and authoring slice](parity-kpi-trend-aggregation-sort.md).

## Admitted configuration

`planVisual` consumes native PascalCase definitions. Under a KPI's
`ChartConfiguration.SortConfiguration`, this is an admitted sort:

```json
{
  "TrendGroupSort": [{
    "AggregationSort": {
      "FieldId": "trend-id",
      "Direction": "DESC",
      "Column": { "DataSetIdentifier": "sales_data", "ColumnName": "revenue" },
      "AggregationFunction": {
        "NumericalAggregationFunction": { "SimpleNumericalAggregation": "AVERAGE" }
      }
    }
  }]
}
```

The visual must bind `trend-id` as its single categorical or date trend dimension
and `revenue` as its primary `Values` measure in `sales_data`. Direct KPI field
wells and the `KPIFieldWells` wrapper are both supported. The shared validator
applies to DuckDB, PostgreSQL, MySQL, Redshift and Athena planning.

## Validation

- An explicit `TrendGroupSort` list contains exactly one entry with exactly one
  of `FieldSort` or `AggregationSort`. Empty lists/wrappers, multiple entries,
  mixed variants and `CategorySort` are rejected.
- `AggregationSort` admits only `FieldId`, `Direction`, `Column` and
  `AggregationFunction`. `FieldId` is a nonempty string identifying the bound
  trend dimension; a measure ID, column name substituted for a distinct field
  ID, unknown ID or absent trend dimension fails.
- `Direction` is `ASC` or `DESC`. Omission is admitted with the compiler's
  default of `ASC`; null and other values fail.
- `Column` admits only `DataSetIdentifier` and `ColumnName`. The existing column
  binder checks the declared dataset identifier and resolves the column. Its
  name must match a primary `Values` measure, using the Values portion of the
  parsed measures. Target-only, dimension and other dataset columns fail.
  A column used by both the primary value and target is eligible.
- `AggregationFunction` requires only `NumericalAggregationFunction`, whose
  only admitted key is the required `SimpleNumericalAggregation`.
  Its value is `SUM`, `AVERAGE`, `MIN`, `MAX`, `COUNT` or `DISTINCT_COUNT`.
  `AVG` is a measure-field spelling and is not admitted for sorts.
- Unknown keys at every nested level fail closed. Non-KPI visual configuration
  gates are unchanged; this does not admit aggregation sorts on other visuals.

Diagnostics follow the existing `QueryEngineError` conventions:

| Condition | Code |
| --- | --- |
| Malformed objects/lists, missing required strings, wrong trend ID, invalid direction or a resolved column outside primary Values | `INVALID_INPUT` |
| Unknown keys or unsupported aggregation strings, including `MEDIAN`, `PERCENTILE` and `AVG` | `UNSUPPORTED_FEATURE` |
| Wrong/missing dataset identifier or nonexistent column | `UNRESOLVED_BINDING` from the column binder |

The binder retains its existing security, type and calculation diagnostics.
Aggregation-sort nested errors include their property paths. Trend binding and
direction errors use the existing sort-block path and message style. The
`FieldSort` branch retains its checks, admitted definitions and error messages.

## Ordering contract and limits

This is **admissibility validation only**, matching the planner's existing
handling of `FieldSort`, including `DESC`. An admitted aggregation sort leaves
the entire returned plan unchanged: dimensions, measures, SQL, parameters and
all other fields are identical to the same visual without `SortConfiguration`.
No ordering field or SQL `ORDER BY` change is introduced. Grouped SQL still
orders by dimension positions; fixture evaluation retains dimension order and
the same grouped SUM results.

The consumer/compiler applies measure-based trend ordering to those grouped
results. Sort `AVERAGE` does not turn the primary query's SUM into AVG, and sort
`COUNT`/`DISTINCT_COUNT` do not count source records. The earlier compiler
slice's result-based aggregation limits, tie handling and null-last display
ordering remain unchanged. A raw native-query result does not acquire that
display order merely because its definition contains this sort.

Trended KPIs still require one primary SUM measure and, when present, a SUM
target. The target remains the second measure at the same grain. No compiler,
authoring, UI, demo, dependency or hosted infrastructure change is included.
See [verification and scope limits](parity-kpi-trend-agg-sort-planner-gap-notes.md).
