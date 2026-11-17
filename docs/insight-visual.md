# Insight (autonarrative) visual

Insight generates deterministic text from authorized, filtered, aggregated result
rows. It uses no LLM, ML model, network service or invented sample values. The
static demo recomputes pinned synthetic sales through the fixture query path;
configured local/API datasets use the same compiler and narrative engine.

## Fields and computations

The gallery's **Insight** type uses one **Category** dimension and one **Values**
measure. TopBottomMovers computations are the one exception: they bind a second,
time dimension alongside the category (see their section below). A second Values measure enables comparison; the default summary compares
first minus second. All measures require explicit SUM bindings. The internal
projection is `insightVisual.chartConfiguration.fieldWells.insightAggregatedFieldWells`
with `category` and `values` arrays. These wells are an OpenSight extension.

Native QuickSight `InsightVisual` uses `InsightConfiguration.Computations` with
fields inside each computation, rather than chart field wells. The converter
preserves those computations and derives the wells for import and querying.
Computation field IDs, dataset, column, aggregation and date grain must agree
with their bindings. Conflicting bindings cannot execute. Original imported
JSON remains available for unchanged export, including blocked features.

| Computation | Behavior |
| --- | --- |
| TotalAggregation | SUM of the bound measure's supplied groups. |
| MaximumMinimum | MAXIMUM or MINIMUM contributor, its value and fraction of the total. Ties use deterministic typed-category order. |
| TopBottomRanked | TOP or BOTTOM categories with values. ResultSize defaults to 3 and accepts 1–20. |
| GrowthRate / PeriodOverPeriod | Latest date period versus the preceding calendar period at the bound DAY, MONTH, QUARTER or YEAR grain. Growth PeriodSize is limited to 2. |
| MetricComparison | Aggregate FromValue minus aggregate TargetValue, plus percent difference. Requires two distinct bound measures. |
| Forecast | Statistical forecast of the bound measure, using the shared chart exponential-smoothing engine. Requires a date dimension; reports the forward horizon at its grain, final projected period/value and prediction-interval range. |
| PeriodToDate | SUM of the bound measure's groups in the UTC calendar period containing the latest dated row. PeriodTimeGranularity accepts DAY, MONTH, QUARTER or YEAR and defaults to the bound date grain. A finer period than the bound grain is unavailable. |
| UniqueValues | The distinct values of the bound category, listed in deterministic typed order. Binds no measure: a visual whose computations are all UniqueValues executes with no Values measure. |
| TopBottomMovers | TOP or BOTTOM categories by change in the bound measure between the latest dated period and the preceding calendar period. Binds two dimensions (category and time); a visual whose computations include any TopBottomMovers must contain only TopBottomMovers computations. MoverSize defaults to 3 and accepts 1–20; SortOrder is PERCENT_DIFFERENCE (default) or ABSOLUTE_DIFFERENCE. |

With no explicit computations, the summary includes total, highest and lowest
contributors, plus a period comparison for date fields and a metric comparison
when two measures are bound. The Properties panel can select a total, ranked
list, growth, period, forecast, period to date, unique values or metric comparison and configure rank count and decimals.

UniqueValues computations accept `computationId`, optional string `name` and
`category` only; any other property (including `value` or `time`) fails closed.
The narrative lists each distinct category once, ordered by the same
JSON-typed sort used for ranked ties (quoted strings precede null), with a null
category shown as `(null)`: `Unique <category>: <v1>; <v2>; … .` Measure values
never affect the list and no null-group disclosure is added. Authored visuals
keep their Values well, which the computation ignores; a native visual whose
computations are all UniqueValues needs no Values well at all — its author
query groups by category alone and carries a discarded COUNT measure only
because the query planner requires one explicit measure. Empty results retain
the panel's existing empty state. Sentence composition is OpenSight's;
QuickSight's exact wording is not replicated.

PeriodToDate computations accept `computationId`, optional string `name`, `time`,
`value` and optional `periodTimeGranularity`. Native PascalCase imports use
`PeriodToDate` / `PeriodTimeGranularity`; both dialects retain the computation
unchanged on export. The **Period to date (date required)** preset leaves the
period granularity absent, so it follows the bound date grain. Unknown properties,
malformed IDs and invalid granularities fail closed before querying.

Rows are first aggregated at the bound date grain, decoded with the shared date
decoder and ordered chronologically. PeriodToDate selects the calendar period
containing the latest dated row, including a trailing null group, using UTC
boundaries `[period start, next period start)`. It sums only the supplied groups
inside that period; it never substitutes an all-time total. Null groups inside
the period are skipped and their count disclosed. Missing dates are not filled.
The sentence is `Period-to-date <measure> for <period label> (<grain>): <value>.`
Labels use `YYYY-MM-DD`, `YYYY-MM`, `YYYY-Qn` or `YYYY`.

A period finer than the bound grain, no non-null values in the latest period,
or no dated rows produces an unavailable sentence with the reason and no invented
number. Duplicate decoded periods raise `INSIGHT_VALUE_INVALID`; invalid date
categories raise `INSIGHT_TIME_REQUIRED`. Empty or missing query results retain
the panel's existing empty/unavailable state, with the no-dated-rows reason in the
PeriodToDate narrative. The period is anchored to the latest supplied row, not
the wall clock. Sentence composition is OpenSight's; QuickSight's exact wording
is not replicated, and no ML or visual-fidelity parity is claimed.

TopBottomMovers computations accept `computationId`, optional string `name`,
`time`, `category`, `value`, required `type` (TOP or BOTTOM), optional
`moverSize` (integer 1–20, default 3) and optional `sortOrder`
(`PERCENT_DIFFERENCE` default, or `ABSOLUTE_DIFFERENCE`). Native PascalCase
imports use `TopBottomMovers` / `MoverSize` / `SortOrder`; both dialects retain
the computation unchanged on export. Unknown properties, a missing or invalid
type, and out-of-range sizes fail closed before querying. Mixing movers with
any other computation kind is rejected with `INSIGHT_COMPUTATION_INVALID`.

Rows are grouped by (category, period). For each category the bound measure in
the latest dated period is compared with the preceding calendar period at the
bound grain, using the same convention as GrowthRate/PeriodOverPeriod: a
missing preceding calendar period is never substituted with an older period.
Difference is `current − previous`; percent is `(current − previous) / previous`
via the shared relative difference, so a zero previous value makes the percent
unavailable. TOP ranks the largest differences first, BOTTOM the smallest,
ordered by the SortOrder metric; percent-ranked categories with an unavailable
percent are excluded. Ties use the deterministic typed-category order.
Categories without a non-null value in both periods are excluded and their
count is disclosed. The sentence is `Top movers <measure> (<latest period> vs
<preceding period>): <category> (<previous> → <current>; <difference>,
<percent>); … .` (Bottom likewise). When no category is eligible the sentence
reports `unavailable (no category has a value in both periods)` with no
invented numbers; empty results keep the existing empty state. Author drafts
keep the single-dimension model: movers configurations appear as imported
computations in the Properties panel, the author query groups by (category,
time) from the configuration's bound fields, and no author preset is added.
Sentence composition is OpenSight's; QuickSight's exact wording is not
replicated.

Forecast computations accept `computationId`, optional `name`, `time`, `value`
and `forecastProperties` in the internal camelCase form. Native API imports use
`Forecast` / `ForecastProperties` with PascalCase keys. Properties follow the
chart rules: `periodsForward` and `periodsBackward` are integers 0–100 (defaults
3 and 0); `predictionInterval` is 80, 90 or 95 (default 95); `seasonality` is
AUTOMATIC, NONE or CUSTOM (default AUTOMATIC). CUSTOM requires an integer
`customSeasonalityValue` from 2–366; as on charts, it is unused for other modes.
Optional finite `lowerBoundary` and `upperBoundary` are passed to the engine,
with lower no greater than upper. Unknown properties and malformed shapes fail
closed. Backward periods are validated and retained but do not change the sentence.

Forecast histories use the same date decoder as period comparisons and are
ordered chronologically. Null measure values are skipped by the shared engine;
missing calendar periods are not filled. The projected horizon starts after the
latest supplied period, including a trailing null group, as on charts. Duplicate
decoded periods fail with `INSIGHT_VALUE_INVALID`. Fewer than four usable points,
a zero forward horizon, or an unavailable engine result produces an honest
unavailable line with no invented computed values. Empty results retain the
common empty state. Boundaries and seasonal-history fallback follow the shared
[forecast engine](forecasting.md). Sentence composition is OpenSight's;
QuickSight's exact narrative wording and proprietary forecasting are not replicated.

Period comparisons use UTC calendar arithmetic shared with query expressions.
The shared decoder accepts query labels (`YYYY`, `YYYY-Qn`, `YYYY-MM`,
`YYYY-MM-DD`) at their bound grain as well as ISO dates.
A missing preceding period is reported as unavailable, even if an older period
exists. Period percentage uses `(current - previous) / previous`; metric
percentage uses `(from - target) / abs(target)`, matching the query engine's
period and `percentDifference` semantics. Shares use `value / total`. Zero
bases produce “unavailable”, never Infinity or a fabricated percentage.

SUM ignores nulls and an all-null sum stays unavailable. Contributor lists exclude
null measure groups and disclose their count. A null category is displayed as
`(null)`. Duplicate categories, invalid values and nonfinite arithmetic are
rejected. View data retains the original aggregated cells. Empty results and
missing data keep the existing honest empty states.

Numbers use the shared en-US formatter and configurable decimal precision;
rounding is presentation only. The text panel follows KPI's graphic-text compiler
and SVG rendering path, with no chart series. Computed values are bold, theme
fonts/colors are respected, long text wraps and scrolls, and the accessible label
contains the complete narrative. Data strings are plain text, never HTML or
ECharts rich-text templates.

## Unsupported features and errors

Anomaly computations are unsupported. All native custom-narrative
templates are currently unsupported, including placeholders referencing forecasts
or other computations. No template HTML is evaluated. Future
computation variants cannot execute.
Native interactions and additional options also fail closed.

Named diagnostics include `INSIGHT_ANOMALY_UNSUPPORTED`, `INSIGHT_CUSTOM_NARRATIVE_UNSUPPORTED`,
`INSIGHT_TIME_REQUIRED`, `INSIGHT_CATEGORY_REQUIRED`, `INSIGHT_CATEGORY_INVALID`, `INSIGHT_VALUES_REQUIRED`,
`INSIGHT_FIELD_UNBOUND`, `INSIGHT_PERIOD_UNSUPPORTED`, `INSIGHT_VALUE_INVALID`,
`INSIGHT_COMPUTATION_INVALID`, `INSIGHT_CONFIGURATION_INVALID` and `INSIGHT_CONFIGURATION_UNSUPPORTED`.
Unknown parser variants raise `INSIGHT_COMPUTATION_UNKNOWN`; known but
unimplemented compiler variants raise `INSIGHT_COMPUTATION_UNSUPPORTED`.

Validation occurs even without rows. Import reports name unsupported computations
and prevent preview queries. The parser retains documented but unsupported
variants for reporting; unknown variants are rejected during validation. A native
total-only insight with no category binding is deliberately rejected under this
slice's one-category contract. This is a supported subset of QuickSight, not full
narrative-language, computation or visual-fidelity parity.

API shape references: [InsightVisual](https://docs.aws.amazon.com/quicksight/latest/APIReference/API_InsightVisual.html),
[InsightConfiguration](https://docs.aws.amazon.com/quicksight/latest/APIReference/API_InsightConfiguration.html),
and [Computation](https://docs.aws.amazon.com/quicksight/latest/APIReference/API_Computation.html).
