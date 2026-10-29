# Familiar-surface self-service (#156)

This slice's build contract is the resolved scope in issue #156's build brief.
It adds column-level shortcuts to data preparation and deterministic field search
to analysis creation. It uses existing dataset operations and visual types.

## Spreadsheet-style preparation

The Preview tab shows numbered rows and column headers with names and types.
Add formula column, Filter column, and Rename column open the existing step
editor. Applying creates an ordinary `calculate`, `filter`, or `rename` step,
visible and editable on the preparation canvas. Column rename already exists;
step naming (#17) is a separate feature. Joins retain their existing editor.

Grid shortcuts append after the last step, as the transformation catalog does.
Select that step (or Input in an empty pipeline) before adding a transformation.
An explicitly pinned output stays pinned; use Set as output to publish a later
step. Header reordering changes preview presentation only, as before.

**Formula language decision:** a formula column is exactly a dataset calculated
field, using the existing [calculated-field expression language](calculated-fields.md),
including `{field}` references. For example, name `net_revenue` with expression
`{revenue} * 0.9`. Existing expression validation applies; preparation accepts
row expressions and rejects visual aggregates and table calculations. There is
no Excel dialect, new function, or grid-only operation model.

Filters use the existing operators and typed values described in
[Data preparation](data-prep.md). The static demo configures schemas only;
preview rows and saving datasets need a local or hosted API. Row numbers identify
positions in the bounded preview, not stable record IDs. Source row order is
unspecified.

## Search-driven analysis creation

Choose a dataset in Create Analysis, then optionally enter a measure field and
one dimension after `by`: `revenue`, `[revenue]`, `revenue by region`, or
`[revenue] by [region]`. Measures are numeric dataset fields; dimensions follow
the existing author field roles. Numeric measures use SUM. Field names with
spaces are supported; brackets disambiguate names containing the word `by`.

The field picker offers the chosen dataset's fields and closest matches while
typing, with arrow-key navigation and Enter to pick. Exact field names resolve
case-insensitively. Close matches are suggestions requiring selection, never
silent substitutions. Unknown or ambiguous tokens name the problem and list
candidate fields; creation is blocked until the query resolves. A dataset change
resets the field search so references cannot leak between datasets.

A measure alone creates one existing KPI visual. Adding a dimension creates one
existing bar visual. Both are normal analyses, saved and refined in Author and
rendered through the existing visual compiler. Leaving search empty retains
the normal blank-analysis creation flow.

**Scope decisions:** search uses dataset fields only. Shared metrics join the
grammar when #157 lands. Parsing is deterministic: no provider or LLM call;
grounded Ask O is #158. Direct cell editing/writeback is excluded (#161, gated
on Tom's IDD). This slice adds no new join UI, SQL dialect, or dependency.
