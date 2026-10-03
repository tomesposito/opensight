# Radar chart — issue #38

Phase 2d adds the Radar gallery entry and `RadarChartVisual` compiler support.
The bundle spelling is `radarChartVisual`; both definition dialects use the
aggregated field-well variant. No dependency was added.

| Builder well | Bundle member | Supported fields |
| --- | --- | --- |
| Category | `radarChartAggregatedFieldWells.category` | Exactly one dimension |
| Color | `radarChartAggregatedFieldWells.color` | Zero or one dimension |
| Values | `radarChartAggregatedFieldWells.values` | One or more explicit SUM measures |

Category values become axes in first-occurrence result-row order, after any
supported explicit field sort. Each Color group × measure becomes one radar
series. Without Color, each measure is a series. Values align to axes by typed
category identity; a missing category/group combination and a null measure both
remain null. Zero remains a real value. Duplicate category/group rows are errors:
the compiler requires already aggregated results and never sums them again.

OpenSight deliberately scales each axis independently from the supplied series:
nonnegative values use `[0, maximum]`; any negative value uses symmetric bounds
`[-max(abs(values)), max(abs(values))]`. Zero-only and all-null axes use `[0, 1]`
to avoid a degenerate scale. These defaults are not a claim of measured QuickSight
geometry or shared-axis parity. Native QuickSight axis, shape, angle, and series
style options are unsupported and must not be silently approximated.

ECharts 6 normally draws missing radar vertices at the center. The shared browser
and SVG renderer adapter removes those symbols and adjacent edges, including the
closing edge, and hides the fill for incomplete polygons. Finite points and edges
between adjacent finite points remain visible. Tests cover null-only series,
hover, and replacement of missing data. The adapter depends on ECharts' native
radar graphic structure; its geometry tests must pass on upgrades.

Legend visibility/position, data labels (including decimal formatting), tooltip
visibility, themes, and per-visual palettes use the existing display controls.
Category and Color accept one field each; replacing a field replaces that well.
The live preview queries both dimensions and all Values through the existing
query path. Radar previews in the static demo use the existing shared fixture evaluator to
recompute synthetic rows locally across all regions, including Color splits and
multiple measures. The UI names that offline source; the demo is not a deployed
service. Missing or unsupported data produces an error, never invented values.

Missing or multiple Category fields raise `CompileError` with
`RADAR_CATEGORY_REQUIRED`; no Values raises `RADAR_VALUES_REQUIRED`; multiple
Color fields raise `RADAR_COLOR_LIMIT`. Unsupported properties raise a
path-qualified `CompileError`. Detailed tooltip configuration, native axis/shape
settings, Color sorting and category limits are examples. Bundle import records
these errors in its report, blocks preview queries, and retains the original
JSON for lossless unchanged export. The existing unresolved-dataset and field
validation gates continue to apply.

Verification and screenshot findings are recorded in
[issue-38-gap-notes.md](issue-38-gap-notes.md).
