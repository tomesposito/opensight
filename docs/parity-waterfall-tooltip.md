# Detailed tooltips for waterfall visuals

The `parity-waterfall-tooltip` phase-plan fallback extends detailed tooltips
(`SelectedTooltipType: DETAILED` + `FieldBasedTooltip`) to waterfall visuals.
Waterfall was one of three kinds whose chart configuration rejected the
detailed keys outright; radar and sankey remain gated the same way and are
follow-up slices. No new settings, dependencies, query semantics or hosted
resources are required: authoring export, bundle import and the Properties
Tooltip section all flow through the compiler's `tooltipDetailKinds` gate,
which now includes waterfall.

Waterfall bars are compiled datums, not rows, so the mapping is explicit:

| Bar | Detailed tooltip |
| --- | --- |
| Delta bar (plain mode) | Its single source row: category, measure, extra fields |
| Delta bar (breakdown mode) | Its single (category, breakdown) row: category, breakdown, measure, extra fields |
| Subtotal, "Other" and Total bars | Basic `name: delta` text — these bars aggregate several rows (or the running total), so no row is invented for them |

Delta bars carry a non-rendering `sourceRowIndex` only when the visual's
tooltip type is detailed (treemap/word-cloud precedent), so basic-mode
compiled output is byte-identical to before. The visible series keeps its
own basic formatter in basic mode; in detailed mode the compiler's
option-level formatter takes over.

Titles follow the shared detailed rules: the bar name for primary-value
titles (the category value in plain mode, the breakdown value in breakdown
mode), the first dimension's label for field-id titles. Hidden fields,
the aggregations toggle ("Sum of …"), governed metric formats and tooltip
extra fields behave exactly as on the other detailed kinds; extras resolve
from the delta bar's source row.

Tests live in `packages/web/test/tooltip-detail.test.mjs` (delta bars,
breakdown bars, aggregate-bar fallback, aggregations/hidden/title modes,
extras, basic-mode invariance, gate agreement) and
`waterfall-builder.test.mjs` (the obsolete `selectedTooltipType` rejection
case is removed), both included by root `npm test`.

Divergence notes (honest): QuickSight renders its own detailed tooltip
composition; this slice matches the field content and visibility semantics,
not the pixels — visual fidelity is not measured. README GIF not
regenerated: the tour never opens a waterfall tooltip (no visible delta in
visited sections), same ruling as the other tooltip slices.
