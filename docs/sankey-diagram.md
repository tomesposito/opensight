# Sankey diagram — issue #46

The Phase 2d gallery includes **Sankey**, backed by the existing Apache ECharts
6 dependency. Both `SankeyDiagramVisual` API definitions and
`sankeyDiagramVisual` bundle definitions compile through the same renderer.
No dependency was added.

| Builder well | Bundle member under `sankeyDiagramAggregatedFieldWells` | Fields |
| --- | --- | --- |
| Source | `source` | Exactly one dimension |
| Destination | `destination` | Exactly one dimension |
| Weight | `weight` | Exactly one explicit SUM measure |

Nodes are the union of source and destination values. The same typed value
shares one node across both wells, including intermediate nodes in multi-stage
flows. Nulls display as `(null)` but retain their identity separately from the
literal string `(null)`. Numbers and strings also remain distinct. Duplicate
source→destination pairs are summed. View data retains every supplied row;
aggregation for drawing does not rewrite query results.

OpenSight deliberately sums duplicate supplied pairs and creates nodes in first
occurrence order after any supported explicit field sort. Links are grouped by
first-seen source and destination. ECharts supplies the horizontal DAG layout;
QuickSight ordering and geometry have not been measured. Native source/weight
sorts and item limits are unsupported. The existing `categorySort` field-sort
extension can sort supplied rows; it does not implement native Sankey sorting.

Weight values must be finite, nonnegative and non-null, and their total must
remain finite. Zero links remain zero when another link has positive weight.
ECharts cannot lay out an all-zero flow or a cycle (including a self-link), so
these inputs fail before rendering. Edges are never silently dropped, shared
nodes are never split to remove cycles, and weights are never invented.
Empty results and unavailable results retain the normal distinct card states.

The existing controls support node labels, decimal formatting, tooltip
visibility, themes and palettes. The legend identifies the single Weight
series; it is not a node legend. Its visibility and position are configurable.
Node labels use original values; tooltips show the node or source→destination
pair and weight. ECharts node size/value is the larger of total incoming and
outgoing flow. Graph mark clicks do not select result rows because aggregated
links and shared nodes have no single row index; View data selections remain
available through the existing interaction path.

The builder initializes Source to region, Destination to category, and Weight
to revenue for synthetic sales. Each well accepts one field; assigning another
replaces that well. Live previews query the assigned fields through the existing
API. The static demo recomputes pinned synthetic rows locally across all regions
and identifies that source in the UI. It is not a deployed server. The sample
profit measure includes invalid weights and correctly produces an error.

Missing or multiple fields raise path-qualified `CompileError` messages with
`SANKEY_SOURCE_REQUIRED`, `SANKEY_DESTINATION_REQUIRED`, or
`SANKEY_WEIGHT_REQUIRED`. Other graph failures use `SANKEY_WEIGHT_INVALID`,
`SANKEY_WEIGHT_OVERFLOW`, `SANKEY_CYCLE_UNSUPPORTED`, and
`SANKEY_ZERO_FLOW_UNSUPPORTED`. Shared result validation also rejects nonnumeric
or nonfinite cells. Unsupported definition properties, detailed tooltips and
native sorting options raise a path-qualified `CompileError`. Import records
these errors, blocks preview queries and retains the original JSON for unchanged
export. Unresolved datasets and denied fields still use the existing gates.

See [verification and screenshot findings](issue-46-gap-notes.md).
