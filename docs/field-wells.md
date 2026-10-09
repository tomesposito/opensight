# Author field wells — issue #56

Before selection, Author shows GROUP/COLOR, VALUE and SMALL MULTIPLES. The
same three wells appear on bar and pie/donut visuals. Line, area, stacked
percentage bar and combo visuals also expose Small multiples while retaining
their category/axis and ordered-measure semantics. Specialized wells remain
available for pivot, table, radar, Sankey, maps and the other visual types.

The gallery's ADD action creates an unassigned visual. All 23 visual types
retain the centered type name and “Add 1 or more fields to build a visual.”
guidance. Source/import errors still take precedence. No local dataset or
sample is selected automatically; sample opt-in and durable uploads are unchanged.

Select an empty well, then choose a field in Data; use a well's native picker;
or drag a Data field onto the well. Enter/Space activate the native buttons.
Measures go to VALUE and dimensions to the selected dimension well. Invalid
fields, incompatible roles, Boolean fields and external drag payloads are
refused. Dropping onto an empty canvas well creates one bar visual atomically.
Pill removal affects its own well; removing the last measure restores the
dashed “Add a measure” placeholder. Measure ordering and specialized wells
retain their existing behavior.

Pills include accessible type icons: # for numeric fields, a calendar for
dates, and existing text, geography and calculation icons. Date pills retain
their granularity and measures retain their aggregation. The Data panel shows
the dataset name, the existing truthful BLAZE/DIRECT QUERY execution badge,
“Search fields”, and “+ Calculated field”; it does not claim SPICE execution.

## Small multiples limit

One dimension can be assigned to Small multiples. The optional `smallMultiples`
array is validated in the existing version-2 draft format, saved by the same
manual/auto-save path, and restored on reload. Existing drafts need no migration.
Assignments survive visual-type changes and remain removable even if the new
type cannot accept new Small multiples assignments.

Faceted rendering is not implemented. An assigned Small multiples field blocks
preview queries and JSON/.qs export with `SMALL_MULTIPLES_UNSUPPORTED`; the
field remains saved in the local draft. The UI explains how to remove it to
resume preview. A hosted API does not remove this compiler limitation. Existing
native bundle features continue through the existing preservation/import-report
path. This issue does not add a faceted renderer or change its semantics.

## Verification

The component/reducer checks run through `packages/web/test/*.test.mjs` and
root `npm test`. They cover all 23 empty types, three-well order, field icons,
assignment/removal, drag validation, durable draft reload, invalid stored
fields, unsupported preview/export, and visual-type switches.

`node packages/web/scripts/capture-field-wells.mjs` verifies the freshly rebuilt
static demo in Chromium with all external HTTP requests blocked. Captures and
acceptance metadata go to ignored `.opensight/issue-56/` by default; the output
and installed screenshot-tool paths can be set through the existing
`OPENSIGHT_SCREENSHOT_OUTPUT` and `OPENSIGHT_SCREENSHOT_TOOLS` variables.
See [verification and visual review](issue-56-gap-notes.md) for exact counts.
