# Table row sorting — parity-table-row-sort

This phase-plan fallback adds row sorting to TABLE visuals. It has no GitHub
issue. No new dependencies, configuration or hosted service is needed.

## Configuration and validation

The internal table configuration accepts only `rowSort` inside
`sortConfiguration`:

```json
{"sortConfiguration":{"rowSort":[{"fieldSort":{"fieldId":"revenue","direction":"DESC"}}]}}
```

The existing native-definition converter maps `SortConfiguration.RowSort`,
`FieldSort`, `FieldId` and `Direction` to that internal shape and back.
The list accepts zero or one entry. Missing direction defaults to `ASC` in
the compiler; explicit directions must be `ASC` or `DESC`. The field ID must
reference any bound groupBy dimension or value measure, including a later
groupBy dimension. Result-column aliases are resolved through bindings.
Malformed lists, unknown wrapper/field-sort/configuration keys, unbound IDs
and multiple entries raise a named `CompileError`.

Tables reject category, category-limit, facet and breakdown sort settings.
Other visual kinds reject `rowSort`. KPI and insight reject `sortConfiguration`
entirely. Pivot accepts [dimension field sorts](parity-pivot-field-sort.md) and
[measure-based ColumnSort](parity-pivot-column-sort.md);
table dataLabels, tooltip and legend gates are unchanged.

## Ordering

The existing shared `compareCells` comparator sorts numeric pairs numerically
and other non-null pairs as strings. Null remains last in both directions.
Equal keys preserve supplied order. Sorting does not mutate the caller's rows.
A plain table returns the sorted rows directly.

Totals/subtotals use the existing hierarchical table path. Typed group keys
remain distinct even when a measure sort interleaves source groups. Group
order follows first appearance in the sorted rows, and details within each
group follow that order. Subtotals stay after their group; the grand total
stays last. Tests compare subtotal and total values with the unsorted compile.
With no row sort, all compiled output matches the pre-slice baseline bytes.

## Authoring and import

Table Properties exposes **Row sort** with a field select containing all
assigned groupBy dimensions and measures, labeled with their display names.
**Default order** clears the sort. Choosing a dimension starts ascending;
choosing a measure starts descending. The arrow buttons select ascending or
descending explicitly. An invalid selection preserves the last valid sort.
Removing the sorted field clears the sort through the existing reducer cleanup.

The shared `groupSort` state and draft-storage validation are reused. Tables
serialize it only as `rowSort`; bar, percentage bar and pie still serialize
`categorySort`. Group/Color is not mounted for tables.

Bundle import requires exactly one valid wrapper with an explicit direction
and a bound field. Malformed, unbound, missing-direction or multi-entry sorts
remain retained read-only, with import diagnostics and verbatim export.
Like category sorts, row sorts have no export-time field-ID rebinding. Imported
sorts whose native IDs differ from draft column names therefore stay read-only;
the compiler itself supports arbitrary bound IDs. A column name that does not
identify the same native field cannot bypass import validation.

## Limits and verification

Only a **single sort entry** is supported, matching the existing categorySort
limit. [Pivot ColumnSort](parity-pivot-column-sort.md) now supports ordering outer
column groups by a measure. Pivot `RowLabelSort` and KPI `TrendGroupSort` remain
unsupported and fail closed. No broader QuickSight fidelity claim is made.

`packages/web/test/table-row-sort.test.mjs` is included by the existing web
`test/*.test.mjs` glob, reached by root `npm test`. It covers both dialects,
validation, typed ordering, totals, baselines, authoring/storage, bundle/native
round-trips and Properties controls. See [verification and captures](parity-table-row-sort-gap-notes.md).

## Follow-up (parity-table-row-sort-planner)

Native/API `TableVisual` definitions now admit `RowSort` in the query planner,
with strict validation and unchanged plans, SQL and fixture results — see
[parity-table-row-sort-planner.md](parity-table-row-sort-planner.md). The
compiler/consumer still owns display ordering; native query results alone do
not acquire the requested row order.
