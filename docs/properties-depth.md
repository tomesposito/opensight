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

Visual and Interaction tabs apply to the selected visual. Visual contains the
reference formatting sections and the existing palette/analysis theme editors.
Interaction contains Filters, Filter actions, Drill-down hierarchy, and Parameter
bindings. Arrow keys, Home, and End switch tabs and move focus. Changing selection
opens Visual for the newly selected visual; tab navigation is not document state.
Saved edits survive switches. With no selection, the existing empty message and
analysis theme editor remain available. All section headers use the shared
`property-section` details style. Tabular formatting and pivot options remain
limited to their applicable visual kinds.

The display audit retains working kind-specific controls and adds:

| Visual kinds | Display controls |
| --- | --- |
| All | Title text/visibility, title size (8–48 px), subtitle text/visibility |
| Bar, line, pie, combo, area, 100% bar | Legend visibility and Auto/bottom/top/left/right position |
| Bar, 100% bar, combo | Category spacing (0–80%); explicit spacing removes the bar-width cap |
| Bar | Horizontal and stacked toggles; clearing stacked uses clustered bars |
| 100% bar | Horizontal toggle; percentage stacking stays intrinsic to this kind |
| Pie | Donut toggle |
| Gauge, histogram | Existing min/max and bin-count controls |
| Kinds with data labels | Decimal places (0–12), shared with the result table |

Plain subtitles map to native `subtitle.formatText.plainText` and visibility;
legend positions map to native `chartConfiguration.legend.position`. Legend
position also lives in `opensightFormatting` so a temporary kind change retains
it. Title size and category spacing use that extension as well. Imported rich
subtitle text remains in the preservation report and original archive; an
explicit subtitle text edit replaces the rich/plain union with plain text.

Label precision retains chart meaning: pie percentages, 100% bar percentages,
scatter coordinates, heatmap measures, histogram counts, and numeric values for
other labels. Category names stay on pie, scatter, funnel, treemap, and map labels.
Clearing the precision or spacing input restores automatic presentation. Legends
reserve space around the plot. These controls affect the shared compiler/card,
so fixture previews, API previews, and embedded rendering use the same settings.

This audit compares the supplied screenshot's section structure and the control
families requested in the brief. It does not claim exhaustive QuickSight feature
coverage. Unsupported native formatting remains named and preserved by import.
