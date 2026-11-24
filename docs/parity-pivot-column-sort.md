# Pivot column sorting — parity-pivot-column-sort

This phase-plan fallback adds QuickSight `ColumnSort` to pivots. It has no
GitHub issue, new dependency, environment variable or hosted-service requirement.

## Configuration and validation

```json
{"sortConfiguration":{"columnSort":[{
  "sortBy":{"dataSetIdentifier":"sales_data","columnName":"revenue"},
  "direction":"DESC",
  "aggregationFunction":{"numericalAggregationFunction":{"simpleNumericalAggregation":"SUM"}}
}]}}
```

Native definitions use the PascalCase mirror: `SortConfiguration.ColumnSort`,
`SortBy.DataSetIdentifier` / `ColumnName`, `Direction`, and
`AggregationFunction.NumericalAggregationFunction.SimpleNumericalAggregation`.
There is no `FieldId` in this shape. The converter preserves both dialects.

The list supports one entry; an empty list is a no-op. Direction defaults to
`ASC` when omitted. Aggregation defaults to `SUM` when its entire object is
omitted; a supplied object must contain the numerical form and one of `SUM`,
`AVERAGE`, `MIN`, `MAX`, `COUNT`, `DISTINCT_COUNT`. Date and categorical
aggregation variants are unsupported.

`sortBy` must match a bound measure's dataset identifier and source column.
The compiler resolves its field ID independently of its column name and result
alias. At least one Columns dimension is required. Malformed lists/objects,
multiple entries, unknown keys at any level, unbound measures, unsupported
aggregations and invalid directions raise named `CompileError`s.

Other visual kinds reject `columnSort`, including an empty list. Pivots still
reject category sorts and the table wrapper row-sort shape; the ColumnSort-shaped
pivot `RowSort` shipped separately as `parity-pivot-row-sort`.
`fieldSortOptions` may coexist with `columnSort`.

## Ordering and values

Only the outermost (first) column dimension's groups are reordered. Their keys
are aggregates of the selected measure over all supplied result rows beneath
each group, across every row and inner column level. These are already queried
result values; the sort does not introduce a raw-source query aggregation.
The existing pivot requirement for distinct complete detail groups remains.

SUM/AVERAGE/MIN/MAX operate on non-null numeric values; COUNT counts non-null
values and DISTINCT_COUNT counts distinct non-null values. Every function,
including counts, produces a null key for an all-null group. Null aggregates
sort last in both directions; non-finite aggregates fail closed. Ties preserve
first appearance, including when a field sort requests a different order.
Typed group keys remain distinct.

ColumnSort supersedes `fieldSortOptions` only for the first column dimension.
Inner column levels keep their field sort or first-appearance order within
each parent. All row field sorts still apply independently. Column subtotals
stay immediately after their group and grand totals stay last. Input rows,
row order, and all detail/subtotal/total values remain unchanged. Configurations
without ColumnSort retain the existing complete compiled-output baselines.

## Authoring, storage and import

Pivot Properties → **Column sort** offers a measure selector (**Default** clears
it), aggregation selector, and ascending/descending buttons. Selecting the first
measure starts at SUM descending. Display names label the choices. Without a
Columns field the control is disabled and explains the prerequisite.

Draft `pivotColumnSort` stores `{measureFieldId, direction, aggregation}`.
Storage and the reducer validate structure, direction, aggregation, pivot kind,
Columns presence and measure membership. Invalid edits preserve the last valid
state. Removing/replacing the referenced measure, removing the last Columns
field, or changing away from pivot clears the sort. This also covers O-generated
well replacement. Dataset remaps clear stale references; surviving sort columns
rebind alongside the wells on export. Authored pivots emit only `columnSort` for
this state, alongside any independent `fieldSortOptions`; other kinds never
emit it.

Bundle/native imports require an explicit valid direction and a sortBy column
matching a bound measure. Supported sorts become editable and survive storage,
editing, clearing and both dialect round-trips. Measure field IDs may differ
from column names. Omitted aggregation imports as SUM while the unchanged export
preserves the original omission. Empty lists remain retained no-ops.

Malformed, unbound, multiple-entry, unsupported-aggregation and missing-direction
imports retain diagnostics and their original definitions for verbatim export.
Unrelated edits preserve those retained sorts. Sort columns are not rewritten
on ordinary export; dataset remapping rebinds surviving editable sorts. The
existing bundle envelope rejects non-object outer sort configurations.

## Limits and verification

Pivot [RowLabelSort](parity-pivot-row-label-sort.md) and KPI
[TrendGroupSort](parity-kpi-trend-group-sort.md) are now supported. Pivot
`ColumnLabelSort` remains unsupported and fail closed.
This slice makes no broader QuickSight fidelity claim.

`packages/web/test/pivot-column-sort.test.mjs` is reached by the existing web
test glob and root `npm test`. See [verification and captures](parity-pivot-column-sort-gap-notes.md).
