# Issue #57 — Author properties panels

The Visual tab now follows the reference section order: Display settings
(CARD TITLE, CARD STYLE, CARD LAYOUT), Multiples Options, Group/Color, Legend,
and Data labels. Existing table/pivot formatting, names, conditional formatting,
palettes, themes and the Interaction tab remain available. Controls are scoped
to the selected visual; the new components reuse the existing author actions
and definition format.

| Section | Working controls | Explicitly unavailable controls |
| --- | --- | --- |
| CARD TITLE | Title/subtitle text and visibility; title font size | Custom alt text; charts currently use the title for their accessible description |
| CARD STYLE | — | Background, border and selection colors/opacity, border width, loading animation setting |
| CARD LAYOUT | — | Per-card padding |
| Multiples Options | Visible rows/columns, layout panel cap, panel title size/bold/italic/alignment, border/width/color, gutter/background; assigned facets also expose Sort panels, Number of panels displayed and Group the rest as Other | Panel-title underline and dashed/dotted borders are saved but render without underline/with solid borders |
| Group/Color | Field display name; explicit field sort; Number of slices displayed for pie or Number of categories displayed for bar/percentage bar, with an optional Other bucket | Separate group title is saved but not drawn |
| Row sort (table) | Default order or one groupBy dimension/measure, with ascending/descending buttons and display names | Multiple sort entries |
| Category limit | Number of categories displayed and optional Other for line, area and combo | — |
| Legend | Visibility; Auto/Top/Bottom/Left/Right placement | Separate legend title and its typography; per-visual legend value typography |
| Data labels | Visibility; decimal precision, including clearing back to automatic | Independent category/metric controls, position, typography and overlap |

Disabled controls use native disabled fieldsets with visible explanations,
linked accessible descriptions and hover text. Reference placeholders such as
85%, 1px, 24px, 20 (Default), Small and Outside are explicitly not applied
settings. No unsupported property is stored or exported. Typography defaults
to the analysis theme rather than naming an unavailable downloaded font.

Multiples Options appears for bar, percentage bar, line, area, combo and pie,
or for a retained Small multiples assignment. Supported kinds render facets and
round-trip their field, layout settings, facet sort and panel limit. Sort panels
offers None, Ascending or Descending for the assigned facet, before limiting.
Removing or changing that field clears its sort. See [sort semantics](parity-sm-sort.md).
Number of panels
displayed accepts integers 1–100; invalid edits keep the last valid value and
empty clears the limit. Remaining groups merge into Other unless excluded;
the layout cap still applies afterward. See [panel-limit semantics](parity-sm-limit.md).
Unsupported kinds retain the field but block preview/export with
`SMALL_MULTIPLES_UNSUPPORTED` until it is removed.

Group/Color appears for the visual types with that well: bar, percentage bar
and pie. Pie keeps its slice wording; the other category-axis charts use
category wording. Invalid counts keep the last valid value; clearing removes
the limit. See [category-limit semantics](parity-category-limit.md).
The field-name input is disabled until
a grouping field is assigned. It edits the existing display-name map, never
the source column or field binding. Group/Color sort uses a bound dimension
or measure with an explicit direction and round-trips through the bundle path.

Tables expose Row sort in place of Group/Color. Choosing a dimension defaults
to ascending and a measure to descending; Default order clears the sort.
Removing the sorted field clears its state. See [table row sort semantics](parity-table-row-sort.md).

Legend and Data labels retain the existing visual-kind capability gates.
Auto legend position renders at the bottom, as before; explicitly saved
positions remain unchanged. Label precision retains the existing meaning for
each chart (for example, pie percentages). Narrative precision remains in
Display settings for Insight; table cell precision remains in Cells.

No dependencies, hosted services, environment settings or definition-schema
changes are introduced. Local mode still starts without data; sample data is
opt-in. The rebuilt static demo is a local artifact, not a deployed server.

Unit and integration tests live in `packages/web/test/properties-parity.test.mjs`
and the existing properties/display suites, all included by root `npm test`.
The offline browser check is `packages/web/scripts/capture-properties-panels.mjs`.
See [reference review and verification](issue-57-gap-notes.md).
