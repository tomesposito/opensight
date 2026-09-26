// Compile the public declaration entry just as a workspace consumer would.
import { parseSyntheticAnalysis, summarizeBundle } from '@opensight/bundle-parser';
import type { AnalysisDefinition, ParameterDeclaration, FilterGroup } from '@opensight/bundle-parser';
const definition: AnalysisDefinition = { DataSetIdentifierDeclarations: [] };
summarizeBundle(parseSyntheticAnalysis({
  ResourceType: 'Analysis', AnalysisId: 'a', Name: 'A', Definition: definition,
}));
const date: ParameterDeclaration = { DateTimeParameterDeclaration: { Name: 'date' } };
// @ts-expect-error Value parameters must specify their cardinality.
const missingCardinality: ParameterDeclaration = { StringParameterDeclaration: { Name: 'region' } };
// @ts-expect-error Arbitrary cardinality strings are not valid.
const invalidCardinality: ParameterDeclaration = { IntegerParameterDeclaration: { Name: 'count', ParameterValueType: 'ANY' } };
// @ts-expect-error Only one parameter variant can be present.
const ambiguous: ParameterDeclaration = { StringParameterDeclaration: { Name: 's', ParameterValueType: 'SINGLE_VALUED' }, DateTimeParameterDeclaration: { Name: 'd' } };
// @ts-expect-error CrossDataset, Filters and ScopeConfiguration are required.
const incompleteFilter: FilterGroup = { FilterGroupId: 'filter' };
void [ambiguous, date, missingCardinality, invalidCardinality, incompleteFilter];

import {
  listZipMembers, loadQsBundle, parseQsBundle, parseBundleResource, summarizeQsBundle,
} from '@opensight/bundle-parser';
import type { BundleDefinition, BundleResource, QsBundle, QsBundleSummary } from '@opensight/bundle-parser';

const bundleDefinition: BundleDefinition = {
  dataSetIdentifierDeclarations: [{ identifier: 'sales', dataSetArn: 'example-arn' }],
  sheets: [{ sheetId: 'sheet', visuals: [{ pieChartVisual: {
    visualId: 'pie', chartConfiguration: { fieldWells: { pieChartAggregatedFieldWells: {
      category: [{ categoricalDimensionField: {
        fieldId: 'country', column: { dataSetIdentifier: 'sales', columnName: 'country' },
      } }],
      values: [{ numericalMeasureField: {
        fieldId: 'deaths', column: { dataSetIdentifier: 'sales', columnName: 'deaths' },
        aggregationFunction: { simpleNumericalAggregation: 'SUM' },
      } }],
    } } },
  } }] }],
};
const resource: BundleResource = {
  resourceType: 'analysis', analysisId: 'a', name: 'A', definition: bundleDefinition,
};
const realBundle: QsBundle = { members: [{ path: 'analysis/a.json', resource }] };
const realSummary: QsBundleSummary = summarizeQsBundle(realBundle);
const columnName: string | undefined = bundleDefinition.sheets?.[0]?.visuals?.[0]
  ?.pieChartVisual?.chartConfiguration?.fieldWells?.pieChartAggregatedFieldWells
  ?.values?.[0]?.numericalMeasureField?.column.columnName;
const unknownCalculation: unknown = bundleDefinition.calculatedFields?.[0];
// @ts-expect-error PascalCase definitions cannot substitute for archive definitions.
const wrongArchiveDefinition: BundleDefinition = definition;
// @ts-expect-error Archive definitions cannot substitute for API-shaped definitions.
const wrongApiDefinition: AnalysisDefinition = bundleDefinition;
// @ts-expect-error Resource discriminators use lowercase in archives.
const wrongDiscriminator: BundleResource = { resourceType: 'Analysis', analysisId: 'a', name: 'A', definition: bundleDefinition };
const parsedResource = parseBundleResource(resource);
if (parsedResource.resourceType === 'dataset') {
  const importMode: string = parsedResource.importMode;
  void importMode;
}
// Exercise signatures without doing I/O during typechecking.
const loadArchive: (path: string | URL) => Promise<QsBundle> = loadQsBundle;
const parseArchive: (bytes: Uint8Array) => Promise<QsBundle> = parseQsBundle;
void [realSummary, columnName, unknownCalculation, wrongArchiveDefinition,
  wrongApiDefinition, wrongDiscriminator, loadArchive, parseArchive, listZipMembers];
