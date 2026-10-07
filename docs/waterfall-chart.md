# Waterfall chart — issue #47

The Phase 2d gallery includes **Waterfall**, using the existing Apache ECharts 6
bar renderer. No dependency was added. Native API `WaterfallVisual` definitions
convert to the bundle `waterfallChartVisual` variant.

| Builder well | Bundle well under `waterfallChartAggregatedFieldWells` | Native API well | Fields |
| --- | --- | --- | --- |
| Categories | `category` | `Categories` | Exactly one dimension |
| Values | `values` | `Values` | Exactly one explicit SUM measure |

The shared compiler consumes already authorized, aggregated result rows. Starting
from zero, each signed measure value changes the running total. The transparent
assist bar is `min(previous, next)`; the visible bar has height `abs(delta)`.
ECharts uses `stackStrategy: 'all'` so bars below zero and bars crossing zero
retain those endpoints. Positive and zero deltas are green (`#2e8b57`), negative
deltas red (`#d64545`), and the appended **Total** blue (`#2673c9`). A negative
Total extends from the final negative value to zero. Zero values stay zero.
Empty and unavailable results do not manufacture a Total bar.

These are deliberate OpenSight semantics: accumulation starts at zero, supplied
row order is preserved unless an explicit `categorySort` field sort precedes
accumulation, and every nonempty result gets exactly one final Total. No starting
value, intermediate subtotal, hidden/renamed total, breakdown, native item limit,
custom axis configuration or native color override is implemented. The color
roles follow QuickSight's convention; exact colors, geometry, default category
ordering and totals parity have not been measured. Themes style the surrounding
chart; palettes do not replace these semantic colors.

Labels and tooltips show signed deltas (or the signed final total), never assist
values or unsigned bar heights. Labels support the existing decimal control.
The legend identifies the Values measure, with configurable visibility and
position. It is not a category or color-role legend. Tooltip visibility uses the
existing definition option. View data retains only the original supplied rows;
the appended Total has no source-row selection. Ordinary bars select their
category through the existing interaction path.

The builder starts with region and revenue for synthetic sales. Both wells
replace their existing assignment when another field is chosen. API previews
query the assigned dimension and measure through the existing query path;
offline previews recompute pinned synthetic sales across all regions and identify
that source in the UI. The static demo is not a deployed server. Both paths use
the same compiler and accumulation logic.

Missing or multiple fields raise path-qualified `CompileError` messages with
`WATERFALL_CATEGORY_REQUIRED` or `WATERFALL_VALUES_REQUIRED`. Supplying a
`Breakdowns`/`breakdowns` member, including an empty one, raises
`WATERFALL_BREAKDOWN_UNSUPPORTED`. Null deltas raise `WATERFALL_VALUE_INVALID`;
overflowing running totals raise `WATERFALL_TOTAL_OVERFLOW`. Shared validation
rejects nonnumeric/nonfinite cells and duplicate category groups. Null category
values display as `(null)` and retain their typed identity.

Unsupported native properties, detailed tooltips, sorting limits and future
options raise a path-qualified `CompileError` in the import report. Blocked
imports never issue preview queries, and unchanged exports retain the original
JSON. Dataset and field authorization continue through the existing gates.

See [verification and screenshot findings](issue-47-gap-notes.md).
