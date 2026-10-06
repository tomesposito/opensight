---
status: ✅ Confirmed
owner: OpenSight product owner
date: 2026-10-06
labels: [idd]
---

## Purpose

Record the field-first authoring behavior confirmed by issue #43.

## Scope

Visible field wells and field assignment when no visual is selected.

## Out of Scope

Drag-and-drop, automatic chart recommendations, query semantics and hosting.

### ✅ IDD D-15 — What should assigning a field do when no visual is selected?

#### CONTEXT

The 2026-10-06 parity baseline records missing field wells in both empty
Author pairings. Previously, authors had to choose a visual and press ADD
before Data fields became available. Issue #43 confirms that wells should
remain visible and assigning a field should create a visual, following the
QuickSight reference workflow. The existing editor uses click-to-assign
controls and preserves different well semantics for each visual type.

#### THE PROBLEM

What should assigning a field do when no visual is selected?

#### OPTIONS CONSIDERED

1. Require authors to choose a type and press ADD before assigning fields.
2. ✅ **Create and select a bar visual containing the assigned field.**
3. Infer a chart type and seed additional fields based on the dataset.

#### REASONING

Option 1 keeps the existing explicit creation step but prevents the field-first
workflow required by issue #43. Option 2 makes the first assignment an atomic,
predictable edit, with a familiar default type that authors can change using
the existing control. It deliberately accepts an incomplete visual after one
field: the normal missing-field feedback remains until required wells are
filled. Option 3 could produce a complete preview sooner, but guesses at the
author's intent and introduces unrelated assignments and chart recommendations
outside this decision's scope.

#### IMPLICATIONS

- Without a selection, show ROWS, COLUMNS and VALUES in that order, with
  dimension/measure placeholders and keyboard-accessible well selection.
- A valid first assignment creates one bar on the active sheet and selects it;
  it does not seed other fields. Invalid or BOOLEAN assignments create nothing.
- Measures use VALUES. Dimensions use the active dimension well; ROWS is the
  fallback. The default bar maps ROWS/COLUMNS to its single Category well;
  grouped visual types retain their existing row/column assignment rules.
- Subsequent assignments and pill removal edit the selected visual. Existing
  gallery ADD defaults, type changes, layout, saving and export remain available.
- D5's bundle-format contract and existing incomplete-definition validation
  continue to apply. This decision changes author interaction, not query meaning.
