// Public consumer checks for provisional API types; these do not call a parser.
import type {
  AnalysisDefinition, BundleDefinition, CalculatedField, QuickSightApi,
} from '@opensight/bundle-parser';

const api: QuickSightApi.AnalysisDefinition = {
  DataSetIdentifierDeclarations: [{ Identifier: 'sales', DataSetArn: 'example-arn' }],
  CalculatedFields: [{ Name: 'margin', Expression: '{revenue} - {cost}', TopicIdentifier: 'topic' }],
  TopicIdentifierDeclarations: [{ Identifier: 'topic', TopicArn: 'example-topic-arn' }],
  Options: { Timezone: 'UTC', WeekStart: 'MONDAY', QBusinessInsightsStatus: 'DISABLED' },
  QueryExecutionOptions: { QueryExecutionMode: 'MANUAL' },
  Sheets: [{ SheetId: 'sheet', Description: 'Example', ContentType: 'INTERACTIVE' }],
  ColumnConfigurations: [{ Column: { ColumnName: 'revenue', DataSetIdentifier: 'sales' }, Role: 'MEASURE' }],
};
const response: QuickSightApi.DescribeAnalysisDefinitionResponse = {
  AnalysisId: 'example', Definition: api, ResourceStatus: 'CREATION_SUCCESSFUL',
  Errors: [{ Type: 'COLUMN_TYPE_MISMATCH', ViolatedEntities: [{ Path: 'example.path' }] }],
};
const dashboard: QuickSightApi.DescribeDashboardDefinitionResponse = {
  DashboardId: 'example', Definition: { DataSetIdentifierDeclarations: [] },
};
const omittedResponseMembers: QuickSightApi.DescribeAnalysisDefinitionResponse = {};
const queryMode: 'AUTO' | 'MANUAL' | undefined = response.Definition?.QueryExecutionOptions?.QueryExecutionMode;

// @ts-expect-error HTTP Status is not a declared JSON body member; unknown stays unknown.
const httpStatus: number = response.Status;
// @ts-expect-error SDK metadata is not a declared JSON body member.
const sdkRequestId: string = response.$metadata.requestId;
// @ts-expect-error Dashboard definitions do not declare analysis query options.
const dashboardMode: string = dashboard.Definition!.QueryExecutionOptions.QueryExecutionMode;
// @ts-expect-error The API type has not certified the stricter synthetic inventory.
const synthetic: AnalysisDefinition = api;
// @ts-expect-error API definitions cannot replace camelCase archive definitions.
const archive: BundleDefinition = api;
declare const bundle: BundleDefinition;
// @ts-expect-error Archive definitions cannot replace PascalCase API definitions.
const fromArchive: QuickSightApi.AnalysisDefinition = bundle;
const topicCalculation: QuickSightApi.CalculatedField = {
  Name: 'margin', Expression: '{revenue} - {cost}', TopicIdentifier: 'topic',
};
// @ts-expect-error Legacy synthetic calculations still require a dataset identifier.
const legacyCalculation: CalculatedField = topicCalculation;

const declarations: QuickSightApi.ParameterDeclaration[] = [
  { StringParameterDeclaration: {
    Name: 'region', ParameterValueType: 'MULTI_VALUED', DefaultValues: { StaticValues: ['East'] },
    MappedDataSetParameters: [{ DataSetIdentifier: 'sales', DataSetParameterName: 'region' }],
    ValueWhenUnset: { ValueWhenUnsetOption: 'NULL' },
  } },
  { IntegerParameterDeclaration: {
    Name: 'limit', ParameterValueType: 'SINGLE_VALUED', DefaultValues: { StaticValues: [10] },
    ValueWhenUnset: { CustomValue: 5 },
  } },
  { DecimalParameterDeclaration: {
    Name: 'rate', ParameterValueType: 'SINGLE_VALUED', DefaultValues: { StaticValues: [0.5] },
  } },
  { DateTimeParameterDeclaration: {
    Name: 'date', TimeGranularity: 'MONTH', DefaultValues: {
      RollingDate: { Expression: 'example-expression' },
      DynamicValue: { DefaultValueColumn: { ColumnName: 'date', DataSetIdentifier: 'sales' } },
    },
  } },
];
// @ts-expect-error Numeric default arrays are not string arrays.
const wrongDefaults: QuickSightApi.DecimalDefaultValues = { StaticValues: ['1'] };
// @ts-expect-error Value declarations still require cardinality in the new API types.
const missingCardinality: QuickSightApi.StringParameterDeclaration = { Name: 'region' };
// @ts-expect-error A parameter declaration selects one documented variant.
const mixedParameter: QuickSightApi.ParameterDeclaration = { DateTimeParameterDeclaration: { Name: 'd' }, StringParameterDeclaration: { Name: 's', ParameterValueType: 'SINGLE_VALUED' } };
declare const dateDefaults: QuickSightApi.DateTimeDefaultValues;
// @ts-expect-error Documentary Timestamp does not assume SDK Date objects.
const sdkDate: Date | undefined = dateDefaults.StaticValues?.[0];

const dimension: QuickSightApi.DimensionField = { CategoricalDimensionField: {
  FieldId: 'country', Column: { ColumnName: 'country', DataSetIdentifier: 'sales' },
} };
const measure: QuickSightApi.MeasureField = { NumericalMeasureField: {
  FieldId: 'revenue', Column: { ColumnName: 'revenue', DataSetIdentifier: 'sales' },
  AggregationFunction: { SimpleNumericalAggregation: 'SUM' },
} };
const pie: QuickSightApi.PieChartFieldWells = {
  PieChartAggregatedFieldWells: { Category: [dimension], SmallMultiples: [dimension], Values: [measure] },
};
const scatter: QuickSightApi.ScatterPlotFieldWells = {
  ScatterPlotUnaggregatedFieldWells: { XAxis: [dimension], YAxis: [dimension], Size: [measure] },
};
const plugin: QuickSightApi.PluginVisualFieldWell = {
  AxisName: 'GROUP_BY', Dimensions: [dimension], Measures: [measure],
  Unaggregated: [{ FieldId: 'country', Column: { ColumnName: 'country' } }],
};
const table: QuickSightApi.TableFieldWells = {
  TableUnaggregatedFieldWells: { Values: plugin.Unaggregated },
};
const radar: QuickSightApi.RadarChartAggregatedFieldWells = { Color: [dimension] };
const tree: QuickSightApi.TreeMapAggregatedFieldWells = { Colors: [measure] };
// @ts-expect-error Known table variants are mutually exclusive.
const mixedTable: QuickSightApi.TableFieldWells = { TableAggregatedFieldWells: {}, TableUnaggregatedFieldWells: {} };
// @ts-expect-error API field identifiers are strings, not numbers.
const wrongFieldId: QuickSightApi.CalculatedMeasureField = { FieldId: 1, Expression: '1' };
const unknownFutureProperty: unknown = pie.FutureOption;

void [dashboard, omittedResponseMembers, queryMode, httpStatus, sdkRequestId,
  dashboardMode, synthetic, archive, fromArchive, legacyCalculation, declarations,
  wrongDefaults, missingCardinality, mixedParameter, sdkDate, pie, scatter, plugin,
  table, radar, tree, mixedTable, wrongFieldId, unknownFutureProperty];
