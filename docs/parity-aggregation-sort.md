# Category aggregation sorting — parity-aggregation-sort

This phase-plan fallback adds QuickSight `AggregationSort` for pie, bar,
bar100, line, area and combo visuals. There is no associated GitHub issue,
new dependency, environment variable or hosted-service requirement.

## Configuration

```json
{
  "sortConfiguration": {
    "categorySort": [{
      "aggregationSort": {
        "fieldId": "region",
        "direction": "DESC",
        "aggregationFunction": {
          "numericalAggregationFunction": { "simpleNumericalAggregation": "SUM" }
        },
        "column": { "dataSetIdentifier": "sales_data", "columnName": "revenue" }
      }
    }]
  }
}
```

The native dialect is the PascalCase mirror (`CategorySort`, `AggregationSort`,
`FieldId`, `Direction`, `AggregationFunction.NumericalAggregationFunction.
SimpleNumericalAggregation`, `Column.DataSetIdentifier` / `Column.ColumnName`).
Both native conversion and the API archive mapping preserve the nested shape.

There is **one sort entry total**, either `fieldSort` or `aggregationSort`.
Unknown keys at every sort level, malformed objects, unsupported kinds and
unbound fields raise named `CompileError`s. `fieldId` must identify the first
category dimension. The column's dataset identifier and column name must match
one bound measure; its field ID may differ from its column name or result alias.
The compiler resolves and stores that measure's field ID. Direction is `ASC`
or `DESC`, defaulting to `ASC` when omitted.

Only numerical aggregations are supported: `SUM`, `AVERAGE`, `MIN`, `MAX`,
`COUNT`, `DISTINCT_COUNT`. Date/categorical variants and other functions fail
closed. Table row sorting, pivot field sorting and other visual kinds retain
their existing scope; they do not accept aggregation sorts.

## Ordering semantics

The compiler aggregates the resolved measure's non-null numeric result values
per category. SUM/AVERAGE/MIN/MAX use those numbers; COUNT counts non-null
values; DISTINCT_COUNT counts distinct non-null values. Every aggregation,
including the two counts, returns a null sort key for an all-null category.
Null aggregates sort last in both directions. Non-finite aggregates fail closed.

Ties preserve category first appearance. Rows within a category keep their
original relative order and values. With SmallMultiples, aggregation is per
(facet, category), and categories sort inside each facet. Facets retain first
appearance unless a separate SmallMultiplesSort explicitly orders them.

Ordering runs at the existing row-sort stage, before facet limits and
CategoryItemsLimit. DESC plus a category limit keeps the highest aggregate
categories and all their rows. An included Other bucket still follows the
existing limit semantics: dropped rows sum into Other; aggregation sorting does
not change how Other is calculated or re-sort the merged Other panel.

Multiple result rows per category are accepted when aggregation sorting is
active. Existing duplicate-category checks remain unchanged otherwise. These
are supplied result values, not a new raw-source query aggregation. Chart data,
detailed tooltips, conditional formatting and View data all consume the same
ordered rows. Existing chart constraints still apply (for example pie values
must be nonnegative and non-null). Inputs are not mutated.

## Authoring and import

Bar, bar100 and pie Properties → Group/Color has a **Sort mode** selector.
**By measure** exposes a measure, aggregation and ascending/descending buttons.
Defaults are the first measure, Sum and descending. **By field** returns to
plain Group/Color sorting. Invalid edits preserve the last valid state.

Draft `aggregationSort` stores `{fieldId, direction, measureFieldId, aggregation}`.
Storage validates its structure, kind and field membership. It is mutually
exclusive with `groupSort`. Removing or replacing a referenced well clears it;
dataset remapping clears stale references and rebinds surviving sort columns on
export. Changing away from bar/bar100/pie clears it.

**Authoring serialization supports bar/bar100/pie only. Imported line/area/combo
configurations compile and render**, while their aggregation sorts remain
retained read-only in authoring. Compatible bar/bar100/pie imports require an
explicit direction and a category field ID equal to its draft column name.
Measure IDs can differ from column names. Valid configurations become editable
and round-trip. Malformed, unbound, multiple-entry, unsupported-aggregation and
foreign-category-ID configurations retain import diagnostics and export verbatim.
The existing bundle envelope rejects non-object outer sort configurations.

See [verification and captures](parity-aggregation-sort-gap-notes.md). The new
test file is reached by the existing web test glob and root `npm test`.
No broader QuickSight visual fidelity claim is made.

## Follow-up: native category-sort planning

The subsequent [native planner slice](parity-category-sort-planner.md) admits
FieldSort and AggregationSort under CategorySort for bar, line/area and pie
definitions. Plans and grouped query results remain unchanged; the compiler
still owns display ordering. Native combo planning and other sort options
remain outside that slice. Historical compiler evidence above is unchanged.
