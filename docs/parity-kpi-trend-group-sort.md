# KPI trend groups and sorting — parity-kpi-trend-group-sort

This phase-plan fallback adds one optional KPI trend dimension and QuickSight
`TrendGroupSort`. It has no GitHub issue, new dependency or hosted-service
requirement. Existing KPIs without trends retain their complete compiled output.

## Configuration and validation

```json
{
  "fieldWells": {
    "values": [{"numericalMeasureField": {
      "fieldId": "sales", "column": {"dataSetIdentifier": "data", "columnName": "revenue"},
      "aggregationFunction": {"simpleNumericalAggregation": "SUM"}
    }}],
    "trendGroups": [{"dateDimensionField": {
      "fieldId": "month", "column": {"dataSetIdentifier": "data", "columnName": "order_date"},
      "dateGranularity": "MONTH"
    }}]
  },
  "sortConfiguration": {"trendGroupSort": [{"fieldSort": {"fieldId": "month", "direction": "DESC"}}]},
  "kpiOptions": {
    "sparkline": {"visibility": "VISIBLE", "type": "AREA"},
    "comparison": {"comparisonMethod": "PERCENT_DIFFERENCE"},
    "primaryValueDisplayType": "ACTUAL"
  }
}
```

The native PascalCase mirror uses `KPIVisual.ChartConfiguration`, `TrendGroups`,
`TrendGroupSort`, `FieldSort`, `FieldId`, `Direction` and `KPIOptions`. Direct
field wells and the optional `KPIFieldWells` wrapper both work. The existing
converter already maps these shapes in both directions.

KPI accepts zero or one trend dimension: categorical or date, using the existing
field parser and supported DAY/MONTH/QUARTER/YEAR grains. Empty trend wells are
no-ops. Numerical dimension variants, measure variants, additional trend
fields, duplicate IDs, mixed datasets and nonempty targets fail closed.
Other kinds continue to reject nonempty trend wells and `trendGroupSort`.

If supplied, `trendGroupSort` must be an array with exactly one wrapper and
exactly one `fieldSort` or `aggregationSort`. Its ID must identify the bound trend dimension.
Measure sorting is described in [KPI trend aggregation sorts](parity-kpi-trend-aggregation-sort.md).
Direction accepts ASC/DESC and defaults to ASC when omitted in a definition.
Empty lists, multiple entries, malformed shapes, unknown
keys at every level, unbound IDs and invalid directions raise named
`CompileError`s. Clearing a sort removes the property.

## Query grain, ordering and rendering

Author queries, the fixture preview and native query plans group by the trend
field. The compiler consumes already aggregated SUM rows; duplicate trend keys
fail closed. It does not combine duplicate input groups. Date aliases are
carried through preview and published-reader bindings.

Without a sort, order is **ascending by the trend field**, never arrival order.
Date values compare chronologically, including grouped month/quarter/year labels;
invalid date keys fail closed. Other cells use the shared field comparator:
numeric pairs compare numerically, other pairs compare their text. Null trend
keys stay last in both directions and ties retain first appearance. Input rows
are not mutated. The accessible data table follows the same order and includes
the trend column.

The primary ACTUAL value is the sum of the grouped SUM values. Null values are
ignored in this total; an all-null result shows “No value”. Non-finite totals
fail closed. Trended KPIs reject non-SUM `__metric_` bindings, so averages and
counts cannot be silently summed. Trend-less KPIs retain the one-row contract.

Two or more groups render a small LINE sparkline by default. AREA adds a fill;
HIDDEN suppresses it. Null measure values remain gaps, with `connectNulls: false`.
Fewer than two groups render only the primary value. Empty/unavailable results
keep their existing labels.

A configured comparison uses the **last group minus the previous group in trend
order**. DESC therefore reverses which groups are last. DIFFERENCE displays the
numeric difference; PERCENT_DIFFERENCE displays `(last - previous) / previous *
100` with a percent sign. Null operands, a zero percent denominator, fewer than
two groups or non-finite arithmetic produce no comparison. ACTUAL displays the
comparison below the total. COMPARISON makes it primary; if unavailable, it
falls back to ACTUAL with a rendering warning.

## Minimal KPI options

The compiler and native query planner share strict parsing of:

- `sparkline`: `visibility` VISIBLE/HIDDEN (default VISIBLE), `type` LINE/AREA
  (default LINE).
- `comparison`: required `comparisonMethod` DIFFERENCE/PERCENT_DIFFERENCE.
- `primaryValueDisplayType`: ACTUAL/COMPARISON.
- `progressBar` and `trendArrows`: visibility objects, retained without drawing.
  Visible settings add warnings. A progress bar needs supported target semantics;
  no target or bar is invented.

Unknown keys, unsupported enums and malformed objects fail closed, including
font/layout options and sparkline tooltip options outside this subset. With no
`kpiOptions`, no options property is added to the model.

## Authoring, storage and import

KPI field wells offer **Trend group**, accepting one date or categorical field.
KPI Properties → **Trend sort** appears when that field is assigned. Ascending
is the default; users can choose descending or reset the explicit sort.

Draft `trendField` stores the column name and `kpiTrendSort` stores
`{fieldId, direction}`. Storage and reducer validation check the structure,
kind, trend presence and membership. Invalid edits preserve the last valid
state. Removing/replacing the trend or changing away from KPI clears the sort;
unrelated edits retain it. Remaps clear missing trend references and rebind
surviving wells, preserving native field IDs. O-generated replacement clears
stale trend state. Imported options survive storage and preview.

Bundle/native imports with an explicit valid sort direction become editable,
including measure aggregation sorts. Their draft shape extends `{fieldId, direction}`
with `measureFieldId` (the bound measure column name) and `aggregation`; removing
or replacing that measure clears the sort.
Field IDs may differ from column names. Supported sorts survive unchanged
export, editing, clearing and both dialect round-trips. Malformed, unbound,
multiple-entry and missing-direction imports retain their
original definitions and diagnostics for verbatim export; unrelated edits
preserve those retained sorts. The existing bundle envelope rejects non-object
outer sort configurations.

## Limits and verification

The regression test extracts a **reduced SUM KPI from the automotive fixture**.
It keeps the real measure/trend IDs, columns, aggregation and explicit sort,
plus supported sparkline/comparison options. It removes unrelated hierarchy,
number/font formatting, conditional formatting and sparkline tooltip properties.
The full automotive dashboard still contains unsupported non-SUM measures and
other properties; this slice does not claim it all renders.

Pivot [RowLabelSort](parity-pivot-row-label-sort.md) is now supported;
`ColumnLabelSort` remains unsupported and fail closed. Targets, progress bars, trend arrows,
additional KPI styling and numerical trend-field variants remain outside this
slice. No broader QuickSight fidelity claim is made; visual fidelity is not
measured.

The new web suite is wired through the existing root test glob, with a native
query-planning regression in the query-engine suite. See
[verification and captures](parity-kpi-trend-group-sort-gap-notes.md).
