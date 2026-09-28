# Properties panel depth (issue #2)

The local reference is `qs-editor-newlook.jpg`. Its Properties panel names
Display settings, Pivot options, Headers, Cells, Total, Subtotal, Row names,
Column names, Value names, and Conditional formatting, under Visual and
Interaction tabs. The screenshot verifies section organization; it does not
establish behavior or pixel parity. QuickSight fidelity has not been measured.

Pivot options apply to the native HTML pivot renderer in both fixture and API
modes. Metric placement moves measures between columns (the default) and rows.
Totals and subtotals retain additive SUM semantics, null values stay null, and
formatting rules retain their measure identities after layout changes. Name
visibility keeps accessible labels available to screen readers. Row selection
continues to use dimension values; totals and subtotals cannot originate clicks.

Hide empty rows/columns suppresses rendered measure rows/columns whose values
are all null or missing. Zero is not empty. Suppression does not change queries
or totals. Wrapping applies to headers and cells. Explicit column widths are
60–400 pixels; wrapping without an explicit width uses 140 pixels. Interactive
row-group expansion/collapse belongs to issue #5 and is not introduced here.

Options are validated as `opensightFormatting.pivot`, retained verbatim in `.qs`
archives and local drafts, and included in the existing import preservation
report if unsupported. Existing bundles without these options keep their layout.
No new dependencies or configuration are required.
