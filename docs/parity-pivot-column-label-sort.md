# Pivot column label sorting — parity-pivot-column-label-sort

This phase-plan parity slice (`codex-parity-pivot-column-label-sort`) adds
QuickSight pivot `ColumnLabelSort`, mirroring [RowLabelSort](parity-pivot-row-label-sort.md).
It has no GitHub issue, new dependency, configuration variable or hosted-service
requirement.

## Configuration and validation

```json
{"sortConfiguration":{"columnLabelSort":[
  {"fieldSort":{"fieldId":"year","direction":"ASC"}},
  {"fieldSort":{"fieldId":"quarter","direction":"DESC"}}
]}}
```

Native definitions use the PascalCase mirror:
`SortConfiguration.ColumnLabelSort[].FieldSort.FieldId` / `Direction`. The
converter maps both directions using the existing FieldSort wrapper schema.
This differs from the flat `FieldSortOptions` extension and measure-based
`ColumnSort` shape.

Multiple entries are allowed, at most one per bound Columns dimension. An empty
list is a no-op. Each entry must contain only `fieldSort`; that object accepts
only `fieldId` and `direction`. The compiler defaults an omitted direction to
`ASC`; explicit directions must be `ASC` or `DESC`. Malformed lists/objects,
unknown keys at every level, duplicate field IDs, row dimensions, measures and
unbound IDs raise named `CompileError`s. Bound IDs and result aliases may differ
from source column names when compiling.

Every other visual kind rejects `columnLabelSort`, including an empty list.
Pivot continues to reject category sorts and the table-wrapper row-sort shape.

## Ordering and precedence

Each requested column dimension sorts its sibling groups by their own values,
using the shared `compareCells` total order: numbers, then strings, then
booleans in ascending order, reversed for descending. Numbers compare
numerically, strings lexically and booleans false-before-true. Null stays last
in both directions. Equal keys preserve first appearance; typed group identities
remain distinct, including when their display labels are identical.

Two precedence rules apply:

1. `ColumnLabelSort` supersedes `fieldSortOptions` for the **same column field**.
   Other column levels keep their field sort or first-appearance order, including
   inside a sorted parent.
2. Measure-based `ColumnSort` supersedes both label-sort forms at the
   **outermost column level only**. Inner ColumnLabelSort entries still apply.
   Without ColumnSort, an outer ColumnLabelSort applies normally. Aggregate ties
   preserve first appearance rather than falling back to a label sort.

Row ordering is unaffected, including RowSort, RowLabelSort and row field sorts.
Column subtotals remain immediately after their group; grand totals remain
last. Input rows and all detail/subtotal/total values are unchanged. Definitions
without ColumnLabelSort retain the existing complete pivot output baselines,
and empty lists produce byte-identical output to absent lists.

## Authoring, storage and import

Pivot Properties → **Column label sort** lists each assigned Columns dimension
using its display name. **Default**, **Ascending** and **Descending** clear or
set that field's entry independently. With no Columns field the section
explains the prerequisite. Rows never appear in this section.

Draft `pivotColumnLabelSorts` holds unique `{fieldId, direction}` entries.
Storage and the reducer validate structure, explicit direction and Columns
membership. Invalid edits preserve the last valid state. Removing a column
field or moving it to Rows clears only its entry. Dataset remaps and O-generated
well replacement clear entries whose dimensions leave Columns. Changing away
from pivot clears the state. Authored pivots serialize it only as
`columnLabelSort` inside `sortConfiguration`; other kinds never emit it.

Bundle/native imports require explicit valid directions and bound native field
IDs equal to their corresponding draft column names. Valid imports, including
empty lists, become editable state and survive storage, export, editing,
clearing and both dialect round-trips. Independent field and measure sorts
survive those edits.

Malformed, duplicate, unbound, measure/row-field and missing-direction imports
remain retained read-only with diagnostics and verbatim export. Native-ID/column-name
mismatches also remain read-only: no export-time field-ID rebinding is added.
Unrelated edits preserve retained sorts. The existing bundle envelope rejects
non-object outer sort configurations.

## Limits and verification

No pivot label-sort follow-up remains. Insight custom narratives remain
unsupported and need a product design decision. No broader QuickSight fidelity
is claimed; visual fidelity remains unmeasured.

`packages/web/test/pivot-column-label-sort.test.mjs` is reached by the existing
web test glob and root `npm test`. See [verification and captures](parity-pivot-column-label-sort-gap-notes.md).
