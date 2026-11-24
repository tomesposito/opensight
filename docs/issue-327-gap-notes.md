# Issue #327 — governed metric discovery and version selection

The v1 read contract now includes `list_metrics`, `describe_metric`, and
`list_metric_versions`. MCP and CLI inventories regenerate from OpenAPI, with
56 operations total; TypeScript and Python headless clients expose the same
three reads. Metric creation, editing and publishing remain outside this
contract slice. See [governed metric semantics](governed-metrics.md).

Queries can select historical publications with `__metric_<id>@v<version>`.
The shared resolver uses published-state history supplied by the metric catalog,
including the hosted targeted metadata path. It retains each exact reference
name, applies the selected default aggregation and reports only the selected
metrics. Draft and missing pins fail at `$.metrics` with
`METRIC_VERSION_NOT_PUBLISHED`; unpinned references still follow the current
publication. Tests cover filters, calculated dependencies, two versions in one
query, publication errors, dataset isolation and existing security checks.

## Verification

The root build and final root `npm test` passed. The complete test run reported
**8,428 passed / 0 failed / 1 skipped / 0 cancelled** (8,429 tests), including the
Python SDK workspace. The sole skip is the optional **#91 real TLS PostgreSQL
CLI** integration test: a live TLS PostgreSQL endpoint is not configured. The
ordinary live PostgreSQL tests ran and passed.

| Suite | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| API | 1,617 | 0 | 1 |
| Bundle parser | 213 | 0 | 0 |
| CLI | 76 | 0 | 0 |
| Embedding SDK | 10 | 0 | 0 |
| TypeScript headless SDK | 31 | 0 | 0 |
| Python headless SDK | 33 | 0 | 0 |
| MCP server | 77 | 0 | 0 |
| O interpreter | 42 | 0 | 0 |
| Parity | 11 | 0 | 0 |
| Query engine | 2,719 | 0 | 0 |
| Web | 3,479 | 0 | 0 |
| Root conformance and site | 120 | 0 | 0 |
| **Total** | **8,428** | **0** | **1** |

The first full run exposed an older analysis-contract test that selected routes
by their position between `/analyses` and `/datasets` in the YAML. Adding metric
routes inside that range made it count unrelated operations. The test now parses
the contract and selects analysis resource paths explicitly, preserving its
thirteen-operation assertion. The corrected test passes; final root-suite counts
come from a fresh run after this correction.

Focused checks also passed: 20 metric API contract, route, consumption and
targeted metadata tests, plus 13 governed-query tests including
DuckDB/PostgreSQL/client comparisons. Neither focused group had failures or skips.

J10 completed with **9 passed / 0 failed / 0 skipped / 3 gaps** against the local
hosted API and real MCP server. It discovers Weekly sales by name, describes v4,
lists exactly published versions [2, 4], executes v2 with east 40 / west 20, and
rejects draft v5 and missing v99. The unpinned query returns v4 with east 80 /
west 40. The existing PII, AI spend-cap and audit-history gaps remain (#328–#330).
There are no browser steps in J10.

The reboot left the expected PostgreSQL instance unavailable. Verification uses
a disposable PostgreSQL 16.4 instance on localhost:5433, initialized with the
existing local binaries and synthetic fixtures. It requires no download, AWS
access or deployment. Detailed logs and journey JSON remain outside version
control under `.opensight/issue-327/` and the local temporary directory.

## Static demo and reference comparison

The freshly rebuilt static demo was captured offline in the established classic
editor, new-look editor and Home Q reference states. Chromium reported **0 page
errors / 0 external requests**. The existing reference pairings, regions,
exclusions and pixel tolerance of 16 give:

| Reference pairing | Differing pixels |
| --- | ---: |
| Classic editor | 41.22% |
| New-look editor | 33.97% |
| Q generative | 45.30% |

These are pixel differences, not fidelity grades. The captures retain the
Data → Visuals/field wells → canvas layout; the existing reference mismatch
includes the empty analysis, different fixture content, offline notices and
product chrome. This slice changes the API/client surface and metric resolution,
with no web UI changes or new visual gap identified. The README images need no
refresh. The demo is a local static artifact, not a deployed server.
