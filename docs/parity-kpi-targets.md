# KPI targets, progress bars and trend arrows — parity-kpi-targets

This phase-plan fallback completes the target/progress/arrow features deferred
by [KPI trends](parity-kpi-trend-group-sort.md). It has no GitHub issue, new
dependency or hosted-service requirement.

## Configuration and validation

```json
{
  "fieldWells": {
    "values": [{"numericalMeasureField": {
      "fieldId": "value", "column": {"dataSetIdentifier": "data", "columnName": "revenue"},
      "aggregationFunction": {"simpleNumericalAggregation": "SUM"}
    }}],
    "targetValues": [{"numericalMeasureField": {
      "fieldId": "target", "column": {"dataSetIdentifier": "data", "columnName": "budget"},
      "aggregationFunction": {"simpleNumericalAggregation": "SUM"}
    }}]
  },
  "kpiOptions": {
    "progressBar": {"visibility": "VISIBLE"},
    "trendArrows": {"visibility": "VISIBLE"},
    "comparison": {"comparisonMethod": "DIFFERENCE"}
  }
}
```

The native mirror uses `KPIVisual.ChartConfiguration`, `TargetValues`,
`NumericalMeasureField`, `AggregationFunction.SimpleNumericalAggregation` and
`KPIOptions.ProgressBar` / `TrendArrows`. Direct wells and `KPIFieldWells` wrappers
both work. Existing conversion shapes are reused unchanged.

KPI accepts zero or one target measure through the existing measure parser.
Malformed wells, additional targets, duplicate field IDs, mixed datasets,
unsupported variants and missing explicit aggregation fail closed. Other kinds
still reject nonempty targets. Empty target lists are no-ops. A target may share
a source column with the primary measure if their field IDs are distinct.

## Query grain and aggregation

Author queries, fixture evaluation, native DuckDB/Postgres plans and published
reader bindings include the target measure at the primary measure's grain.
Adding a target never adds a group-by dimension. Target aliases and date trend
aliases are bound independently of source column names.

A trend-less KPI reads its target from its single aggregate result row. A
trended KPI sums the target's grouped SUM results, ignoring nulls; all-null,
empty or unavailable targets remain null. Both the primary and target bindings
must be explicit SUM with a trend, including governed `__metric_` bindings.
Averages/counts cannot be silently summed. Duplicate trend keys and non-finite
cells or aggregate arithmetic fail closed. Trend-less governed targets retain
the existing parser's explicit AVG/COUNT/MIN/MAX/DISTINCT_COUNT support.

## Rendering and accessibility

A bound target displays **Target: value**, with the primary value's metric
format and a **Target: column** column in the ordered accessible data table /
View data. A null target displays **Target: No value**; it never becomes zero.

A present `progressBar` object defaults to VISIBLE. A usable target is finite,
non-null and strictly positive, with a non-null primary and finite
`primary / target` ratio. The bar uses the actual primary total even when
COMPARISON is the primary display mode. Only its visible fill clamps to 0–100%.
Accessible text retains the unclamped percentage (or the finite ratio in times
of target if converting to percent would overflow).

No bar renders for an absent target binding, null target, target ≤ 0, null
primary or non-finite ratio. A visible request keeps a specific rendering
warning in those cases. A usable bar has no progress warning. HIDDEN/absent
progressBar produces no bar or progress warning; target text remains visible.

A present `trendArrows` object also defaults to VISIBLE. With a configured,
nonzero comparison, ↑ denotes positive and ↓ negative. The arrow sits beside
the last-vs-previous comparison in trend order, including COMPARISON primary
mode. Zero or unavailable comparisons draw no arrow and retain an honest note.
HIDDEN/absent draws no arrow or arrow warning. The chart graphics are
`aria-hidden` inside an image with accessible target/ratio and “Trend up/down”
text; arrow glyphs are not announced as their only meaning.

## Authoring, storage and import

The KPI **Target value** well accepts one measure through drag/drop, its picker
or the Data panel after selecting the well. Draft `targetField` stores its
source column. Ordinary target aggregation is SUM; an imported non-SUM governed
target also stores its explicit `targetAggregation`. Invalid edits preserve the
last valid visual. Removing/replacing the target, leaving KPI, remapping a
missing column and O-generated replacement clear stale target state. Surviving
remaps rebind dataset identifiers and retain native target field IDs.

Authored targets emit only `targetValues`; target-less definitions retain their
previous output. Reusing the primary column gives the target a distinct field
ID and query alias. The existing Properties panel exposes no sparkline or
comparison option toggles, so this slice adds no new options UI. Imported
progress/arrow visibility objects render and survive storage.

Supported bundle/native imports become editable and survive save/reload,
unrelated edits, target replacement/removal and both dialect round-trips.
Malformed field objects, unbound/mixed dataset references, multiple targets and
non-SUM trended targets retain diagnostics and their original definitions for
verbatim export. The existing bundle envelope still rejects non-array wells
and malformed variant/column envelopes before editable import; its validation is unchanged.

## Limits and verification

The target regression is a **constructed reduced fixture** using the established
KPI well shape and supported explicit SUM fields/options. Existing automotive
fixtures have empty targets; no real target dataset is invented or attributed
to them. Their broader unsupported configurations are not claimed supported.

Pivot [RowLabelSort](parity-pivot-row-label-sort.md) is now supported. Pivot
[ColumnLabelSort](parity-pivot-column-label-sort.md) is now supported. Insight custom narratives
and additional KPI styling remain outside this slice. No broader QuickSight fidelity claim is made; visual
fidelity is not measured. See [verification and captures](parity-kpi-targets-gap-notes.md).
