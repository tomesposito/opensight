# Grouped measure combination (#313)

The compiler consumes authorized, already-grouped rows. It cannot recover an
overall ratio, weighted average or distinct count by adding those results.
KPI trend totals (including targets), category “Other” buckets and small-multiple
“Other” buckets now require a proven combination operation for each measure.

`metricCombination` is exported by both query-engine entry points. Row-level,
PRE_FILTER and PRE_AGG metric expressions use their outer default aggregation:
SUM/COUNT combine by addition, MIN/MAX by their extremum, and AVG/DISTINCT_COUNT
have no supported combination. Expressions that aggregate themselves are proven
only for a single top-level sum/count/min/max call over row-level arguments.
Ratios, weighted averages, unary wrappers, nested aggregates, windows and parse
failures return NONE. The binding enum alone cannot prove an aggregate metric.

Normalized measure fields preserve their binding aggregation, including KPI
targets. Compiler inputs may supply the published metric definitions as
`metrics`; a governed reference without its definition has mode NONE. Existing
admission rules, including explicit SUM bindings for trended KPIs, are unchanged.

Combining two or more groups with mode NONE raises
`NONADDITIVE_MEASURE_COMBINATION`. Nulls are skipped for supported operations,
all-null groups remain null, and non-finite totals fail. A single group needs no
combination, including a single row renamed “Other”. Non-binding limits and
EXCLUDE limits need no proof. Category limits combine independently within each
remaining-dimension bucket; facet limits combine within each category bucket.
KPI value and target totals resolve separate modes; comparison and sparkline
values still use individual groups.

Author previews and published dashboard cards pass available dataset/query metric
definitions. Reports and dashboard exports pass the definitions returned by their
existing queries. The legacy EmbedContent/JobRenderer path has no metric
resolution in hand and retains fail-closed behavior without a new lookup path.
No source-data recomputation, dependency or configuration was added.

Regression suites cover both compiler dialects, independent value/target modes,
ratios and weighted averages, counts, extrema, nulls, overflow, missing definitions,
literal Other collisions and buckets that do not combine. Existing KPI, category,
facet, table and pivot output oracles remain intact; their comparisons explicitly
check then exclude only the newly preserved aggregation metadata.
