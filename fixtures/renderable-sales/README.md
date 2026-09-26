# Reconstructed query/render specification

This is a provisional, docs-derived fixture for a future renderer, not a captured
bundle or proof of QuickSight compatibility. The repository has no renderer yet.
The parser suite verifies field references, source linkage, layout coverage and
handwritten reference SQL using Node's in-memory SQLite. The separate
[query-engine suite](../../packages/query-engine/README.md) compiles the supported
synthetic subset to DuckDB SQL and checks generated-query results against these
oracles. This is local regression coverage, not captured QuickSight conformance or
a Postgres pushdown test. Tests never connect to the placeholder data source.

Files have distinct roles:

| File | Contract |
|---|---|
| `analysis.json` | Synthetic OpenSight envelope around an analysis definition subset |
| `describe-data-set.response.json` | Reconstructed **API response body** describing physical/logical tables and column types |
| `describe-data-source.response.json` | Reconstructed **API response body** describing a placeholder Postgres source |
| `local-data.json` | Trusted OpenSight test-only mapping to local CSV, with explicit unrestricted dataset/source declarations; not AWS security metadata |
| `sales.csv` | Deterministic test data supplied separately from asset definitions; blank cells mean null |
| `expected-queries.json` | Ordered reference SQL results for each visual with the enabled East filter |
| `semantic-cases.json` | Planning regression oracles; deferred cases must not be enabled before real QuickSight comparisons |

The bar groups by region, line by calendar month, ordinary table by region, KPI
sums revenue, and pie groups by category. Every measure has an explicit SUM and
every visual appears in the grid layout. The table binds `discounted_revenue`
(`{revenue} * 0.9`) as a row calculation before aggregation. All five visuals use
the static category filter `region = East`, with null regions excluded. UTC and
ascending query-result ordering make the expectations deterministic. Advanced
period differences and division live in separate deferred semantic cases.

The dataset/source bodies follow [DescribeDataSet](https://docs.aws.amazon.com/quicksight/latest/APIReference/API_DescribeDataSet.html)
and [DescribeDataSource](https://docs.aws.amazon.com/quicksight/latest/APIReference/API_DescribeDataSource.html).
Bindings follow [bar field wells](https://docs.aws.amazon.com/quicksight/latest/APIReference/API_BarChartAggregatedFieldWells.html),
[line field wells](https://docs.aws.amazon.com/quicksight/latest/APIReference/API_LineChartAggregatedFieldWells.html),
[table field wells](https://docs.aws.amazon.com/quicksight/latest/APIReference/API_TableAggregatedFieldWells.html),
[KPI field wells](https://docs.aws.amazon.com/quicksight/latest/APIReference/API_KPIFieldWells.html),
[pie field wells](https://docs.aws.amazon.com/quicksight/latest/APIReference/API_PieChartAggregatedFieldWells.html),
and [grid elements](https://docs.aws.amazon.com/quicksight/latest/APIReference/API_GridLayoutElement.html).
[Asset exports contain definitions, not underlying data](https://docs.aws.amazon.com/quicksight/latest/developerguide/assetbundle-export.html).

No captured API contracts or AWS SDK/model revision are implied by these examples.
Record those separately before implementing API endpoints (SOLUTION_DESIGN §3.2).
