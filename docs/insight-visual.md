# Insight (autonarrative) visual

Insight generates deterministic text from authorized, filtered, aggregated result
rows. It uses no LLM, ML model, network service or invented sample values. The
static demo recomputes pinned synthetic sales through the fixture query path;
configured local/API datasets use the same compiler and narrative engine.

## Fields and computations

The gallery's **Insight** type uses one **Category** dimension and one **Values**
measure. A second Values measure enables comparison; the default summary compares
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

With no explicit computations, the summary includes total, highest and lowest
contributors, plus a period comparison for date fields and a metric comparison
when two measures are bound. The Properties panel can select a total, ranked
list, growth, period, forecast, period to date or metric comparison and configure rank count and decimals.

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
or other computations. No template HTML is evaluated. TopBottomMovers,
UniqueValues and future computation variants cannot execute.
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
