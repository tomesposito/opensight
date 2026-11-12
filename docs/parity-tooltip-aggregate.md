# Detailed tooltips for transformed visuals

The `parity-tooltip-aggregate` phase-plan fallback completes rendering for all
16 kinds that already accept detailed tooltip configuration. No new settings,
dependencies, query semantics or hosted resources are required. The existing
12 row-based formatters and the configuration gates remain unchanged.

| Visual | Detailed fields | Extra fields |
| --- | --- | --- |
| Treemap | Dimension labels in hierarchy order, values from `treePathInfo` excluding the synthetic root; hovered node size | Exact source row on leaves only; parents have no extra lines |
| Word cloud | Word and compiled weight (`value[2]`) | Original row retained through sorting and the 80-word cap |
| Box plot | Group and measure min, Q1, median, Q3, max from compiled statistics | One compile warning; no invented values |
| Histogram | Measure label with compiled bin range, plus Frequency | One compile warning; no invented values |

Primary-value titles use the first treemap dimension, word, box group or
histogram bin range. Field-title mode uses the primary dimension's label,
except histogram, which always uses the measure label, including when a sample
dimension is configured. Hiding a field does not hide the title. Hiding the
box measure removes all five statistics; an empty group likewise retains only
its title and visible dimension. Hiding the histogram measure removes the bin
line but keeps Frequency.

Treemap/word measure labels follow the existing aggregation toggle and governed
metric formatting. Box statistic labels explicitly name the statistic without
a Sum prefix; histogram ranges and counts are not formatted as currency or
percent measures. Box statistic values do use governed metric formats. Dynamic
labels, dimension values and extra-field text escape rich-text braces.

Non-rendering `sourceRowIndex` metadata is emitted only for detailed treemap
leaves and word datums, preserving basic series output. The treemap builder's
existing later-row-wins behavior for equal display paths applies to both size
and source index. The public compiler still rejects duplicate typed category
paths before building the hierarchy; this slice does not relax that validation.
Missing extra columns retain their existing warnings. Configured box/histogram
extras add one aggregate-data warning without replacing other diagnostics.

None of these four kinds supports faceting: `FACETED_KINDS` in
`packages/web/src/facet-layout.ts` contains only bar, 100% bar, line, area, combo
and pie, and compiler normalization gates small-multiples wells with that list.

The Tooltip section no longer displays the obsolete basic-fallback hint.
Compiler/editor tests live in `packages/web/test/tooltip-detail.test.mjs` and
`tooltip-extra-fields.test.mjs`, both included by root `npm test`.
Visual fidelity is not measured; functional tooltip coverage is not a claim
of QuickSight pixel equivalence.

Offline captures of the rebuilt static demo:
[treemap](images/tooltip-treemap.png), [word cloud](images/tooltip-wordCloud.png),
[box plot](images/tooltip-box.png), [histogram](images/tooltip-histogram.png).
