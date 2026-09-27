# Synthetic bundle fixtures

**SYNTHETIC — mechanically converted from public AWS sample repos (and the
independent Sigma migration sample below). NOT ground truth for bundle semantics;
parser robustness/fuzz coverage only.** These are readable, expanded bundle
members, not actual QuickSight exports. Tests ZIP them at their relative paths
and run the real `.qs` archive parser. No AWS calls or source data are involved.

Downloaded 2026-09-27 using `~/workspace/skills/github/bin/gh-api GET
/repos/{owner}/{repo}/contents/{path}` and Python base64 decoding. The source
URLs and Git blob SHA-1s identify the exact downloaded versions:

| Fixture | Public source | Git blob SHA-1 | Source bytes |
| --- | --- | --- | ---: |
| `dashboard/automotive.json` | [AWS automotive dashboard](https://github.com/aws-solutions-library-samples/guidance-for-automotive-data-platform-on-aws/blob/main/guidance-for-agentic-customer-360/deployment/quicksight/dashboard-definition.json) | `24bd2eaf5955f7db4cdfca67ccce5e4b51c74006` | 223473 |
| `analysis/assets-as-code.json` | [AWS assets-as-code definition](https://github.com/aws-samples/amazon-quicksight-assets-as-code-sample/blob/main/src/asset_definition.json) | `9d36c99d0874b221fa3202641f3c8118d9b37dc2` | 63314 |
| `analysis/orders-overview.json` | [Sigma migration orders analysis](https://github.com/twells89/sigma-migration-skills/blob/main/plugins/quicksight-to-sigma/skills/quicksight-to-sigma/fixtures/orders-overview-analysis.json) | `958069e34bfa7f5927b9c623eb339f2fd9ce8680` | 22018 |

The actual downloads differ from the earlier candidate sweep descriptions:
automotive has 37 visuals (including combo and scatter), **zero parameters and
filters**; assets-as-code has **two sheets**, not four. Counts below were taken
from the downloaded definitions and are asserted independently in tests.

| Fixture | Sheets | Visuals | Parameters | Filter groups | Filters | Calculated fields |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| automotive | 2 | 37 | 0 | 0 | 0 | 1 |
| assets-as-code | 2 | 7 | 2 | 2 | 2 | 1 |
| orders-overview | 1 | 5 | 0 | 0 | 0 | 2 |
| feature-variants | 1 | 5 | 4 | 1 | 3 | 3 |

Visual breakdown: automotive = 29 KPI, 3 pie, 2 line, 1 table, 1 combo, 1 scatter;
assets-as-code = 3 bar, 2 line, 1 table, 1 KPI; orders = 2 KPI, 1 bar, 1 line,
1 pie. `analysis/feature-variants.json` is an explicitly **author-augmented**
copy of converted orders: four string/datetime/integer/decimal declarations,
three category/numeric-range/relative-date filters, and a calculation referencing
another calculation and a parameter. These additions cover gaps in the sources;
they are not attributed to the upstream samples. Source conversions are unaugmented.

Sanitization: scanned all source text for 12-digit account IDs, ARNs, hostnames,
and emails. Only example/template QuickSight dataset ARNs were present; no
hostnames or emails were found. All account IDs and account placeholders
(`{{ACCOUNT_ID}}`, `<aws-account-id>`) become `123456789012`; `{{REGION}}` becomes
`us-east-1`. Public sample dataset names/UUIDs remain as reference identities.
API response metadata is discarded. API-shaped source copies, both raw and
sanitized, are kept only in `/tmp/opensight-synthetic`, never in this repository.
Tests also check the committed members for identifier hygiene and camelCase keys.

Conversion uses **the existing** `packages/web/src/definition-converter.ts`.
The generator imports it directly using Node 24's TypeScript stripping:

```sh
node packages/bundle-parser/scripts/generate-synthetic-fixtures.mjs /tmp/opensight-synthetic
npm test
```

The generator expects `automotive.sanitized.json`, `assets-as-code.sanitized.json`,
and `orders-overview.sanitized.json`. Re-download an exact source if needed via
`gh-api GET /repos/{owner}/{repo}/git/blobs/{sha}` and base64-decode `content`.
Sanitize as above before generating; the generator rejects unreviewed identifiers.
It performs no download or AWS operation, and tests need no network or `/tmp` files.

Unobserved mapping assumptions:

- The real `TotalDeathByCountry.qs` sample grounds resource directories,
  `resourceType`, IDs, `name`, `definition`, camelCase, and `validationStrategy`.
  Synthetic resource IDs/names and `LENIENT` envelopes are supplied locally.
  API `Definition` wrappers are removed; the automotive bare definition is used
  directly. Dataset dependencies are declarations only; no dataset or datasource
  resource is fabricated. These archives are not import-ready exports.
- Known API members are mapped by context, including acronym keys (`KPIVisual`
  → `kpiVisual`). Unknown subtrees and dictionary keys remain verbatim in the
  converter; the generator rejects any unmapped PascalCase key in these sources.
  Strings, expressions, enum values, sheet/visual IDs, and array order survive.
- Nonempty parameter/filter/calculation structures, KPI/table/line/bar/combo/
  scatter configurations, freeform layouts, formatting, and actions have **not**
  been observed in a real bundle. Their API-shaped structure is provisionally
  preserved with renamed members. Samples contain both direct KPI wells and a
  `KPIFieldWells` wrapper; both are retained and validated.
- Feature validation checks inventory structure, scalar types, variant shape,
  range ordering, and duplicate identities. Unknown camelCase parameter/filter
  variants retain their bodies and are explicitly summarized as unsupported.
  Extra properties remain intact. This is not a complete QuickSight schema or
  execution validator; configuration and dataset/parameter references are not
  evaluated, and timestamp strings are retained without timezone interpretation.
- Calculated expressions pass through unchanged. Dependencies are unique direct
  `{field}` and `${parameter}` lexical references, in first-use order, excluding
  quoted literals and comments. Calculation names are resolved within the same
  dataset; other braced names are listed as columns. Bare names, transitive
  dependencies, cycle detection, and expression evaluation are outside this
  inventory. This does not assert semantic equivalence or render/query support.
