# Pivot field sorting — parity-pivot-field-sort

This phase-plan fallback adds dimension-value sorting to PIVOT visuals. It has
no GitHub issue. No new dependencies, configuration or hosted service is needed.

## Configuration and validation

Pivot configuration accepts only `fieldSortOptions` inside `sortConfiguration`:

```json
{"sortConfiguration":{"fieldSortOptions":[{"fieldId":"region","sortDirection":"ASC"},{"fieldId":"category","sortDirection":"DESC"}]}}
```

The native definition uses `SortConfiguration.FieldSortOptions` with flat
`FieldId` / `SortDirection` entries. The converter maps these names in both
directions; entries have no `FieldSort` wrapper. The compiler supports both
native PascalCase (`source: 'api'`) and internal camelCase (`source: 'bundle'`).

Each entry must reference a bound row or column dimension. Measures, unbound
IDs, duplicate entries, malformed lists/objects and unknown keys raise named
`CompileError`s. An omitted direction defaults to `ASC` in the compiler;
explicit directions must be `ASC` or `DESC`. An empty list leaves order unchanged.
Field IDs and result-column aliases need not match source column names.

Other visual kinds reject `fieldSortOptions`. Pivot rejects category/row sorts,
category limits, small-multiples sort/limit and breakdown settings inside the
sort configuration. Its existing dataLabels, tooltip and legend gates still
reject those properties.

## Ordering

Row and column axes are ordered independently. At each dimension level with a
sort entry, sibling groups use the shared `compareCells` comparator: numeric
pairs compare numerically; other non-null pairs compare as strings. Null stays
last in both directions. Equal keys preserve first appearance, and typed keys
remain separate even when they compare equal. Levels without an entry keep
first-appearance order, including inside a sorted parent.

Subtotals remain immediately after their group, and grand totals remain last.
The compiler changes only axis order; input rows and all detail, subtotal and
total values remain unchanged. Unsorted compiled output matches pre-slice bytes.

## Authoring and import

Pivot Properties exposes **Field sort**, with one row per assigned row/column
dimension, labeled with its display name. **Default**, **Ascending** and
**Descending** select or clear each field's sort independently. Invalid choices
preserve the last valid state.

Draft `pivotFieldSorts` stores unique `{fieldId, direction}` entries. Storage and
the reducer validate the structure, direction and dimension membership. Removing
a sorted field clears only that entry; moving it between the two axes keeps it.
Dataset remapping also clears entries whose dimensions leave the wells.
Changing away from pivot clears the pivot sorts. Authored pivots serialize this
state only as `fieldSortOptions`; other kinds never emit it.

Bundle import requires valid entries with explicit directions and native field
IDs equal to the corresponding draft column names. Those sorts become editable
state and survive draft, bundle and native round-trips. Malformed, unbound,
duplicate, measure or missing-direction entries stay retained read-only with
import diagnostics and verbatim export. Native-ID/column-name mismatches also
stay read-only: like category and table row sorts, pivot sorts have no
export-time field-ID rebinding. A malformed outer bundle configuration that is
not an object is rejected by the existing bundle-envelope validator.

## Limits and verification

Sorting is by each dimension's own values only; **sort-by-measure is not
supported**. Pivot `ColumnSort` / `RowLabelSort` and KPI `TrendGroupSort` remain
unsupported. This slice makes no broader QuickSight fidelity claim.

`packages/web/test/pivot-field-sort.test.mjs` is picked up by the existing web
`test/*.test.mjs` glob, reached by root `npm test`. It covers both dialects,
validation, independent multi-level ordering, nulls and typed keys, every total
and subtotal combination, authoring/storage, native/bundle round-trips, import
retention and Properties controls. Forty-eight full-output SHA-256 baselines
were captured from `809591f0` before compiler changes, including function source,
for populated, empty and unavailable rows across all total/subtotal combinations.

See [verification and captures](parity-pivot-field-sort-gap-notes.md).
