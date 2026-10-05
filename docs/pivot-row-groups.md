# Pivot row groups (Issue #40)

Pivots with at least two row dimensions show a keyboard-focusable +/− button
for each parent group. Enter, Space or a click toggles only that group. Buttons
expose `aria-expanded`; leaf rows and grand totals have no toggle.

With subtotals enabled, the existing subtotal row anchors each group and stays
visible on collapse. With subtotals hidden, a label-only group header supplies
the anchor, without introducing subtotal values. Collapsing a parent hides all
descendant details and subtotals. Expanding it restores each child's previous
state. Metric-on-rows layouts show one toggle per group and retain every enabled
subtotal measure. Hide-empty settings are applied before group headers are built.

The definition stores typed row-dimension prefixes in
`pivotTableVisual.opensightFormatting.pivot.collapsedRowGroups`, for example:

```json
{ "collapsedRowGroups": [["East"], ["West", "Hardware"]] }
```

This is an OpenSight formatting extension, using the existing bundle extension
mechanism. Omitted groups default to expanded. Numbers, strings, booleans and
null remain distinct. Empty paths, invalid cell types, nonfinite numbers and
duplicate paths are rejected by formatting validation. Unsupported imported
formatting remains read-only and is preserved on export.

Author toggles update the owning visual even when another visual is selected.
State survives draft saves, JSON/.qs import/edit/export, result recomputation,
theme changes and subtotal visibility changes. Changing the row field sequence
or visual kind clears obsolete paths. Temporary missing groups keep their state
so filters do not erase a user's choices. Read-only previews start from the
definition and keep subsequent viewer toggles locally.

Offline pivot authoring uses the existing local synthetic sales query path.
Expand/collapse changes presentation only: it neither queries a server nor
changes aggregates. Column groups and drill navigation are unchanged. No new
dependencies or configuration are required.
