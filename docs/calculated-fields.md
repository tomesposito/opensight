# Calculated fields (Phase 2c)

The browser-safe query-engine catalog is the source of signatures, examples and
validation for the editor and both SQL dialects. Expressions are parsed into a
typed tree; they are never JavaScript or caller-supplied SQL. Field references use
`{field}`, scalar parameter references use `${Parameter}`, and string constants
use single or double quotes. Comparisons, AND/OR/NOT, arithmetic and null literals
can be used in conditional expressions. Division by zero returns null.

The catalog includes string, numeric, datetime, conditional, aggregate, table,
level-aware and conversion functions specified in Phase 2c. Function names are
case-insensitive. Diagnostics identify unsupported names and give the expected
signature for invalid calls. The bundle keeps the original expression text,
including whitespace. Import reports enumerate unknown functions for each
calculated field, including remote fields, and preserve their original JSON.

## Execution

Row functions and normal aggregate expressions compile to parameterized SQL for
DuckDB and PostgreSQL. Identifiers are quoted and string literals/parameters are
bound as values. Calculated aggregate measures execute at the visual grouping
level; they are not wrapped in another field-well aggregate. Aggregate/nonaggregate
mixing and nested ordinary aggregates are rejected.

Table calculations and level-aware expressions use one shared processing layer
in `packages/query-engine/src/evaluate.ts`. Both SQL executors feed it rows with
pushed scalar calculations; the browser evaluates the same tree on fixture rows.
Its order is:

1. Scalar calculations and PRE_FILTER windows over the unfiltered source.
2. Analysis/visual filters on source and PRE_FILTER fields.
3. PRE_AGG windows, followed by filters on their results.
4. Visual grouping and aggregates, followed by aggregate filters.
5. POST_AGG_FILTER windows and table calculations, followed by their result filters.

A PRE_FILTER/PRE_AGG measure must be unaggregated; a POST_AGG_FILTER measure must
be aggregated. The default window level is POST_AGG_FILTER. Partition fields in
PRE_* windows need not appear in the visual. Table sort/partition fields must be
available at its grouping level. The explicit field-well aggregation still applies
to PRE_* results. For one partition value at a visual grain, use an explicit
`min(sumOver({revenue}, [{region}], PRE_AGG))`, or a MIN field-well aggregation.

Sort lists support multiple keys and ASC/DESC. Running sums include tied sort
peers. Rank leaves gaps after ties; denseRank does not. Difference uses signed
row offsets (`-1` is the previous sorted row). PercentDifference divides by the
absolute comparison value; period percent differences divide by the comparison
period value. Ratios are fractions, with null for a zero denominator.
Period-over-period calculations use calendar periods, not neighboring row offsets;
a missing comparison period produces null. Weeks start Sunday. Calculations use
UTC, and each bound plan captures one instant for all `now()` calls.

Null inputs propagate through ordinary scalar functions. Conditions use three-valued
logic; ifelse evaluates only the selected result, and coalesce returns the first
nonnull result. Aggregates ignore nulls: count and distinct_count return zero for
empty input; other aggregates return null. stdev/var use sample variance;
stdevp/varp use population variance. Median interpolates the two middle values;
percentile uses an observed value (discrete percentile, 0–100).

String positions are one-based and count Unicode code points. Number conversions
reject malformed strings as null, and integer conversions truncate toward zero.
Datetime formats use Joda-style numeric date/time tokens, month/day names, AM/PM,
millisecond fractions and numeric timezone offsets; literal text is single-quoted
inside the format. Unsupported tokens produce a located diagnostic. Calendar
addition clips to the last valid day of the destination month. Invalid parsed
dates return null rather than overflowing into the next month.

## Verification and dependency

Root `npm test` includes per-function scalar cases, editor interaction/validation,
verbatim import/export reports, API coverage, and DuckDB/PostgreSQL/client
comparisons on the checked-in sales fixture. Floating aggregate comparisons allow
relative error of 1e-12; strings, dates, nulls, ranks and counts compare exactly.
The historical semantic fixture's missing-period and ratio cases now execute.
These are documented-semantics regression tests, not captured AWS conformance
results; no AWS requests are made.

PostgreSQL differential tests execute real PostgreSQL SQL in the local WASM engine
provided by test-only `@electric-sql/pglite@0.5.8`. Its package metadata and LICENSE
were checked: Apache-2.0, with no npm runtime dependencies. No production dependency
was added. The existing `pg` driver remains the production executor; driver tests
cover result normalization and the shared processing path. The existing optional
external-server suite still uses DATABASE_URL when configured.

`npm run build:demo --workspace @opensight/web` produces the standalone demo at
`packages/web/dist/opensight-demo.html`.
