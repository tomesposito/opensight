# Native category-sort planning

Slice: `parity-category-sort-planner`, a phase-plan fallback with no GitHub
issue. Native `BarChartVisual`, `LineChartVisual` (including `Type: "AREA"`)
and `PieChartVisual` definitions can now pass query planning with `CategorySort`.
This extends the native planner boundary for the earlier
[category aggregation-sort compiler slice](parity-aggregation-sort.md).

## Admitted configuration

`planVisual` consumes native PascalCase definitions. These are alternative
`ChartConfiguration.SortConfiguration` values:

```json
{
  "CategorySort": [{
    "FieldSort": { "FieldId": "category-id", "Direction": "DESC" }
  }]
}
```

```json
{
  "CategorySort": [{
    "AggregationSort": {
      "FieldId": "category-id",
      "Direction": "DESC",
      "Column": { "DataSetIdentifier": "sales_data", "ColumnName": "revenue" },
      "AggregationFunction": {
        "NumericalAggregationFunction": { "SimpleNumericalAggregation": "AVERAGE" }
      }
    }
  }]
}
```

The visual must bind `category-id` as its first category dimension and, for
`AggregationSort`, bind `revenue` in `Values` for `sales_data`. Category field
IDs and measure IDs need not equal column names. Categorical and date dimensions
use the same validator across DuckDB, PostgreSQL, MySQL, Redshift and Athena.
No additional configuration or environment variables are required.

## Validation

- `SortConfiguration` admits only `CategorySort`. An empty configuration is a
  no-op. An explicit `CategorySort` must be a list of exactly one object with
  exactly one of `FieldSort` or `AggregationSort`; empty/multiple entries and
  mixed/absent variants fail.
- `FieldSort` admits only `FieldId` and `Direction`. `AggregationSort` also
  admits `Column` and `AggregationFunction`. `FieldId` must be a nonempty
  string identifying a bound field: for `FieldSort`, the category dimension
  or any bound measure (matching the category editor's 'By field' selector
  and the web compiler — issue #320); for `AggregationSort`, the first bound
  category dimension only. An unbound ID, or the column name substituted for
  a distinct field ID, fails. Existing field-well cardinality rules are
  unchanged.
- `Direction` is `ASC` or `DESC`. Omission is admitted with the consumer's
  default of `ASC`; null and other values fail.
- `Column` admits only `DataSetIdentifier` and `ColumnName`. The existing
  binder resolves the dataset/column and checks access. The resolved column
  must match a bound `Values` measure, including a secondary or calculated
  measure. Dimension-only, unbound and nonexistent columns fail. A measure
  field ID cannot substitute for a different column name.
- `AggregationFunction` requires only `NumericalAggregationFunction`, whose
  only admitted key is the required `SimpleNumericalAggregation`. Its value
  must be `SUM`, `AVERAGE`, `MIN`, `MAX`, `COUNT` or `DISTINCT_COUNT`.
  `AVG`, `MEDIAN`, `PERCENTILE` and other strings fail.
- Unknown keys fail closed at every level. `CategoryItemsLimit`,
  `SmallMultiplesSort`, `SmallMultiplesLimitConfiguration`, `TrendGroupSort`,
  `RowSort`, `ColumnSort`, `FieldSortOptions` and `BreakdownItemsLimit` remain
  rejected on these category charts. Table, KPI and other visual gates are
  unchanged; KPI retains its existing `TrendGroupSort` handling.

Diagnostics follow the existing `QueryEngineError` conventions:

| Condition | Code |
| --- | --- |
| Malformed shapes, missing required strings, wrong category ID, invalid direction or a resolved column outside Values | `INVALID_INPUT` |
| Unknown keys or unsupported aggregation strings | `UNSUPPORTED_FEATURE` |
| Wrong/missing dataset identifier, nonexistent column or denied physical column | `UNRESOLVED_BINDING` from the binder |

The binder also retains its calculation and type diagnostics. Nested
aggregation errors include their property paths. Category binding/direction
errors use the sort-block path. Unsupported `SortConfiguration` keys on
category charts retain the previous whole-block rejection path and message.

## Ordering contract and limits

This is **admissibility validation only**. Every admitted sort leaves the
entire returned plan deep-equal to the same visual without
`SortConfiguration`: dimensions, measures, calculations, filters, SQL,
parameters and every other plan field. There are no new plan fields and no
SQL `ORDER BY` changes. Fixture evaluation retains the same grouped values
and dimension order, including null aggregates.

The compiler/consumer still owns display ordering. A sort aggregation is
applied to supplied grouped result values; it does not replace a measure's
query aggregation. Sort `AVERAGE` does not turn SUM into AVG, and sort
`COUNT`/`DISTINCT_COUNT` do not introduce source-record counts. The earlier
compiler's tie, null-ordering and result-based aggregation limits are unchanged.
Native query results alone do not acquire display sort order.

No compiler, authoring, UI, demo, dependency or hosted infrastructure change is
included. Native combo and other unsupported visual kinds gain nothing, even
where the web compiler already supports their sorting. See
[verification and scope limits](parity-category-sort-planner-gap-notes.md).

## Follow-up (parity-category-limit-planner)

`CategoryItemsLimit` has since joined `CategorySort` as an admitted
`SortConfiguration` key on these category charts in the native planner, with
the same validation-only, plan-invariant contract — see
[parity-category-limit-planner.md](parity-category-limit-planner.md). The
other keys named above remain rejected.

## Follow-up (issue #320)

`FieldSort` admission was widened to match the web compiler and the category
editor: a FieldSort may now reference any bound field — the category
dimension or a bound measure — instead of only the first category dimension.
`AggregationSort` keeps the first-category-dimension requirement for its
`FieldId`. The validation-only, plan-invariant contract is unchanged.
