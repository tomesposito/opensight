# O entry point — Phase 4, issue #6

The builder chrome contains **Ask a question**. This is a local deterministic
interpreter, not an LLM. It interprets the local sales schema (including locally
available calculated fields), renders the selected answer through the existing
visual compiler, and shows its explanation and grammar-match confidence.
**Did you mean…?** cards select other interpretations. **ADD TO ANALYSIS** adds
the selected visual and its helper calculations to the active sheet in one edit.
The normal draft save and bundle/JSON export paths retain that definition.

The input uses local sales even when other imported resources are present.
Imported unresolved datasets are not queried. O previews use synthetic fixture
rows offline, or the existing local sales query endpoint when API mode is selected.
An API failure is displayed; it never falls back to fixtures. Sheet controls and
inherited filters apply to added visuals through the existing authoring path.

## Supported question grammar

Names are case-insensitive and preserve the schema's original spelling in the
result. Spaces, underscores and camelCase names are matched. Full names take
priority over suffix matches; ambiguous suffixes produce alternatives. `sales`
can mean `revenue` when no exact Sales field matches. Filter values preserve case.
Quote multiword values that contain grammar words, for example `"North and West"`.

| Intent | Examples |
| --- | --- |
| Aggregation | `sum revenue`, `total revenue`, `avg revenue`, `average revenue`, `mean revenue`, `count profit`, `min revenue`, `maximum revenue` |
| Row count | `count rows`, `count records by region` |
| Grouping | `sum revenue by region`, `sum revenue per category`, `sum revenue by region and category` |
| Time | `revenue per month`, `revenue over time`, `revenue yearly`, `revenue per quarter`, `revenue daily` |
| Chart | `pie`, `bar`, `line`, `table`, `trend` |
| Year filter | `sum revenue in 2025 by region` |
| Equality filter | `sum revenue for region East`, `sum revenue where category is Hardware`, `sum revenue where profit is 20` |
| Top N | `sum revenue by region top 5` |

Time grouping accepts day/month/quarter/year and daily/monthly/quarterly/yearly
(also annually). `over time` and `trend` default to month. A date field is required;
multiple date fields produce alternatives. Unqualified numeric fields default to
SUM, with AVG as an alternative. Explicit measure or aggregation ambiguity also
produces alternatives. Multiple grouping fields use a table. No grouping field
uses a KPI, with the fallback named in the explanation if a different chart was
requested. One date grouping defaults to a line; other single groupings to a bar.

The package returns `{ interpretations, errors }`. Each interpretation contains
`measure` (null for row count), `aggregation`, `dimensions`, `filters`,
`granularity`, `topN`, `suggestedVisualType`, `confidence`, and `explanation`.
Results are capped at 12, ordered by confidence then explanation. The input is
bounded to 2,000 characters and 500 schema fields; grouping/filter combinations
are bounded during expansion. There is no network access or runtime dependency
in `@opensight/o-interpreter`.

Unknown words produce `UNRECOGNIZED_WORDS` and lower confidence. Gibberish without
a measure produces `MISSING_MEASURE`. Empty questions, invalid schemas, missing
date fields, unknown filter/grouping fields, invalid filter values and invalid
top-N values return named diagnostics. Unresolved filter clauses block the result;
they are never dropped. Values must match their field type. This grammar does not
implement arbitrary comparisons, joins, forecasts, freeform synonyms or general
natural-language reasoning.

## Confidence

Confidence measures grammar coverage, not statistical certainty. Start at 0.98,
subtract 0.10 for defaulted aggregation, 0.10 for inferred time with multiple date
fields, 0.05 per alias match, and 0.15 per unknown token (capped at 0.60).
The implicit AVG alternative subtracts another 0.12. Clamp to 0.15–0.99 and round
to two decimal places. Equally plausible field alternatives can have equal scores;
`AMBIGUOUS_QUESTION` asks the user to choose. Low-confidence interpretations remain
reviewable and are only added by an explicit button press.

## Execution and persistence

`prepareOVisual` produces ordinary authoring definitions and Phase 2c calculated
fields. A measure uses `sum`, `avg`, `count`, `min` or `max` in its expression;
the existing outer SUM binding projects that expression's aggregate result.
`count(1)` counts every row, including rows with null measures; `count({field})`
counts nonnull values. Numeric grouping keys use `toString`. Year filters use
`formatDate(..., 'yyyy')`; typed equalities use `ifelse` and category filters.

Top-N uses a post-aggregation `rank` predicate, descending by the aggregate and
ascending by every grouping key to break ties. It selects exactly N groups (or
fewer when fewer exist); visual display ordering follows the existing compiler.
This runs in the same shared table-calculation layer for DuckDB, PostgreSQL and
browser fixtures. No separate JavaScript aggregation approximates the answer.
Generated helper fields are visible in the Data panel. Equivalent helpers are
reused and name collisions receive a suffix. Adding the visual is atomic; invalid
definitions cannot leave helper fields behind. Existing aggregate/table calculated
fields cannot be reaggregated by O and receive `O_UNSUPPORTED_CALCULATION`.

Q creates visuals without totals or subtotals. The builder's existing additive
SUM rollups are not a recomputation of nonadditive statistics such as AVG.
Changing the question clears the old preview; changing the available calculations
invalidates it. Choosing an alternative recomputes the preview.

## Build for me

Open **+ CALCULATED FIELD**, then **Build for me**. These templates use the
Phase 2c library and are checked with the same expression parser as manual edits:

| Request | Suggested expression |
| --- | --- |
| `year over year sales growth` / `yoy sales growth` | `periodOverPeriodPercentDifference(sum({revenue}), {order_date}, YEAR, 1)` |
| `month over month sales percent change` | `periodOverPeriodPercentDifference(sum({revenue}), {order_date}, MONTH, 1)` |
| `profit margin` | `sum({profit}) / nullIf(sum({revenue}), 0)` |
| `full name` | `trim(concat(coalesce({first_name}, ''), ' ', coalesce({last_name}, '')))` |

Growth needs a date grouping in the visual; missing/zero prior calendar periods
yield null. With multiple date fields, specify `by <date field>`. Margin is the
ratio of sums, with a null result for zero sales. Growth and margin return
fractional percentages. Full name requires the corresponding string fields;
the built-in sales dataset does not have them and shows a named missing-fields
diagnostic. Unsupported requests and function names are reported explicitly;
no invented expression is returned.

**INSERT EXPRESSION** fills the editor, preserving an existing name. **DISCARD**
removes the suggestion without changing the editor. **Create field** remains the
separate save action. Editing the request clears any stale suggestion.

## Hosted roles and generative mode (Issue #7)

The entire ask-a-question bar is restricted to administrator, author_ai and
reader_ai, including deterministic mode. Reader AI is available on accessible
published dashboards and has no ADD TO ANALYSIS action. The offline public
sample preview uses a fixed author_ai persona and cannot access hosted features.

Hosted generative mode enables only when both AI capability and a configured
non-Bedrock provider are present. The provider translates a question into O's
supported grammar; unsupported output returns a named diagnostic. Preview data
still runs through the existing query engine and caller's row/column policies.
Generated calculated fields bind and validate on the server before INSERT
EXPRESSION is offered. The existing deterministic templates remain local.

The static demo keeps Generative mode disabled and says “Needs hosted API and API
key via server env (not configured).” See [roles and provider settings](roles-ai-settings.md)
for server configuration, encryption, routes, capability checks and Bedrock's
approval-required state. No key is read back into the browser or exported with
an analysis. Provider prompts contain question text and permitted field metadata,
not dataset rows. Treat generated interpretations as suggestions to review.

## Verification and look-and-feel notes

Root `npm test` discovers the parser workspace and web `o-*.test.mjs` files.
Checks cover grammar/ambiguity, mapping through the compiler, helper persistence,
actual UI selection/add wiring, templates/insert/discard, and disabled generative
states. The standalone demo is built with
`npm run build:demo --workspace @opensight/web` at
`packages/web/dist/opensight-demo.html`; this is a local artifact, not a deployment.

The QuickSight Q reference supplies the question → explanation/preview →
alternatives → ADD TO ANALYSIS flow and the calculated-field insert/discard flow.
OpenSight keeps the answer in document flow beneath the chrome and closes it
after adding; the left-to-right Data → Visuals → analysis-sheet layout remains.
The reference's AI claims are replaced by explicit local deterministic labels.
The demo continues to state: “QuickSight fidelity has not been measured.”

Browser review (2026-09-28) used the installed Playwright/Chromium tooling without
adding a dependency. The offline file passed submit, alternate selection,
ADD TO ANALYSIS, reload/persistence, expression insert, disabled switch, and
gibberish checks. Captures at 1440×1000, 1280×800, 768×1024 and 390×844 showed no
page overflow, JavaScript errors or HTTP(S) requests. Light/dark captures and the
calculation dialog were compared with `qs-o-generative.jpg` and
`qs-author-light-flow.jpg` from the private reference set. Reference images and
generated captures are not committed.

The comparison caught clipped preview axes; giving the preview content its own
minimum height corrected the clipping. The O bar now uses the builder's input
styling, and the disabled switch stays aligned in the calculation dialog. The
reference is denser and docks O beside the sheet; this implementation uses the
document-flow answer described above, keeping the sheet's established rails
intact. No unresolved new rendering defect was found in the checked viewports.
Existing Properties/Data follow-ups (#2/#3) remain outside issue #6.

Final root `npm test` on 2026-09-28 exited 0. The sole skip is the live PostgreSQL
integration test (`DATABASE_URL` unset); embedded PostgreSQL differential checks
ran and passed. The 32 interpreter tests and 35 added web tests (including
cross-engine subtests) run in the standard root suite.

| Root test stage | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| API | 90 | 0 | 0 |
| Bundle parser | 183 | 0 | 0 |
| Embedding SDK | 4 | 0 | 0 |
| O interpreter | 32 | 0 | 0 |
| Query engine | 353 | 0 | 1 |
| Web | 366 | 0 | 0 |
| Conformance | 3 | 0 | 0 |
| **Total** | **1,031** | **0** | **1** |
