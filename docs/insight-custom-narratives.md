# Insight custom narratives (#333)

IDD D-96 (custom narratives) admits a bounded subset of QuickSight narrative
syntax: plain text with references to the same Insight's computed results and
bound measure totals. This is separate from the unrelated ITD D-96 about retry
counters. The template replaces the entire computed narrative. It uses only the
Insight's already fetched, authorized, aggregated rows; substitution performs
no queries, network requests or parameter evaluation.

## Configuration and grammar

```json
{
  "computations": [{ "totalAggregation": { "computationId": "total", "name": "Total" } }],
  "customNarrative": {
    "narrative": "Revenue {Total.value|decimals:2}\n\nAll groups: {field.revenue|grouping:false}"
  }
}
```

`customNarrative` must be an object containing only the string `narrative`.
A configuration may have computations, a custom narrative, or both. With a
custom narrative, computations may be omitted or an empty array; field-only
references need no computations. Existing Insight well and SUM requirements
still apply. Native API spelling is `InsightConfiguration.CustomNarrative.Narrative`.
Import, draft storage and export preserve the template byte for byte, including
whitespace. Imported measure field IDs are retained in author wells.

```text
placeholder    := "{" ref ("|" format)? "}"
ref            := computationRef | fieldRef
computationRef := Name ("." segment)*
fieldRef       := "field." fieldId ("." ("value" | "formattedValue"))?
format         := pair ("," pair)*
pair           := "decimals:" int | "grouping:" boolean | "percent:true" | "date:" grain
```

`Name` resolves to a computation's `name` when set, otherwise its `computationId`.
It must identify one computation on this Insight. Names and field IDs in this
subset use letters, digits, underscores and hyphens without spaces. `field` is
the reserved field-reference prefix. Computation output paths must be in the
catalog below; a bare computation name has no published scalar output. No
implicit `result` or `metricValue` wrapper exists. `items[i]` means a zero-based,
non-negative integer literal, such as `items[0]`, not a variable or expression.

`field.<fieldId>` and `.value` return that bound measure's SUM across the rows.
`.formattedValue` uses the visual's decimal places. Dimension fields and fields
outside the current measure wells are reference errors. There is no implicit
column-name fallback for an imported field ID.

## Published outputs

These values come from the same per-kind calculations that generate computed
narratives. Ranking, tie order, calendar periods, null handling, forecast
engine and statistical anomaly semantics remain those in [Insight visual](insight-visual.md).

| Computation kind | Output paths |
| --- | --- |
| `totalAggregation` | `value`, `formattedValue` |
| `maximumMinimum` | `value`, `formattedValue`, `category`, `percentOfTotal`, `percentOfTotal.value`, `percentOfTotal.formattedValue` |
| `topBottomRanked` | `itemsCount`, `items[i].category`, `items[i].value`, `items[i].formattedValue` |
| `metricComparison` | `value`, `formattedValue`, `targetValue`, `targetValue.formattedValue`, `difference`, `difference.formattedValue`, `percentDifference`, `percentDifference.value`, `percentDifference.formattedValue` |
| `growthRate`, `periodOverPeriod` | `value`, `formattedValue`, `previousValue`, `previousValue.formattedValue`, `change`, `change.formattedValue`, `percentChange`, `percentChange.value`, `percentChange.formattedValue`, `currentPeriod`, `previousPeriod` |
| `periodToDate` | `value`, `formattedValue`, `period` |
| `forecast` | `value`, `formattedValue`, `lowerBound`, `lowerBound.formattedValue`, `upperBound`, `upperBound.formattedValue`, `period` |
| `uniqueValues` | `itemsCount`, `items[i]` |
| `topBottomMovers` | `itemsCount`, `items[i].category`, `items[i].previousValue`, `items[i].previousValue.formattedValue`, `items[i].value`, `items[i].formattedValue`, `items[i].change`, `items[i].change.formattedValue`, `items[i].percentChange`, `items[i].percentChange.value` |
| `anomaly` | `itemsCount`, `items[i].period`, `items[i].value`, `items[i].formattedValue` |

Ranked/mover lists contain the selected results at the configured size. Unique
values use deterministic typed category order; anomalies use chronological
order. Their published lists include the computed categories/candidates even
when the automatic sentence abbreviates its display. `itemsCount` is the list
length. Custom substitution never silently truncates a label or list value.
`currentPeriod` and `previousPeriod` retain the category labels; `period` uses
the computation's existing period label. Null category labels remain `(null)`.

## Formatting, paragraphs and bounds

- Bare numbers use the shared `formatNumber` default. `formattedValue` uses the
  visual's decimal places, like computed narrative value parts.
- Bare percent-typed outputs (`percentOfTotal`, `percentDifference`,
  `percentChange`) render the fraction ×100 with two decimals and `%`.
  Their `.value` renders the raw fraction as a plain number; their
  `.formattedValue` uses visual precision, falling back to two decimals.
- `decimals:0` through `decimals:6` override precision; `grouping:true` or
  `grouping:false` controls thousands separators. Grouping defaults to true.
- `percent:true` scales a fraction ×100 and appends `%`, defaulting to two
  decimals. It does not scale an already percent-typed output twice.
- `date:DAY`, `date:MONTH`, `date:QUARTER`, `date:YEAR` formats date-valued
  category/period outputs using shared UTC date decoding and the existing
  `YYYY-MM-DD`, `YYYY-MM`, `YYYY-Qn`, `YYYY` patterns. Date formatting requires
  a date-valued output; number formats require numbers. Date and number
  formats cannot be combined. Unknown or repeated format keys fail closed.
- Unavailable scalars render `unavailable`, including null totals, no rows,
  missing previous periods and uncomputable forecasts. No replacement value
  or empty string is invented. A list index outside the computed list is an
  error, including when the list is empty.
- After substitution, blank lines split paragraphs. Numeric substitutions
  remain numeric `NarrativePart` values so existing graphic emphasis and
  wrapping apply. Substituted category text is literal and is never reparsed
  as a template or interpreted as HTML.
- The fully rendered text, including paragraph separators, must be at most
  `UNIQUE_VALUES_MAX_TEXT_CHARS` (**1,000 characters**, issue #266). Longer
  output fails closed rather than truncating. Existing computation budgets,
  including the anomaly work limit, continue to apply.

## Authoring

The Insight Properties area contains **Custom narrative**, a textarea with
aria-label `Custom narrative template`. **Insert placeholder** lists the
current named/ID computations with their catalog outputs (list examples insert
index `0`) and bound measure fields as `field.<fieldId>`. **Placeholder format**
offers None, `decimals:0`, `decimals:2`, Percent (`percent:true`) and
`grouping:false`. Pick a format, then a placeholder to insert it at the caret
or replace selected text. Authors can edit literal list indices and supported
format pairs in the textarea. Clearing it removes `customNarrative` and
restores computed prose, preserving computations.

## Errors and validation layers

| Error | Cause |
| --- | --- |
| `INSIGHT_CUSTOM_NARRATIVE_UNSUPPORTED` | Invalid custom shape, grammar or catalog output; unknown format key/value; conditionals (`{if ...}`), loops (`{for ...}`), functions, expressions, arithmetic, spaces inside braces, nested/unbalanced braces, or any `$` anywhere in the template, including `${...}` parameters. The message names the bounded subset. |
| `INSIGHT_CUSTOM_NARRATIVE_REFERENCE` | Missing or ambiguous computation on this Insight; unbound or dimension field reference; list index outside the computed list. |
| `INSIGHT_CUSTOM_NARRATIVE_TOO_LARGE` | Fully substituted text exceeds 1,000 characters. |

`validateInsightConfiguration` checks shape, grammar, catalog and computation
existence in the shared structural layer used by imports, draft admission,
query construction and compilation. Normalization checks field bindings
against wells before author querying and rendering. List indices and rendered
size are checked during substitution when computed values are known. Failed
imports report named errors and retain their original definitions for export.
Unsupported parameter expressions remain blocked in all existing compiler,
anomaly, builder and query tests.
