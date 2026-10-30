# Grounded, inspectable Ask O — issue #158

## Contract and scope

This slice implements issue #158's body and 2026-10-29 scoping comment, as
supplied in the run brief. The comment's D-56 citation does not check out:
[D-56](idd/D-56-asset-move-semantics.md) concerns asset move semantics, not NLQ.
There is no NLQ IDD in the repository. The issue scope is the contract for this
slice; no new IDD or `SOLUTION_DESIGN.md` change is required.

Ask O continues to use its bounded deterministic grammar. Every interpretation
reports the defined fields used, declared synonyms matched, and question terms
not understood. Users can inspect and edit interpretation steps before previewing
or adding an ordinary visual to an analysis. Unsupported questions retain their
existing named diagnostics and produce no interpretation; unknown extra words
retain `UNRECOGNIZED_WORDS` and the existing confidence penalty.

## Field metadata and grounding

`SchemaField` in o-interpreter and web `DataField` gain optional
`synonyms?: readonly string[]`. Matching uses declared synonyms as aliases;
exact field names take precedence. Existing suffix aliases remain supported.
Synonym matches incur the existing alias confidence penalty. No field is invented.

The interpreter's hardcoded revenue/sales alias moves to the revenue entry in
web `SALES_FIELDS` as `synonyms: ['sales']`. `dataFields()` preserves dataset
column metadata; calculated fields have undefined synonyms. Calculation
suggestion templates retain their independent sales/revenue handling.

Every `Interpretation` has required grounding:

```ts
grounding: {
  fieldsUsed: string[];
  synonymsMatched: { term: string; field: string }[];
  unmatchedTerms: string[];
}
```

`fieldsUsed` contains the measure, dimensions and filter fields, deduplicated
in that order. Counting rows has no measure field. Synonym matches identify
only fields used by the selected interpretation, including dimension and filter
matches. `unmatchedTerms` is the parser's existing unknown-token list.
The panel shows “Grounded in: …”, synonym notes such as “‘sales’ → revenue”,
and named unmatched terms. After removal edits, grounding reflects retained
fields and retains the original unmatched question terms.

## Steps and explanations

The interpreter exports a pure `interpretationSteps()` derivation returning a
discriminated union of `aggregation`, `measure`, `group-by`, `filter`, `top-n`,
`granularity`, and `visual` steps. Each carries its current value; grouping
carries the dimension names and each filter carries its field, operator and
value. Granularity appears for date grouping. The measure is displayed for
inspection; the requested controls do not change the selected measure.

`describeInterpretation()` derives the explanation from interpretation fields.
The parser uses the same helper, preserving existing explanation wording and
confidence. An optional original chart hint preserves the parser's existing
“used for this grouping” explanation when a hint cannot fit its grouping.

The web layer makes immutable interpretation edits and regenerates explanations
with this helper. Aggregation and visual type use selects; dimensions and filters
have removable chips; Top N can be edited or cleared; date granularity uses a
select. The existing `prepareOVisual` memo reruns, and the ordinary query/preview
flow and `o-add` action both receive the edited interpretation. Switching
alternatives, changing datasets or asking a new question resets edits. Existing
AI/local mode behavior, alternatives and honesty notices remain intact.

## Edit constraints

- Aggregations are SUM, AVG, COUNT, MIN and MAX. Non-numeric measures and
  counting rows permit only COUNT.
- Visual types are bar, line, pie, table and kpi.
- Removing the final dimension clears Top N because it requires grouping.
  Top N uses the grammar's integer range of 1–10,000; invalid input is reported
  and cannot be added, rather than silently replaced.
- Granularity is editable only with a datetime dimension, using YEAR, QUARTER,
  MONTH or DAY. Removing the final date dimension clears granularity.
- Existing named preparation errors remain visible and disable adding a visual.
  Edits never bypass the existing query/validation path or silently repair an
  unsupported calculation.

Controls follow existing q-panel/o-entry styles, editor system typography and
compact 4/8px spacing. The static demo remains labeled synthetic/offline.

## Explicit non-goals

No shared or semantic metric store (#157), writeback (#161), new NLQ grammar,
query engine, visual path, provider or LLM changes. The API generative route
continues to reinterpret provider rewrites through the extended interpreter;
its schema comes from dataset columns without synonyms and remains unchanged.
No synonym metadata is introduced on that path. No dependencies, AWS calls,
deployment, push, merge or `SOLUTION_DESIGN.md` edits are part of this build.

## Verification

Interpreter tests cover grounding, metadata aliases, exact-name precedence,
unknown words, step values and edited descriptions while retaining existing
parser expectations. Web tests drive controls through the ordinary preview,
assert fixture results and filters, and validate adding an edited interpretation.
The final build includes the full root `npm test`, a rebuilt static demo,
reference comparison and refreshed Ask O screenshot and README hero GIF.
