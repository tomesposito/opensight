# KPI trend aggregation sorts

Slice: `kpi-trend-aggregation-sort`, a phase-plan fallback with no GitHub issue.
This extends KPI `TrendGroupSort` with sorting by a bound measure aggregate.

## Configuration

```json
{
  "sortConfiguration": {
    "trendGroupSort": [{
      "aggregationSort": {
        "fieldId": "month",
        "direction": "DESC",
        "column": { "dataSetIdentifier": "sales_data", "columnName": "revenue" },
        "aggregationFunction": {
          "numericalAggregationFunction": { "simpleNumericalAggregation": "SUM" }
        }
      }
    }]
  }
}
```

`fieldId` must identify the bound trend dimension. The column's dataset identifier
and column name must identify a primary measure in the visual's Values well;
a target-only measure is not eligible. CamelCase bundle definitions and native
PascalCase definitions work, with either direct field wells or `KPIFieldWells`.
The existing definition converter preserves both forms.

The explicit sort list must contain exactly one entry, containing exactly one of
`fieldSort` or `aggregationSort`. Aggregation sorts admit only `fieldId`,
`direction`, `column` and `aggregationFunction`, with strict keys at every nested
level. Directions are `ASC`/`DESC`; definitions may omit direction to default to
`ASC`. The numerical wrapper and simple aggregation are required. Supported
aggregations are `SUM`, `AVERAGE`, `MIN`, `MAX`, `COUNT` and `DISTINCT_COUNT`.
Malformed shapes, unknown keys, unbound fields, multiple entries and unsupported
aggregations raise named `CompileError`s. Empty lists are invalid; clearing
removes the sort property.

## Ordering and limits

The compiler consumes one already aggregated row per trend group. It validates
unique trend keys and valid date keys through the existing KPI trend contract,
then applies the shared `aggregateSortValues` function to each group's non-null
measure result. It orders these aggregates using the existing cell comparator.
Null aggregates stay last in both directions; equal aggregates retain input
order. Input rows are not mutated. Missing result columns and non-finite or
non-numeric measure values still fail closed.

KPI currently binds one primary measure and requires grouped SUM results. Thus
`SUM`, `AVERAGE`, `MIN` and `MAX` each order by that group's one supplied value.
`COUNT` and `DISTINCT_COUNT` yield one for a non-null result and null for a null
result; they do not count underlying source records. Sorting does not change the
query grain or introduce a second measure well. Duplicate trend groups fail;
they are never silently combined. These are limits of this result-based subset,
not claims of complete QuickSight aggregation semantics.

The data table, sparkline and comparison all consume the ordered rows. Comparisons
use the final two groups in this order, including for date trends whose measure
order is no longer chronological. A null in either final comparison operand
makes the comparison unavailable under the existing KPI rules. Grouped actual
and target totals retain their existing aggregation behavior; targets move with
their matching trend rows, progress bars keep their existing semantics, and null
measure values remain sparkline gaps. The default/no-sort order and explicit
field-sort output are unchanged.

## Authoring and retained imports

Properties → **Trend sort** offers **Trend field** or **Measure** mode. Measure
mode exposes the bound measure, aggregation and ascending/descending controls.
It starts with Sum and retains the current direction (ascending by default).
**Reset trend sort** removes the explicit sort and restores ascending trend-field
order. The section requires a trend field; measure mode requires a bound value.
The controls use the editor's existing compact 12px Arial-family styling.

Drafts retain `{fieldId, direction}` for a field sort. The measure form adds
`measureFieldId` (a draft measure column name) and `aggregation` as a required
pair. Reducer, storage and migration validation reject invalid pairs and unbound
references. Invalid actions preserve the last valid state. Removing or changing
the trend field or sort measure, including O-generated replacements and remaps,
clears stale sorts; unrelated edits preserve them. Serialization emits the
QuickSight column and numerical aggregation wrappers above.

Valid bundle/native imports with an explicit direction are editable. Imports
translate native field IDs to draft column names; re-export restores the native
trend ID and dataset binding, including when switching between sort modes.
Local remaps rebind the aggregation-sort column to the local dataset. Unchanged
imports round-trip verbatim. Invalid, multiple-entry or direction-less sorts
retain their original definitions and diagnostics, including through unrelated
edits. Compiler default direction does not silently turn a direction-less import
into an editable sort.

The separate native `planVisual` query endpoint still accepts only field-sort
TrendGroupSort entries. An aggregation entry fails closed with
`UNSUPPORTED_FEATURE` in both DuckDB and Postgres planning. This brief changes
the web compiler and authoring paths; it does not extend that planner. The
authored grouped-query/fixture path supplies result rows to the compiler and
applies the new ordering there. Native compiler acceptance and editable imports
do not imply native-query execution support.

No dependency, hosted service or AWS call is needed. Visual fidelity is not
measured. See [verification and captures](parity-kpi-trend-aggregation-sort-gap-notes.md).

## Follow-up: native planner boundary closed

The subsequent [native planner slice](parity-kpi-trend-agg-sort-planner.md) closes
the boundary recorded above: `planVisual` now admits the supported KPI
`AggregationSort` definitions through the native query path. Admission validates
the definition only; grouped SQL/results stay unchanged and the consumer/compiler
still owns trend ordering. The earlier slice's history and result-based sorting
limits remain as recorded.
