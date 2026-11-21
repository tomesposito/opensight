# Native category-items-limit planning

Slice: `parity-category-limit-planner`, a phase-plan fallback with no GitHub
issue. Native `BarChartVisual`, `LineChartVisual` (including `Type: "AREA"`)
and `PieChartVisual` definitions can now pass query planning with
`CategoryItemsLimit`. This extends the native planner boundary for the earlier
[category limits compiler slice](parity-category-limit.md), which computes the
limit over supplied rows in the web compiler.

## Admitted configuration

`planVisual` consumes native PascalCase definitions. This is an alternative
`ChartConfiguration.SortConfiguration` value, and it may coexist with a valid
`CategorySort`:

```json
{
  "CategoryItemsLimit": { "ItemsLimit": 5, "OtherCategories": "EXCLUDE" }
}
```

No additional configuration or environment variables are required.

## Validation

- `SortConfiguration` admits only `CategorySort` and `CategoryItemsLimit`. An
  empty configuration is a no-op. Every other key keeps the previous
  whole-block rejection (`UNSUPPORTED_FEATURE` at the `SortConfiguration`
  path, "unrecognized execution property").
- `CategoryItemsLimit` must be an object admitting only `ItemsLimit` and
  `OtherCategories`; unknown keys fail closed.
- `ItemsLimit` may be omitted (admitted as a no-op, mirroring the compiler's
  "no slice limit specified" behavior). When present it must be an integer
  between 1 and 100 inclusive.
- `OtherCategories` may be omitted (the compiler's `INCLUDE` default). When
  present it must be `INCLUDE` or `EXCLUDE`.
- Table, KPI and other visual gates are unchanged: KPI retains its existing
  `TrendGroupSort` handling and tables still reject `SortConfiguration`.

Diagnostics follow the existing `QueryEngineError` conventions:

| Condition | Code |
| --- | --- |
| Non-object limit, out-of-range or non-integer `ItemsLimit`, invalid `OtherCategories` | `INVALID_INPUT` |
| Unknown keys at any level, or any other `SortConfiguration` key on a category chart | `UNSUPPORTED_FEATURE` |

## Ordering contract and limits

This is **admissibility validation only**. Every admitted limit leaves the
entire returned plan deep-equal to the same visual without
`SortConfiguration`: dimensions, measures, calculations, filters, SQL,
parameters and every other plan field. There are no new plan fields and no
SQL changes.

The compiler/consumer still owns computing the limit: top-N categories in
display order, with the remaining categories merged into `Other` rows when
`OtherCategories` is `INCLUDE`. Native query results alone do not acquire
limiting. See [verification and scope limits](parity-category-limit-planner-gap-notes.md).
