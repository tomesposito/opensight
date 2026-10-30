# Grounded, inspectable Ask O — issue #158

## Contract and scope

This slice implements [issue #158](https://github.com/tomesposito/opensight/issues/158)
as scoped by the issue-158 build brief: defined-field grounding, metadata
synonyms, and visible, editable interpretation steps in Ask O. The brief's
resolved decisions are the contract for this slice; `SOLUTION_DESIGN.md` is
unchanged. The issue body was read along with the available October 29 comment
(roadmap scheduling); the detailed scoping comment is supplied by the brief.

The brief reports a D-56 citation in that scoping comment. It does not check
out: [D-56](idd/D-56-asset-move-semantics.md) concerns asset move semantics,
not NLQ. There is no NLQ IDD in the repository. This slice proceeds on the
issue and the explicit scope/resolved decisions in the brief, without creating
an IDD or claiming that D-56 authorizes NLQ decisions.

Ask O continues to use its bounded deterministic grammar. Unsupported
questions retain the existing named diagnostics and no interpretation; partial
matches retain `UNRECOGNIZED_WORDS` and name the unmatched terms. Grounding
never invents a field. Existing AI/local modes, alternatives, confidence and
honesty notices remain intact.

## Field vocabulary and grounding

`SchemaField` in `o-interpreter` and web `DataField` gain optional
`synonyms?: readonly string[]`. Declared synonyms are aliases; exact field names
win over aliases and alias matches retain the existing confidence penalty.
The interpreter's hardcoded revenue/sales alias is removed. Instead, the web's
`SALES_FIELDS` revenue field declares `synonyms: ['sales']`. `dataFields()` passes
metadata through from dataset columns; calculated fields have no synonyms
(`undefined`). Existing shortened field-name matching remains available.

Every `Interpretation` has required grounding:

```ts
grounding: {
  fieldsUsed: string[];
  synonymsMatched: { term: string; field: string }[];
  unmatchedTerms: string[];
}
```

`fieldsUsed` contains the measure, dimensions, then filter fields, deduplicated
in that order. Count-rows has a null measure and includes only its dimensions
and filters. `synonymsMatched` identifies matched metadata synonyms and the defined field
chosen by that interpretation, including ambiguous alternatives independently.
`unmatchedTerms` is the interpreter's existing unknown-token list. Interpretations
are constructed only in the existing results loop.

## Steps and description

The interpreter exports a pure `interpretationSteps(interpretation)` derivation
returning discriminated step objects with kinds `aggregation`, `measure`,
`group-by`, `filter`, `top-n`, `granularity`, and `visual`, carrying their current
values. Filters are individually inspectable/removable; grouping carries the
current dimension names. Granularity is present when the interpretation has
date grouping. No interpreter mutation API is added.

`describeInterpretation(...)` derives the existing explanation wording from
interpretation fields. The parser uses it too, retaining byte-identical wording
for unedited questions, including grouping-related chart overrides. The web
regenerates explanation and therefore the prepared visual's title after edits.

## Panel and edits

Below the explanation, show `Grounded in: …`, matched synonyms such as
`‘sales’ → revenue`, and unmatched terms when present. Render compact controls
inside the existing panel: aggregation and visual selects, dimension and filter
chips with remove buttons, Top N edit/clear, and a granularity select only while
a datetime dimension is present. The measure is an inspectable step.

Edits immutably produce an effective interpretation, regenerate its explanation
and current field grounding, and rerun the existing `prepareOVisual` memo and
query/preview flow. Both preview and `ADD TO ANALYSIS` use that prepared result.
Switching alternatives or asking a new question resets edits. No new query
engine, visual path, fonts, or floating UI is introduced.

Constraints:

- Aggregations are SUM, AVG, COUNT, MIN, MAX; a nonnumeric measure or count-rows
  permits only COUNT.
- Visual choices are bar, line, pie, table, kpi.
- Removing the last dimension also clears Top N, as required by the brief.
  The visual type remains the user's selection; a visual that still requires
  grouping reports `O_MISSING_DIMENSION` until the user chooses KPI.
  Granularity is cleared when its final datetime dimension is removed.
- Top N uses the existing integer range 1–10,000. Granularity choices are YEAR,
  QUARTER, MONTH, DAY and require a datetime dimension.
- Invalid edited states fail closed with named errors through the existing
  preparation/preview validation path; never silently discard requested semantics.
  Top N input outside its integer range is reported rather than silently ignored.

Preparation retains `O_UNKNOWN_FIELD` and `O_UNSUPPORTED_CALCULATION`. Because
edits can form combinations the parser does not produce, the same preparation
path also rejects invalid Top N (`O_INVALID_TOP_N`), missing grouping
(`O_MISSING_DIMENSION`) and incompatible aggregations, granularity or visual
groupings (`O_UNSUPPORTED_INTERPRETATION`). Multiple dimensions require a table;
a KPI requires no dimensions. These errors disable adding and replace the
previous preview. Confidence continues to describe the original grammar match
and is labeled accordingly after an edit.

## Non-goals and compatibility

No shared/semantic metric store (#157), writeback (#161), new grammar beyond
metadata matching/grounding, new query engine, or provider/LLM change. The API
generative route still reinterprets provider rewrites with the same interpreter.
It builds schema fields from dataset columns without synonym metadata and
continues to have no synonyms. `suggestCalculation` has separate sales/revenue
templates and is unchanged. No new dependencies or configuration are required.

## Verification

Interpreter tests cover field grounding, metadata synonyms, exact-name
precedence, unknown terms and diagnostics, count-rows, step values, and shared
description after edits. Web tests cover rendered grounding/unknown terms,
metadata propagation, aggregation edits changing executed fixture results,
filter removal, edited add-to-analysis validation, reset behavior and edit
constraints. Run the complete root `npm test`, reporting exact passed/failed/
skipped counts. Rebuild the static demo, compare screenshots with the reference
set, record findings in gap notes, and refresh affected README imagery and tour.
The static demo is not a deployed server; visual fidelity remains unmeasured.
