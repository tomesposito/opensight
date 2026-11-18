# Category limits — parity-category-limit

This phase-plan fallback slice computes `CategoryItemsLimit` for bar,
100% stacked bar, line, area and combo, alongside the existing pie support.
It follows the supplied run brief without changing `SOLUTION_DESIGN.md`,
adding dependencies or changing query execution.

Native `SortConfiguration.CategoryItemsLimit` and internal
`sortConfiguration.categoryItemsLimit` accept an integer count from 1–100
and `OtherCategories`/`otherCategories` of `INCLUDE` (the default) or `EXCLUDE`.
Invalid counts, enums and unknown compiler properties fail closed. An absent
count preserves the existing “no slice limit specified; all supplied result
rows are shown” warning; no QuickSight default count is assumed.

Within each facet panel, distinct category values rank by first appearance
in the existing display order. An explicit category sort runs first. All rows
for each of the first N categories are retained. This is display-order
limiting, not an implicit measure-ranked top-N calculation: the existing
QuickSight sorting divergence remains intentional.

With INCLUDE, remaining categories merge into `Other` rows keyed by the
remaining dimensions. Measures sum independently and remain null if every
contributing value is null. Extra tooltip fields are cleared. When categories
are actually collapsed, a retained literal `Other` folds into the bucket,
without promoting another category into its place. EXCLUDE drops the remaining
categories and leaves any retained literal `Other` untouched. Unset and
non-binding limits preserve rows and extras. Pie retains its previous sum
order, null-slice rejection and literal-Other semantics.

Source duplicates fail before limiting. Facet limits run before category
limits, including when a literal `Other` facet and the merged `Other` panel
have identical titles. Category limiting runs before option building, so chart
series, detailed tooltips, conditional formatting and view-data share the
limited rows. Percentage bars normalize the merged measures afterward and
retain their nonnegative/non-null requirement. Line/area forecasts fit the
remaining dated rows; a synthetic `Other` date is invalid and invokes the
existing explicit “forecast was not rendered” warning.

Properties exposes **Number of categories displayed** and **Group the rest
as Other** in bar/percentage-bar Group/Color, and in a Category limit section
for line/area/combo. Pie keeps its exact slice wording. Invalid input retains
the last valid value; clearing removes the limit. Draft storage and editable
bundle/native import/export preserve the same `sliceLimit` shape and validation.

All other visual kinds still reject category limits: KPI, table, pivot,
insight, waterfall, scatter, funnel, gauge, treemap, heatmap, box plot, word
cloud, histogram, filled/point maps, radar and Sankey. Existing key gates and
the legacy “slice limits are only computed for pie visuals” error remain
unchanged for unsupported kinds.

## Grouped-row scope

The brief assumed bar charts accepted a second group/color dimension. This
checkout rejects both a second category dimension and a nonempty Colors well.
That existing parser/rendering restriction remains. The shared compiler
transform supports and directly tests category × color rows within facets,
including interleaved rows, independent Other sums, nulls and literal-Other
folding. A grouped-bar end-to-end compiler test remains outside this slice;
enabling grouped-bar parsing/rendering requires its own specification.

Tests in `packages/web/test/category-limit.test.mjs`, the existing pie
regressions and Properties tests run through the web test glob in root
`npm test`. See [capture and verification notes](parity-category-limit-gap-notes.md).
