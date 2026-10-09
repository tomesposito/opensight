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
| Multiples Options | Existing Small multiples field well remains assignable and saved | Visible rows/columns, panel count, title/size/emphasis/alignment, border/width, gutter and background |
| Group/Color | Field display name in generated titles and result tables; clearing restores the source name | Separate group title, text styling, Author sort editing, slice limit |
| Legend | Visibility; Auto/Top/Bottom/Left/Right placement | Separate legend title and its typography; per-visual legend value typography |
| Data labels | Visibility; decimal precision, including clearing back to automatic | Independent category/metric controls, position, typography and overlap |

Disabled controls use native disabled fieldsets with visible explanations,
linked accessible descriptions and hover text. Reference placeholders such as
85%, 1px, 24px, 20 (Default), Small and Outside are explicitly not applied
settings. No unsupported property is stored or exported. Typography defaults
to the analysis theme rather than naming an unavailable downloaded font.

Multiples Options appears for bar, percentage bar, line, area, combo and pie,
or for a retained Small multiples assignment. Assigning a multiples field still
blocks preview/export with `SMALL_MULTIPLES_UNSUPPORTED`; removing it restores
the normal path. This issue does not add a facet renderer.

Group/Color appears for the visual types with that well: bar, percentage bar
and pie. Slice count is pie-specific. The field-name input is disabled until
a grouping field is assigned. It edits the existing display-name map, never
the source column or field binding. Sort editing remains unavailable in the
Author model; imported sort settings are retained by the existing bundle path.

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
