# Pivot row sorting — parity-pivot-row-sort

This phase-plan fallback adds QuickSight pivot `RowSort` to pivots. It has no
GitHub issue, new dependency, environment variable or hosted-service requirement.
It mirrors the shipped ColumnSort slice (`parity-pivot-column-sort`) on the row
axis; the table `RowSort` wrapper shape is a different configuration and is
unchanged.

## Configuration and validation

```json
{"sortConfiguration":{"rowSort":[{
  "sortBy":{"dataSetIdentifier":"sales_data","columnName":"revenue"},
  "direction":"DESC",
  "aggregationFunction":{"numericalAggregationFunction":{"simpleNumericalAggregation":"SUM"}}
}]}}
```

Native definitions use the PascalCase mirror: `SortConfiguration.RowSort`,
`SortBy.DataSetIdentifier` / `ColumnName`, `Direction`, and
`AggregationFunction.NumericalAggregationFunction.SimpleNumericalAggregation`.
There is no `FieldId` in this shape. The converter preserves both dialects:
its `RowSort` schema is the union of the table wrapper members and the
ColumnSort-shaped members, whose key sets are disjoint, so each entry shape
converts without touching the other.

The list supports one entry; an empty list is a no-op. Direction defaults to
`ASC` when omitted. Aggregation defaults to `SUM` when its entire object is
omitted; a supplied object must contain the numerical form and one of `SUM`,
`AVERAGE`, `MIN`, `MAX`, `COUNT`, `DISTINCT_COUNT`. Date and categorical
aggregation variants are unsupported.

`sortBy` must match a bound measure's dataset identifier and source column.
The compiler resolves its field ID independently of its column name and result
alias. At least one Rows dimension is required. Malformed lists/objects,
multiple entries, unknown keys at any level, unbound measures, unsupported
aggregations and invalid directions raise named `CompileError`s. The wrapper
shape (`fieldSort`/`aggregationSort` entries) inside a pivot `rowSort` fails
closed as an unsupported property, exactly as before.

Other visual kinds reject the pivot row-sort shape, including an empty list
where `rowSort` is not a native key for the kind (tables keep their own
wrapper semantics). `fieldSortOptions` and `columnSort` may coexist with
`rowSort`; each aggregate sort orders only its own axis.

## Ordering and values

Only the outermost (first) row dimension's groups are reordered. Their keys
are aggregates of the selected measure over all supplied result rows beneath
each group, across every column and inner row level. These are already queried
result values; the sort does not introduce a raw-source query aggregation.
The existing pivot requirement for distinct complete detail groups remains.

SUM/AVERAGE/MIN/MAX operate on non-null numeric values; COUNT counts non-null
values and DISTINCT_COUNT counts distinct non-null values. Every function,
including counts, produces a null key for an all-null group. Null aggregates
sort last in both directions; non-finite aggregates fail closed. Ties preserve
first appearance, including when a field sort requests a different order.
Typed group keys remain distinct.

RowSort supersedes `fieldSortOptions` only for the first row dimension.
Inner row levels keep their field sort or first-appearance order within
each parent. All column sorts still apply independently. Row subtotals stay
with their group and grand totals stay last. Input rows, column order, and
all detail/subtotal/total values remain unchanged. Configurations without
RowSort retain the existing complete compiled-output baselines.

## Authoring, storage and import

Pivot Properties → **Row sort** offers a measure selector (**Default** clears
it), aggregation selector, and ascending/descending buttons. Selecting the first
measure starts at SUM descending. Display names label the choices. Without a
Rows field the control is disabled and explains the prerequisite.

Draft `pivotRowSort` stores `{measureFieldId, direction, aggregation}`.
Storage and the reducer validate structure, direction, aggregation, pivot kind,
Rows presence and measure membership. Invalid edits preserve the last valid
state. Removing/replacing the referenced measure, removing the last Rows
field, or changing away from pivot clears the sort. This also covers O-generated
well replacement. Dataset remaps clear stale references; surviving sort columns
rebind alongside the wells on export. Authored pivots emit only `rowSort` for
this state, alongside any independent `fieldSortOptions`/`columnSort`; other
kinds never emit it.

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

Pivot `RowLabelSort` and KPI `TrendGroupSort` remain unsupported and fail closed.
This slice makes no broader QuickSight fidelity claim.

`packages/web/test/pivot-row-sort.test.mjs` (74 tests) is reached by the
existing web test glob and root `npm test`. It also updates three assertions
in the pivot-column-sort, pivot-field-sort and table-row-sort suites where
they previously asserted that pivot `rowSort` is rejected outright; the
wrapper-shape rejection is still asserted in the table suite.
See [verification and captures](parity-pivot-row-sort-gap-notes.md).
