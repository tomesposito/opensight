# Native table row-sort planning

Slice: `parity-table-row-sort-planner`, a phase-plan fallback with no GitHub
issue. Native/API `TableVisual` definitions can pass query planning with
`RowSort`. This extends the native planner boundary for the earlier
[table row-sort compiler slice](parity-table-row-sort.md).

## Admitted configuration

`planVisual` consumes native PascalCase definitions. This is a
`ChartConfiguration.SortConfiguration` value:

```json
{
  "RowSort": [{
    "FieldSort": { "FieldId": "revenue-id", "Direction": "DESC" }
  }]
}
```

The field ID must identify any bound `GroupBy` dimension or `Values` measure.
Categorical and date dimensions, including later dimensions, and calculated
measures use the same validator across DuckDB, PostgreSQL, MySQL, Redshift
and Athena. Field IDs need not equal column names. No additional
configuration or environment variables are required.

## Validation

- `SortConfiguration` admits only `RowSort`. An empty configuration is a
  no-op. Every other key retains the whole-block `UNSUPPORTED_FEATURE`
  rejection at the `SortConfiguration` path with the message
  `unrecognized execution property`.
- `RowSort` must be an array of zero or one entry. An empty list is a no-op.
  A single entry must be an object with exactly one key, `FieldSort`.
  `AggregationSort` alone fails with `UNSUPPORTED_FEATURE`; other, mixed
  or absent wrapper keys fail with `INVALID_INPUT`.
- `FieldSort` must be an object admitting only `FieldId` and `Direction`.
  Unknown properties fail through the existing `keys()` validator.
- `FieldId` must be a nonempty string without NUL identifying a bound
  dimension or measure. Unbound IDs and column names substituted for distinct
  field IDs fail. Existing field-well and security validation is unchanged.
- `Direction` may be omitted, using the consumer's default of `ASC`. When
  present it must be `ASC` or `DESC`; null and other values fail.
- Bar, line/area and pie keep `CategorySort` plus `CategoryItemsLimit` and
  reject `RowSort`. KPI keeps `TrendGroupSort`. Pivot and other unsupported
  visual kinds remain unsupported.

Diagnostics follow the existing `QueryEngineError` conventions. Paths below
are relative to `ChartConfiguration.SortConfiguration`:

| Condition | Code | Path |
| --- | --- | --- |
| Non-object configuration | `INVALID_INPUT` | Sort block |
| Any configuration key other than `RowSort` | `UNSUPPORTED_FEATURE` | Sort block |
| Non-array `RowSort` | `INVALID_INPUT` | `.RowSort` |
| Multiple entries, non-object entry, other/mixed/absent wrapper keys | `INVALID_INPUT` | Sort block |
| `AggregationSort` alone | `UNSUPPORTED_FEATURE` | `.RowSort[0].AggregationSort` |
| Non-object `FieldSort` | `INVALID_INPUT` | `.RowSort[0].FieldSort` |
| Unknown `FieldSort` property | `UNSUPPORTED_FEATURE` | `.RowSort[0].FieldSort.<property>` |
| Missing, empty, non-string or NUL-containing field ID | `INVALID_INPUT` | `.RowSort[0].FieldSort.FieldId` |
| Unbound field ID, column name substituted for a distinct ID, invalid direction | `INVALID_INPUT` | Sort block |

## Ordering contract and limits

This is **admissibility validation only**. Every admitted configuration leaves
the entire returned plan deep-equal to the same visual without
`SortConfiguration`: dimensions, measures, calculations, filters, SQL,
parameters and every other plan field. Planning does not mutate the input.
There are no new plan fields, SQL changes or `ORDER BY` changes.

The compiler/consumer still owns display ordering, including its existing
tie, null and total/subtotal behavior. Native query results alone do not
acquire display sort order. This slice changes no compiler, authoring UI,
dependencies or hosted infrastructure, and makes no live database or broader
QuickSight fidelity claim. See
[verification and scope limits](parity-table-row-sort-planner-gap-notes.md).
