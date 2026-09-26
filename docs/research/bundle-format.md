# Observed QUICKSIGHT_JSON bundle format

Ground truth: the sanitized real AWS `TotalDeathByCountry.qs` sample, inspected
2026-09-26. [Provenance, sanitization and checksum](../../fixtures/real-bundle-sample/README.md)
are recorded with the fixture. These observations replace the provisional archive
assumptions in the original parser spike; they do not establish every AWS schema.

## Archive and resource envelopes

The `.qs` file is a ZIP. It contains four DEFLATE-compressed UTF-8 JSON files, in
dashboard, dataset, analysis, datasource order. There is no manifest or directory
entry in this sample. Each resource ID matches its filename. This order is retained
for inventory; dependency resolution must not rely on it.

| Path | `resourceType` | ID field | Other observed fields |
|---|---|---|---|
| `analysis/{id}.json` | `analysis` | `analysisId` | `name`, `definition`, `validationStrategy` |
| `dashboard/{id}.json` | `dashboard` | `dashboardId` | `name`, `definition`, `validationStrategy`, `dashboardPublishOptions`, `linkEntities` |
| `dataset/{id}.json` | `dataset` | `dataSetId` | `name`, `physicalTableMap`, `importMode`, `dataSetRefreshProperties`, `dataPrepConfiguration`, `semanticModelConfiguration` |
| `datasource/{id}.json` | `datasource` | `dataSourceId` | `name`, `type`, `dataSourceParameters`, `sslProperties` |

The dashboard links to the analysis through an example-account ARN. Both
definitions declare dataset identifier `us_simplified` with the dataset ARN. Its
relational physical table references the datasource ARN and has six input columns,
including column `id` properties. The datasource is `ATHENA`, with
`dataSourceParameters.athenaParameters.workGroup` and `sslProperties.disableSsl`.
The dataset uses `SPICE`; its data-preparation/semantic-model graphs are retained
as opaque objects. They must not be mistaken for an execution-ready table mapping.

## Definitions and separate API contracts

Archive definitions are **camelCase**, including nested tagged objects. Both
definitions have one sheet with one `pieChartVisual`. Its category is `country`;
its numerical measure is `deaths` with `simpleNumericalAggregation: "SUM"`.
Grid layouts reference the visual IDs. Dashboard sheet/visual IDs are prefixed
with the dashboard ID; analysis IDs are not. Both have `validationStrategy.mode`
of `LENIENT`. The analysis has `queryExecutionOptions.queryExecutionMode: "AUTO"`;
that property is absent from the dashboard definition.

The correspondence below documents modeled naming, **not an implemented adapter**
or proof that the API and bundle schemas are interchangeable:

| Bundle member / `BundleDefinition` | PascalCase definition/API counterpart |
|---|---|
| `analysisId`, `dashboardId`, `definition` | `AnalysisId`, `DashboardId`, `Definition` in the respective Describe*Definition responses |
| `definition.dataSetIdentifierDeclarations[].identifier / dataSetArn` | `Definition.DataSetIdentifierDeclarations[].Identifier / DataSetArn` |
| `sheets[].sheetId / name / visuals` | `Sheets[].SheetId / Name / Visuals` |
| `visuals[].pieChartVisual.visualId` | `Visuals[].PieChartVisual.VisualId` |
| `chartConfiguration.fieldWells.pieChartAggregatedFieldWells` | `ChartConfiguration.FieldWells.PieChartAggregatedFieldWells` |
| `category[].categoricalDimensionField` | `Category[].CategoricalDimensionField` |
| `values[].numericalMeasureField` | `Values[].NumericalMeasureField` |
| `fieldId`, `column.dataSetIdentifier / columnName` | `FieldId`, `Column.DataSetIdentifier / ColumnName` |
| `aggregationFunction.simpleNumericalAggregation` | `AggregationFunction.SimpleNumericalAggregation` |
| `calculatedFields`, `parameterDeclarations`, `filterGroups` | `CalculatedFields`, `ParameterDeclarations`, `FilterGroups`; **bundle item shapes unobserved** |

`bundle-types.ts` models the observed archive subset. `types.ts` retains the
separate, docs-derived PascalCase `AnalysisDefinition` inventory and synthetic
`SyntheticAnalysisDocument` envelope. The latter's `ResourceType: "Analysis"` is
an OpenSight invention. It is neither a real archive envelope nor a complete
`DescribeAnalysisDefinition` API response. Describe definition responses have
action-specific fields such as status, errors and request ID; metadata Describe
actions are another contract. No API response capture or API adapter is introduced.

Do not recursively change property casing: opaque properties, map keys, field IDs
and future schema differences must survive. A future API adapter needs explicit
schema mappings and independent contract tests. API-derived title text, parameter,
filter and calculation item schemas are not silently imported into bundle types.

## Parser boundary

```ts
import { loadQsBundle, listZipMembers, summarizeQsBundle } from '@opensight/bundle-parser';
import { readFile } from 'node:fs/promises';

const path = 'fixtures/real-bundle-sample/TotalDeathByCountry.sanitized.qs';
const inventory = await listZipMembers(await readFile(path));
const bundle = await loadQsBundle(path);
const summary = summarizeQsBundle(bundle);
```

`parseQsBundle(Uint8Array)` reads in-memory ZIPs; `parseBundleResource(unknown)`
validates a standalone lowercase envelope. `loadBundle` remains the historical
alias for the synchronous synthetic JSON loader. `summarizeQsBundle` inventories
all resources and counts opaque feature arrays. The CLI accepts `.qs` paths and
prints this summary as JSON; synthetic JSON CLI output stays unchanged.

The [yauzl ZIP reader](https://github.com/thejoshwolfe/yauzl) reads the central
directory and members sequentially. OpenSight checks CRC32 on decoded members,
limits archive input to 32 MiB, each member to 16 MiB, total declared decoded size
to 64 MiB, and member count to 1,000. These are local inventory budgets, not AWS
limits. Listing alone checks metadata and names without inflating files or checking
their CRCs. ZIP parsing supports stored and DEFLATE entries, rejects encrypted
members, duplicate/unsafe paths, type/ID mismatches and unknown resource paths,
and never writes extracted files. Directory entries are listed but not assets.

Errors use `ValidationError.path`, for example
`$["analysis/example.json"].definition.sheets[0].sheetId`. The validator checks
typed/consumed nested properties, enforces a single variant in tagged objects,
and preserves unknown properties and omitted optional fields. Unobserved visual
kinds retain their body with a validated `visualId`. Successful inventory grants
no query or rendering capability; unknown semantics must still fail execution.

## Known limits and remaining evidence

- Calculated fields, parameter declarations, filter groups, visual actions and
  column hierarchies are empty here. Their item schemas remain `unknown[]`.
- Layout internals, appearance options, publish options and dataset preparation
  graphs are preserved with only object/array container validation.
- The sample proves one pie, an Athena source and a SPICE dataset. Tom's complex
  export is needed for more visuals, nonempty feature arrays, logical transforms,
  security policies and additional dependencies/resource types (themes/folders).
- Tests compare every member against an independent ZIP decode and repack JSON
  with a test-only ZIP writer. They prove structural preservation for this sample,
  not byte-identical ZIP output, an export API or successful AWS reimport.
- No AWS calls, source-result comparisons, underlying-data execution, API contract
  captures or rendering conformance are part of this work. The synthetic local
  query engine remains on its existing explicit execution allowlist.
