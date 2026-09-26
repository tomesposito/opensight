/**
 * Observed QUICKSIGHT_JSON archive members, in their original camelCase.
 * These are distinct from the PascalCase definition inventory in types.ts and
 * from Describe*Definition response envelopes. See docs/research/bundle-format.md.
 * Unknown properties survive parsing; these types grant no execution capability.
 */
import type { UnknownProperties } from './types.js';

export interface BundleDefinition extends UnknownProperties {
  dataSetIdentifierDeclarations: BundleDataSetIdentifierDeclaration[];
  sheets?: BundleSheet[];
  /** Only empty arrays observed: item schemas deliberately remain unknown. */
  calculatedFields?: unknown[];
  parameterDeclarations?: unknown[];
  filterGroups?: unknown[];
  analysisDefaults?: UnknownProperties;
  options?: UnknownProperties;
  queryExecutionOptions?: UnknownProperties;
}

export interface BundleDataSetIdentifierDeclaration extends UnknownProperties {
  identifier: string;
  dataSetArn: string;
}

export interface BundleSheet extends UnknownProperties {
  sheetId: string;
  name?: string;
  visuals?: BundleVisual[];
  layouts?: UnknownProperties[];
  contentType?: string;
}

/** Exactly one type key at runtime; unobserved visual kinds retain their body. */
export interface BundleVisual {
  pieChartVisual?: BundlePieChartVisual;
  [kind: string]: BundleVisualBody | undefined;
}

export interface BundleVisualBody extends UnknownProperties {
  visualId: string;
  title?: BundleVisualTitle;
  subtitle?: BundleVisualTitle;
}

export interface BundleVisualTitle extends UnknownProperties {
  visibility?: string;
  // No title text was observed; other properties remain opaque.
}

export interface BundlePieChartVisual extends BundleVisualBody {
  chartConfiguration?: BundlePieChartConfiguration;
  actions?: unknown[];
  columnHierarchies?: unknown[];
}

export interface BundlePieChartConfiguration extends UnknownProperties {
  fieldWells?: BundlePieChartFieldWells;
  sortConfiguration?: UnknownProperties;
  donutOptions?: UnknownProperties;
  dataLabels?: UnknownProperties;
  tooltip?: UnknownProperties;
}

export interface BundlePieChartFieldWells extends UnknownProperties {
  pieChartAggregatedFieldWells?: BundlePieChartAggregatedFieldWells;
}

export interface BundlePieChartAggregatedFieldWells extends UnknownProperties {
  category?: BundleDimensionField[];
  values?: BundleMeasureField[];
}

export interface BundleDimensionField extends UnknownProperties {
  categoricalDimensionField?: BundleColumnField;
}

export interface BundleMeasureField extends UnknownProperties {
  numericalMeasureField?: BundleNumericalMeasureField;
}

export interface BundleColumnField extends UnknownProperties {
  fieldId: string;
  column: BundleColumnIdentifier;
}

export interface BundleColumnIdentifier extends UnknownProperties {
  dataSetIdentifier: string;
  columnName: string;
}

export interface BundleNumericalMeasureField extends BundleColumnField {
  aggregationFunction?: { simpleNumericalAggregation?: string } & UnknownProperties;
}

interface BundleDefinitionResource extends UnknownProperties {
  name: string;
  definition: BundleDefinition;
  validationStrategy?: { mode: string } & UnknownProperties;
}

export interface BundleAnalysis extends BundleDefinitionResource {
  resourceType: 'analysis';
  analysisId: string;
}

export interface BundleDashboard extends BundleDefinitionResource {
  resourceType: 'dashboard';
  dashboardId: string;
  dashboardPublishOptions?: UnknownProperties;
  linkEntities?: string[];
}

export interface BundleDataSet extends UnknownProperties {
  resourceType: 'dataset';
  dataSetId: string;
  name: string;
  physicalTableMap: Record<string, BundlePhysicalTable>;
  importMode: string;
  dataSetRefreshProperties?: UnknownProperties;
  dataPrepConfiguration?: UnknownProperties;
  semanticModelConfiguration?: UnknownProperties;
}

export interface BundlePhysicalTable extends UnknownProperties {
  relationalTable?: BundleRelationalTable;
}

export interface BundleRelationalTable extends UnknownProperties {
  dataSourceArn: string;
  catalog?: string;
  schema?: string;
  name: string;
  inputColumns: BundleInputColumn[];
}

export interface BundleInputColumn extends UnknownProperties {
  name: string;
  id?: string;
  type: string;
}

export interface BundleDataSource extends UnknownProperties {
  resourceType: 'datasource';
  dataSourceId: string;
  name: string;
  type: string;
  dataSourceParameters?: {
    athenaParameters?: { workGroup?: string } & UnknownProperties;
  } & UnknownProperties;
  sslProperties?: { disableSsl?: boolean } & UnknownProperties;
}

export type BundleResource = BundleAnalysis | BundleDashboard | BundleDataSet | BundleDataSource;
export type BundleResourceType = BundleResource['resourceType'];

export interface QsBundleMember {
  /** Original, validated ZIP member path. */
  path: string;
  resource: BundleResource;
}

export interface QsBundle {
  /** File members, in central-directory order. Directory entries are not assets. */
  members: QsBundleMember[];
}
