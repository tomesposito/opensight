# Pivot row label sorting — parity-pivot-row-label-sort

This phase-plan parity slice (`codex-parity-pivot-row-label-sort`) adds
QuickSight pivot `RowLabelSort`. It has no GitHub issue, new dependency,
configuration variable or hosted-service requirement.

## Configuration and validation

```json
{"sortConfiguration":{"rowLabelSort":[
  {"fieldSort":{"fieldId":"region","direction":"DESC"}},
  {"fieldSort":{"fieldId":"category","direction":"ASC"}}
]}}
```

Native definitions use the PascalCase mirror:
`SortConfiguration.RowLabelSort[].FieldSort.FieldId` / `Direction`. The
converter maps both directions using the existing FieldSort wrapper schema.
This differs from the flat `FieldSortOptions` extension and the measure-based
`RowSort` shape.

Multiple entries are allowed, at most one per bound Rows dimension. An empty
list is a no-op. Each entry must contain only `fieldSort`; that object accepts
only `fieldId` and `direction`. The compiler defaults an omitted direction to
`ASC`; explicit directions must be `ASC` or `DESC`. Malformed lists/objects,
unknown keys at every level, duplicate field IDs, column dimensions, measures
and unbound IDs raise named `CompileError`s. Bound IDs and result aliases may
differ from source column names when compiling.

Every other visual kind rejects `rowLabelSort`, including an empty list.
Pivot continues to reject category sorts.
[ColumnLabelSort](parity-pivot-column-label-sort.md) is now supported.

## Ordering and precedence

Each requested row dimension sorts its sibling groups by their own values,
using the same shared `compareCells` function as pivot field sorting. Numeric
pairs compare numerically, strings lexically and booleans false-before-true.
Null stays last in both directions. Equal sort keys preserve first appearance;
typed group identities remain distinct.

The brief's numeric-pair/string-otherwise description predates issue #316.
The current shared comparator uses an explicit total order across types:
numbers, then strings, then booleans in ascending order (reversed for descending).
RowLabelSort follows that existing behavior, including for mixed-type fields;
it does not reintroduce the older intransitive comparison rule.

Two precedence rules apply:

1. `RowLabelSort` supersedes `fieldSortOptions` for the **same row field**.
   Other row levels keep their field sort or first-appearance order, including
   inside a sorted parent.
2. Measure-based `RowSort` supersedes both label-sort forms at the **outermost
   row level only**. Inner RowLabelSort entries still apply. Without RowSort,
   an outer RowLabelSort applies normally. Aggregate ties preserve first
   appearance rather than falling back to a label sort.

Column ordering is unaffected, including existing field sorts and ColumnSort.
Subtotals remain immediately after their group; grand totals remain last.
Input rows and all detail/subtotal/total values are unchanged. Definitions
without RowLabelSort retain the existing full-output pivot baselines, and
empty lists produce byte-identical output to absent lists.

## Authoring, storage and import

Pivot Properties → **Row label sort** lists each assigned Rows dimension using
its display name. **Default**, **Ascending** and **Descending** clear or set
that field's entry independently. With no Rows field, the section explains the
prerequisite. Columns never appear in this section.

Draft `pivotRowLabelSorts` holds unique `{fieldId, direction}` entries. Storage
and the reducer validate structure, explicit direction and Rows membership.
Invalid edits preserve the last valid state. Removing a row field or moving it
to Columns clears only its entry. Dataset remaps and O-generated well
replacement clear entries whose dimensions leave Rows. Changing away from
pivot clears the state. Authored pivots serialize it only as `rowLabelSort`
inside `sortConfiguration`; other kinds never emit it.

Bundle/native imports require explicit valid directions and bound native
field IDs equal to their corresponding draft column names. Valid imports,
including empty lists, become editable state and survive storage, export,
editing, clearing and both dialect round-trips. Independent field and measure
sorts survive those edits.

Malformed, duplicate, unbound, measure/column-field and missing-direction
imports remain retained read-only with diagnostics and verbatim export.
Native-ID/column-name mismatches also remain read-only: no export-time field-ID
rebinding is added. Unrelated edits preserve retained sorts. The existing
bundle envelope rejects non-object outer sort configurations.

## Limits and verification

[ColumnLabelSort](parity-pivot-column-label-sort.md) is now supported; no pivot
label-sort follow-up remains. Insight custom narratives remain unsupported and
need a product design decision. No broader QuickSight fidelity is claimed.

`packages/web/test/pivot-row-label-sort.test.mjs` is reached by the existing
web test glob and root `npm test`. See [verification and captures](parity-pivot-row-label-sort-gap-notes.md).
