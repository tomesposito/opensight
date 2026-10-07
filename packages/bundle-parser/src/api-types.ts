/**
 * PROVISIONAL, reconstructed-from-docs API projections (2026-09-26).
 * Public sources and bundle evidence: docs/research/api-surface.md.
 *
 * Exported only through the type-only QuickSightApi namespace. These PascalCase
 * values are separate from the synthetic inventory in types.ts and the observed
 * camelCase archive types in bundle-types.ts. No parser returns these types.
 * New optional detail fields do not strengthen any existing validation contract.
 *
 * Required members below follow the individual shape pages; response body members
 * remain optional. Unmodeled object properties stay opaque. These are not full
 * AWS validators: lengths, ranges and conditional rules are not enforced.
 * Timestamp values stay unknown until wire/SDK encoding is pinned. Long values
 * use JavaScript numbers here without promising lossless 64-bit serialization.
 */
import type { UnknownProperties } from './types.js';

/** One documented union member; unknown properties are retained separately. */
type OneOf<Members> = {
  [Kind in keyof Members]: { [Key in Kind]: Members[Key] } &
    { [Other in Exclude<keyof Members, Kind>]?: never }
}[keyof Members] & UnknownProperties;

export type ResourceStatus = 'CREATION_IN_PROGRESS' | 'CREATION_SUCCESSFUL' |
  'CREATION_FAILED' | 'UPDATE_IN_PROGRESS' | 'UPDATE_SUCCESSFUL' |
  'UPDATE_FAILED' | 'DELETED';

/** JSON body only; HTTP Status and SDK $metadata are not declared body fields.
 * @see https://docs.aws.amazon.com/quicksight/latest/APIReference/API_DescribeAnalysisDefinition.html
 */
export interface DescribeAnalysisDefinitionResponse extends UnknownProperties {
  AnalysisId?: string;
  Definition?: AnalysisDefinition;
  Errors?: AnalysisError[];
  Name?: string;
  RequestId?: string;
  ResourceStatus?: ResourceStatus;
  ThemeArn?: string;
}

/** JSON body only; publication settings remain opaque.
 * @see https://docs.aws.amazon.com/quicksight/latest/APIReference/API_DescribeDashboardDefinition.html
 */
export interface DescribeDashboardDefinitionResponse extends UnknownProperties {
  DashboardId?: string;
  DashboardPublishOptions?: UnknownProperties;
  Definition?: DashboardVersionDefinition;
  Errors?: DashboardError[];
  Name?: string;
  RequestId?: string;
  ResourceStatus?: ResourceStatus;
  ThemeArn?: string;
}

/** @see https://docs.aws.amazon.com/quicksight/latest/APIReference/API_DataSetIdentifierDeclaration.html */
export interface DataSetIdentifierDeclaration extends UnknownProperties {
  DataSetArn: string;
  Identifier: string;
}

/** @see https://docs.aws.amazon.com/quicksight/latest/APIReference/API_TopicIdentifierDeclaration.html */
export interface TopicIdentifierDeclaration extends UnknownProperties {
  Identifier: string;
  TopicArn: string;
}

/** @see https://docs.aws.amazon.com/quicksight/latest/APIReference/API_AnalysisDefinition.html */
export interface AnalysisDefinition extends UnknownProperties {
  DataSetIdentifierDeclarations: DataSetIdentifierDeclaration[];
  AnalysisDefaults?: AnalysisDefaults;
  CalculatedFields?: CalculatedField[];
  ColumnConfigurations?: ColumnConfiguration[];
  FilterGroups?: UnknownProperties[];
  Options?: AssetOptions;
  ParameterDeclarations?: ParameterDeclaration[];
  QueryExecutionOptions?: QueryExecutionOptions;
  Sheets?: SheetDefinition[];
  StaticFiles?: UnknownProperties[];
  TooltipSheets?: TooltipSheetDefinition[];
  TopicIdentifierDeclarations?: TopicIdentifierDeclaration[];
}

/** @see https://docs.aws.amazon.com/quicksight/latest/APIReference/API_DashboardVersionDefinition.html */
export interface DashboardVersionDefinition extends UnknownProperties {
  DataSetIdentifierDeclarations: DataSetIdentifierDeclaration[];
  AnalysisDefaults?: AnalysisDefaults;
  CalculatedFields?: CalculatedField[];
  ColumnConfigurations?: ColumnConfiguration[];
  FilterGroups?: UnknownProperties[];
  Options?: AssetOptions;
  ParameterDeclarations?: ParameterDeclaration[];
  Sheets?: SheetDefinition[];
  StaticFiles?: UnknownProperties[];
  TooltipSheets?: TooltipSheetDefinition[];
  TopicIdentifierDeclarations?: TopicIdentifierDeclaration[];
}

/** @see https://docs.aws.amazon.com/quicksight/latest/APIReference/API_SheetDefinition.html */
export interface SheetDefinition extends UnknownProperties {
  SheetId: string;
  ContentType?: 'PAGINATED' | 'INTERACTIVE';
  CustomActionDefaults?: UnknownProperties;
  Description?: string;
  FilterControls?: UnknownProperties[];
  Images?: UnknownProperties[];
  Layouts?: UnknownProperties[];
  Name?: string;
  ParameterControls?: UnknownProperties[];
  SheetControlLayouts?: UnknownProperties[];
  TextBoxes?: UnknownProperties[];
  Title?: string;
  Visuals?: UnknownProperties[];
}

/** @see https://docs.aws.amazon.com/quicksight/latest/APIReference/API_TooltipSheetDefinition.html */
export interface TooltipSheetDefinition extends UnknownProperties {
  SheetId: string;
  Images?: UnknownProperties[];
  Layouts?: UnknownProperties[];
  Name?: string;
  TextBoxes?: UnknownProperties[];
  Visuals?: UnknownProperties[];
}

/** @see https://docs.aws.amazon.com/quicksight/latest/APIReference/API_AnalysisDefaults.html */
export interface AnalysisDefaults extends UnknownProperties {
  DefaultNewSheetConfiguration: DefaultNewSheetConfiguration;
}

/** @see https://docs.aws.amazon.com/quicksight/latest/APIReference/API_DefaultNewSheetConfiguration.html */
export interface DefaultNewSheetConfiguration extends UnknownProperties {
  InteractiveLayoutConfiguration?: UnknownProperties;
  PaginatedLayoutConfiguration?: UnknownProperties;
  SheetContentType?: 'PAGINATED' | 'INTERACTIVE';
}

/** @see https://docs.aws.amazon.com/quicksight/latest/APIReference/API_AssetOptions.html */
export interface AssetOptions extends UnknownProperties {
  CustomActionDefaults?: UnknownProperties;
  ExcludedDataSetArns?: string[];
  QBusinessInsightsStatus?: 'ENABLED' | 'DISABLED';
  Timezone?: string;
  VisualMessages?: UnknownProperties;
  WeekStart?: 'SUNDAY' | 'MONDAY' | 'TUESDAY' | 'WEDNESDAY' | 'THURSDAY' | 'FRIDAY' | 'SATURDAY';
}

/** @see https://docs.aws.amazon.com/quicksight/latest/APIReference/API_QueryExecutionOptions.html */
export interface QueryExecutionOptions extends UnknownProperties {
  QueryExecutionMode?: 'AUTO' | 'MANUAL';
}

/** @see https://docs.aws.amazon.com/quicksight/latest/APIReference/API_AnalysisError.html */
export interface AnalysisError extends UnknownProperties {
  Message?: string;
  Type?: 'ACCESS_DENIED' | 'SOURCE_NOT_FOUND' | 'DATA_SET_NOT_FOUND' | 'INTERNAL_FAILURE' | 'PARAMETER_VALUE_INCOMPATIBLE' | 'PARAMETER_TYPE_INVALID' | 'PARAMETER_NOT_FOUND' | 'COLUMN_TYPE_MISMATCH' | 'COLUMN_GEOGRAPHIC_ROLE_MISMATCH' | 'COLUMN_REPLACEMENT_MISSING';
  ViolatedEntities?: Entity[];
}

/** @see https://docs.aws.amazon.com/quicksight/latest/APIReference/API_DashboardError.html */
export interface DashboardError extends UnknownProperties {
  Message?: string;
  Type?: 'ACCESS_DENIED' | 'SOURCE_NOT_FOUND' | 'DATA_SET_NOT_FOUND' | 'INTERNAL_FAILURE' | 'PARAMETER_VALUE_INCOMPATIBLE' | 'PARAMETER_TYPE_INVALID' | 'PARAMETER_NOT_FOUND' | 'COLUMN_TYPE_MISMATCH' | 'COLUMN_GEOGRAPHIC_ROLE_MISMATCH' | 'COLUMN_REPLACEMENT_MISSING';
  ViolatedEntities?: Entity[];
}

/** @see https://docs.aws.amazon.com/quicksight/latest/APIReference/API_Entity.html */
export interface Entity extends UnknownProperties {
  Path?: string;
}

/** @see https://docs.aws.amazon.com/quicksight/latest/APIReference/API_ColumnIdentifier.html */
export interface ColumnIdentifier extends UnknownProperties {
  ColumnName: string;
  DataSetIdentifier?: string;
  TopicIdentifier?: string;
}

/** @see https://docs.aws.amazon.com/quicksight/latest/APIReference/API_CalculatedField.html */
export interface CalculatedField extends UnknownProperties {
  Expression: string;
  Name: string;
  DataSetIdentifier?: string;
  TopicIdentifier?: string;
}

/** Pivot-table calculated measure; placement is not enforced by this type.
 * @see https://docs.aws.amazon.com/quicksight/latest/APIReference/API_CalculatedMeasureField.html
 */
export interface CalculatedMeasureField extends UnknownProperties {
  Expression: string;
  FieldId: string;
}

/** @see https://docs.aws.amazon.com/quicksight/latest/APIReference/API_ColumnConfiguration.html */
export interface ColumnConfiguration extends UnknownProperties {
  Column: ColumnIdentifier;
  ColorsConfiguration?: UnknownProperties;
  DecalSettingsConfiguration?: UnknownProperties;
  FormatConfiguration?: UnknownProperties;
  Role?: 'DIMENSION' | 'MEASURE';
}

/** @see https://docs.aws.amazon.com/quicksight/latest/APIReference/API_DimensionField.html */
export interface DimensionField extends UnknownProperties {
  CategoricalDimensionField?: CategoricalDimensionField;
  DateDimensionField?: DateDimensionField;
  NumericalDimensionField?: NumericalDimensionField;
}

/** @see https://docs.aws.amazon.com/quicksight/latest/APIReference/API_MeasureField.html */
export interface MeasureField extends UnknownProperties {
  CalculatedMeasureField?: CalculatedMeasureField;
  CategoricalMeasureField?: CategoricalMeasureField;
  DateMeasureField?: DateMeasureField;
  NumericalMeasureField?: NumericalMeasureField;
}

/** @see https://docs.aws.amazon.com/quicksight/latest/APIReference/API_UnaggregatedField.html */
export interface UnaggregatedField extends UnknownProperties {
  Column: ColumnIdentifier;
  FieldId: string;
  FormatConfiguration?: UnknownProperties;
}

/** @see https://docs.aws.amazon.com/quicksight/latest/APIReference/API_CategoricalDimensionField.html */
export interface CategoricalDimensionField extends UnknownProperties {
  Column: ColumnIdentifier;
  FieldId: string;
  FormatConfiguration?: UnknownProperties;
  HierarchyId?: string;
}

/** @see https://docs.aws.amazon.com/quicksight/latest/APIReference/API_DateDimensionField.html */
export interface DateDimensionField extends UnknownProperties {
  Column: ColumnIdentifier;
  FieldId: string;
  DateGranularity?: 'YEAR' | 'QUARTER' | 'MONTH' | 'WEEK' | 'DAY' | 'HOUR' | 'MINUTE' | 'SECOND' | 'MILLISECOND';
  FormatConfiguration?: UnknownProperties;
  HierarchyId?: string;
}

/** @see https://docs.aws.amazon.com/quicksight/latest/APIReference/API_NumericalDimensionField.html */
export interface NumericalDimensionField extends UnknownProperties {
  Column: ColumnIdentifier;
  FieldId: string;
  FormatConfiguration?: UnknownProperties;
  HierarchyId?: string;
}

/** @see https://docs.aws.amazon.com/quicksight/latest/APIReference/API_CategoricalMeasureField.html */
export interface CategoricalMeasureField extends UnknownProperties {
  Column: ColumnIdentifier;
  FieldId: string;
  AggregationFunction?: 'COUNT' | 'DISTINCT_COUNT';
  FormatConfiguration?: UnknownProperties;
}

/** @see https://docs.aws.amazon.com/quicksight/latest/APIReference/API_DateMeasureField.html */
export interface DateMeasureField extends UnknownProperties {
  Column: ColumnIdentifier;
  FieldId: string;
  AggregationFunction?: 'COUNT' | 'DISTINCT_COUNT' | 'MIN' | 'MAX';
  FormatConfiguration?: UnknownProperties;
}

/** @see https://docs.aws.amazon.com/quicksight/latest/APIReference/API_NumericalMeasureField.html */
export interface NumericalMeasureField extends UnknownProperties {
  Column: ColumnIdentifier;
  FieldId: string;
  AggregationFunction?: NumericalAggregationFunction;
  FormatConfiguration?: UnknownProperties;
}

/** @see https://docs.aws.amazon.com/quicksight/latest/APIReference/API_AggregationFunction.html */
export type AggregationFunction = OneOf<{
  AttributeAggregationFunction: AttributeAggregationFunction;
  CategoricalAggregationFunction: 'COUNT' | 'DISTINCT_COUNT';
  DateAggregationFunction: 'COUNT' | 'DISTINCT_COUNT' | 'MIN' | 'MAX';
  NumericalAggregationFunction: NumericalAggregationFunction;
}>;

/** @see https://docs.aws.amazon.com/quicksight/latest/APIReference/API_NumericalAggregationFunction.html */
export interface NumericalAggregationFunction extends UnknownProperties {
  PercentileAggregation?: PercentileAggregation;
  SimpleNumericalAggregation?: 'SUM' | 'AVERAGE' | 'MIN' | 'MAX' | 'COUNT' | 'DISTINCT_COUNT' | 'VAR' | 'VARP' | 'STDEV' | 'STDEVP' | 'MEDIAN';
}

/** @see https://docs.aws.amazon.com/quicksight/latest/APIReference/API_AttributeAggregationFunction.html */
export interface AttributeAggregationFunction extends UnknownProperties {
  SimpleAttributeAggregation?: 'UNIQUE_VALUE';
  ValueForMultipleValues?: string;
}

/** @see https://docs.aws.amazon.com/quicksight/latest/APIReference/API_PercentileAggregation.html */
export interface PercentileAggregation extends UnknownProperties {
  PercentileValue?: number;
}

/** @see https://docs.aws.amazon.com/quicksight/latest/APIReference/API_DateTimeDefaultValues.html */
export interface DateTimeDefaultValues extends UnknownProperties {
  DynamicValue?: DynamicDefaultValue;
  RollingDate?: RollingDateConfiguration;
  StaticValues?: unknown[];
}

/** @see https://docs.aws.amazon.com/quicksight/latest/APIReference/API_DateTimeParameterDeclaration.html */
export interface DateTimeParameterDeclaration extends UnknownProperties {
  Name: string;
  DefaultValues?: DateTimeDefaultValues;
  MappedDataSetParameters?: MappedDataSetParameter[];
  TimeGranularity?: 'YEAR' | 'QUARTER' | 'MONTH' | 'WEEK' | 'DAY' | 'HOUR' | 'MINUTE' | 'SECOND' | 'MILLISECOND';
  ValueWhenUnset?: DateTimeValueWhenUnsetConfiguration;
}

/** @see https://docs.aws.amazon.com/quicksight/latest/APIReference/API_DateTimeValueWhenUnsetConfiguration.html */
export interface DateTimeValueWhenUnsetConfiguration extends UnknownProperties {
  CustomValue?: unknown;
  ValueWhenUnsetOption?: 'RECOMMENDED_VALUE' | 'NULL';
}

/** @see https://docs.aws.amazon.com/quicksight/latest/APIReference/API_DecimalDefaultValues.html */
export interface DecimalDefaultValues extends UnknownProperties {
  DynamicValue?: DynamicDefaultValue;
  StaticValues?: number[];
}

/** @see https://docs.aws.amazon.com/quicksight/latest/APIReference/API_DecimalParameterDeclaration.html */
export interface DecimalParameterDeclaration extends UnknownProperties {
  Name: string;
  ParameterValueType: 'MULTI_VALUED' | 'SINGLE_VALUED';
  DefaultValues?: DecimalDefaultValues;
  MappedDataSetParameters?: MappedDataSetParameter[];
  ValueWhenUnset?: DecimalValueWhenUnsetConfiguration;
}

/** @see https://docs.aws.amazon.com/quicksight/latest/APIReference/API_DecimalValueWhenUnsetConfiguration.html */
export interface DecimalValueWhenUnsetConfiguration extends UnknownProperties {
  CustomValue?: number;
  ValueWhenUnsetOption?: 'RECOMMENDED_VALUE' | 'NULL';
}

/** @see https://docs.aws.amazon.com/quicksight/latest/APIReference/API_DynamicDefaultValue.html */
export interface DynamicDefaultValue extends UnknownProperties {
  DefaultValueColumn: ColumnIdentifier;
  GroupNameColumn?: ColumnIdentifier;
  UserNameColumn?: ColumnIdentifier;
}

/** @see https://docs.aws.amazon.com/quicksight/latest/APIReference/API_IntegerDefaultValues.html */
export interface IntegerDefaultValues extends UnknownProperties {
  DynamicValue?: DynamicDefaultValue;
  StaticValues?: number[];
}

/** @see https://docs.aws.amazon.com/quicksight/latest/APIReference/API_IntegerParameterDeclaration.html */
export interface IntegerParameterDeclaration extends UnknownProperties {
  Name: string;
  ParameterValueType: 'MULTI_VALUED' | 'SINGLE_VALUED';
  DefaultValues?: IntegerDefaultValues;
  MappedDataSetParameters?: MappedDataSetParameter[];
  ValueWhenUnset?: IntegerValueWhenUnsetConfiguration;
}

/** @see https://docs.aws.amazon.com/quicksight/latest/APIReference/API_IntegerValueWhenUnsetConfiguration.html */
export type IntegerValueWhenUnsetConfiguration = OneOf<{
  CustomValue: number;
  ValueWhenUnsetOption: 'RECOMMENDED_VALUE' | 'NULL';
}>;

/** @see https://docs.aws.amazon.com/quicksight/latest/APIReference/API_MappedDataSetParameter.html */
export interface MappedDataSetParameter extends UnknownProperties {
  DataSetIdentifier: string;
  DataSetParameterName: string;
}

/** @see https://docs.aws.amazon.com/quicksight/latest/APIReference/API_ParameterDeclaration.html */
export type ParameterDeclaration = OneOf<{
  DateTimeParameterDeclaration: DateTimeParameterDeclaration;
  DecimalParameterDeclaration: DecimalParameterDeclaration;
  IntegerParameterDeclaration: IntegerParameterDeclaration;
  StringParameterDeclaration: StringParameterDeclaration;
}>;

/** @see https://docs.aws.amazon.com/quicksight/latest/APIReference/API_RollingDateConfiguration.html */
export interface RollingDateConfiguration extends UnknownProperties {
  Expression: string;
  DataSetIdentifier?: string;
}

/** @see https://docs.aws.amazon.com/quicksight/latest/APIReference/API_StringDefaultValues.html */
export interface StringDefaultValues extends UnknownProperties {
  DynamicValue?: DynamicDefaultValue;
  StaticValues?: string[];
}

/** @see https://docs.aws.amazon.com/quicksight/latest/APIReference/API_StringParameterDeclaration.html */
export interface StringParameterDeclaration extends UnknownProperties {
  Name: string;
  ParameterValueType: 'MULTI_VALUED' | 'SINGLE_VALUED';
  DefaultValues?: StringDefaultValues;
  MappedDataSetParameters?: MappedDataSetParameter[];
  ValueWhenUnset?: StringValueWhenUnsetConfiguration;
}

/** @see https://docs.aws.amazon.com/quicksight/latest/APIReference/API_StringValueWhenUnsetConfiguration.html */
export interface StringValueWhenUnsetConfiguration extends UnknownProperties {
  CustomValue?: string;
  ValueWhenUnsetOption?: 'RECOMMENDED_VALUE' | 'NULL';
}

/** @see https://docs.aws.amazon.com/quicksight/latest/APIReference/API_BarChartAggregatedFieldWells.html */
export interface BarChartAggregatedFieldWells extends UnknownProperties {
  Category?: DimensionField[];
  Colors?: DimensionField[];
  SmallMultiples?: DimensionField[];
  Values?: MeasureField[];
}

/** @see https://docs.aws.amazon.com/quicksight/latest/APIReference/API_BarChartFieldWells.html */
export type BarChartFieldWells = OneOf<{
  BarChartAggregatedFieldWells: BarChartAggregatedFieldWells;
}>;

/** @see https://docs.aws.amazon.com/quicksight/latest/APIReference/API_BoxPlotAggregatedFieldWells.html */
export interface BoxPlotAggregatedFieldWells extends UnknownProperties {
  GroupBy?: DimensionField[];
  Values?: MeasureField[];
}

/** @see https://docs.aws.amazon.com/quicksight/latest/APIReference/API_BoxPlotFieldWells.html */
export type BoxPlotFieldWells = OneOf<{
  BoxPlotAggregatedFieldWells: BoxPlotAggregatedFieldWells;
}>;

/** @see https://docs.aws.amazon.com/quicksight/latest/APIReference/API_ComboChartAggregatedFieldWells.html */
export interface ComboChartAggregatedFieldWells extends UnknownProperties {
  BarValues?: MeasureField[];
  Category?: DimensionField[];
  Colors?: DimensionField[];
  LineValues?: MeasureField[];
}

/** @see https://docs.aws.amazon.com/quicksight/latest/APIReference/API_ComboChartFieldWells.html */
export type ComboChartFieldWells = OneOf<{
  ComboChartAggregatedFieldWells: ComboChartAggregatedFieldWells;
}>;

/** @see https://docs.aws.amazon.com/quicksight/latest/APIReference/API_FilledMapAggregatedFieldWells.html */
export interface FilledMapAggregatedFieldWells extends UnknownProperties {
  Geospatial?: DimensionField[];
  Values?: MeasureField[];
}

/** @see https://docs.aws.amazon.com/quicksight/latest/APIReference/API_FilledMapFieldWells.html */
export type FilledMapFieldWells = OneOf<{
  FilledMapAggregatedFieldWells: FilledMapAggregatedFieldWells;
}>;

/** @see https://docs.aws.amazon.com/quicksight/latest/APIReference/API_FunnelChartAggregatedFieldWells.html */
export interface FunnelChartAggregatedFieldWells extends UnknownProperties {
  Category?: DimensionField[];
  Values?: MeasureField[];
}

/** @see https://docs.aws.amazon.com/quicksight/latest/APIReference/API_FunnelChartFieldWells.html */
export type FunnelChartFieldWells = OneOf<{
  FunnelChartAggregatedFieldWells: FunnelChartAggregatedFieldWells;
}>;

/** @see https://docs.aws.amazon.com/quicksight/latest/APIReference/API_GaugeChartFieldWells.html */
export interface GaugeChartFieldWells extends UnknownProperties {
  TargetValues?: MeasureField[];
  Values?: MeasureField[];
}

/** @see https://docs.aws.amazon.com/quicksight/latest/APIReference/API_GeospatialMapAggregatedFieldWells.html */
export interface GeospatialMapAggregatedFieldWells extends UnknownProperties {
  Colors?: DimensionField[];
  Geospatial?: DimensionField[];
  Values?: MeasureField[];
}

/** @see https://docs.aws.amazon.com/quicksight/latest/APIReference/API_GeospatialMapFieldWells.html */
export type GeospatialMapFieldWells = OneOf<{
  GeospatialMapAggregatedFieldWells: GeospatialMapAggregatedFieldWells;
}>;

/** @see https://docs.aws.amazon.com/quicksight/latest/APIReference/API_HeatMapAggregatedFieldWells.html */
export interface HeatMapAggregatedFieldWells extends UnknownProperties {
  Columns?: DimensionField[];
  Rows?: DimensionField[];
  Values?: MeasureField[];
}

/** @see https://docs.aws.amazon.com/quicksight/latest/APIReference/API_HeatMapFieldWells.html */
export type HeatMapFieldWells = OneOf<{
  HeatMapAggregatedFieldWells: HeatMapAggregatedFieldWells;
}>;

/** @see https://docs.aws.amazon.com/quicksight/latest/APIReference/API_HistogramAggregatedFieldWells.html */
export interface HistogramAggregatedFieldWells extends UnknownProperties {
  Values?: MeasureField[];
}

/** @see https://docs.aws.amazon.com/quicksight/latest/APIReference/API_HistogramFieldWells.html */
export interface HistogramFieldWells extends UnknownProperties {
  HistogramAggregatedFieldWells?: HistogramAggregatedFieldWells;
}

/** @see https://docs.aws.amazon.com/quicksight/latest/APIReference/API_KPIFieldWells.html */
export interface KPIFieldWells extends UnknownProperties {
  TargetValues?: MeasureField[];
  TrendGroups?: DimensionField[];
  Values?: MeasureField[];
}

/** @see https://docs.aws.amazon.com/quicksight/latest/APIReference/API_LineChartAggregatedFieldWells.html */
export interface LineChartAggregatedFieldWells extends UnknownProperties {
  Category?: DimensionField[];
  Colors?: DimensionField[];
  SmallMultiples?: DimensionField[];
  Values?: MeasureField[];
}

/** @see https://docs.aws.amazon.com/quicksight/latest/APIReference/API_LineChartFieldWells.html */
export interface LineChartFieldWells extends UnknownProperties {
  LineChartAggregatedFieldWells?: LineChartAggregatedFieldWells;
}

/** @see https://docs.aws.amazon.com/quicksight/latest/APIReference/API_PieChartAggregatedFieldWells.html */
export interface PieChartAggregatedFieldWells extends UnknownProperties {
  Category?: DimensionField[];
  SmallMultiples?: DimensionField[];
  Values?: MeasureField[];
}

/** @see https://docs.aws.amazon.com/quicksight/latest/APIReference/API_PieChartFieldWells.html */
export type PieChartFieldWells = OneOf<{
  PieChartAggregatedFieldWells: PieChartAggregatedFieldWells;
}>;

/** @see https://docs.aws.amazon.com/quicksight/latest/APIReference/API_PivotTableAggregatedFieldWells.html */
export interface PivotTableAggregatedFieldWells extends UnknownProperties {
  Columns?: DimensionField[];
  Rows?: DimensionField[];
  Values?: MeasureField[];
}

/** @see https://docs.aws.amazon.com/quicksight/latest/APIReference/API_PivotTableFieldWells.html */
export type PivotTableFieldWells = OneOf<{
  PivotTableAggregatedFieldWells: PivotTableAggregatedFieldWells;
}>;

/** @see https://docs.aws.amazon.com/quicksight/latest/APIReference/API_PluginVisualFieldWell.html */
export interface PluginVisualFieldWell extends UnknownProperties {
  AxisName?: 'GROUP_BY' | 'VALUE';
  Dimensions?: DimensionField[];
  Measures?: MeasureField[];
  Unaggregated?: UnaggregatedField[];
}

/** @see https://docs.aws.amazon.com/quicksight/latest/APIReference/API_RadarChartAggregatedFieldWells.html */
export interface RadarChartAggregatedFieldWells extends UnknownProperties {
  Category?: DimensionField[];
  Color?: DimensionField[];
  Values?: MeasureField[];
}

/** @see https://docs.aws.amazon.com/quicksight/latest/APIReference/API_RadarChartFieldWells.html */
export interface RadarChartFieldWells extends UnknownProperties {
  RadarChartAggregatedFieldWells?: RadarChartAggregatedFieldWells;
}

/** @see https://docs.aws.amazon.com/quicksight/latest/APIReference/API_SankeyDiagramAggregatedFieldWells.html */
export interface SankeyDiagramAggregatedFieldWells extends UnknownProperties {
  Destination?: DimensionField[];
  Source?: DimensionField[];
  Weight?: MeasureField[];
}

/** @see https://docs.aws.amazon.com/quicksight/latest/APIReference/API_SankeyDiagramFieldWells.html */
export interface SankeyDiagramFieldWells extends UnknownProperties {
  SankeyDiagramAggregatedFieldWells?: SankeyDiagramAggregatedFieldWells;
}

/** @see https://docs.aws.amazon.com/quicksight/latest/APIReference/API_ScatterPlotCategoricallyAggregatedFieldWells.html */
export interface ScatterPlotCategoricallyAggregatedFieldWells extends UnknownProperties {
  Category?: DimensionField[];
  Label?: DimensionField[];
  Size?: MeasureField[];
  XAxis?: MeasureField[];
  YAxis?: MeasureField[];
}

/** @see https://docs.aws.amazon.com/quicksight/latest/APIReference/API_ScatterPlotFieldWells.html */
export type ScatterPlotFieldWells = OneOf<{
  ScatterPlotCategoricallyAggregatedFieldWells: ScatterPlotCategoricallyAggregatedFieldWells;
  ScatterPlotUnaggregatedFieldWells: ScatterPlotUnaggregatedFieldWells;
}>;

/** @see https://docs.aws.amazon.com/quicksight/latest/APIReference/API_ScatterPlotUnaggregatedFieldWells.html */
export interface ScatterPlotUnaggregatedFieldWells extends UnknownProperties {
  Category?: DimensionField[];
  Label?: DimensionField[];
  Size?: MeasureField[];
  XAxis?: DimensionField[];
  YAxis?: DimensionField[];
}

/** @see https://docs.aws.amazon.com/quicksight/latest/APIReference/API_TableAggregatedFieldWells.html */
export interface TableAggregatedFieldWells extends UnknownProperties {
  GroupBy?: DimensionField[];
  Values?: MeasureField[];
}

/** @see https://docs.aws.amazon.com/quicksight/latest/APIReference/API_TableFieldWells.html */
export type TableFieldWells = OneOf<{
  TableAggregatedFieldWells: TableAggregatedFieldWells;
  TableUnaggregatedFieldWells: TableUnaggregatedFieldWells;
}>;

/** @see https://docs.aws.amazon.com/quicksight/latest/APIReference/API_TableUnaggregatedFieldWells.html */
export interface TableUnaggregatedFieldWells extends UnknownProperties {
  Values?: UnaggregatedField[];
}

/** @see https://docs.aws.amazon.com/quicksight/latest/APIReference/API_TreeMapAggregatedFieldWells.html */
export interface TreeMapAggregatedFieldWells extends UnknownProperties {
  Colors?: MeasureField[];
  Groups?: DimensionField[];
  Sizes?: MeasureField[];
}

/** @see https://docs.aws.amazon.com/quicksight/latest/APIReference/API_TreeMapFieldWells.html */
export type TreeMapFieldWells = OneOf<{
  TreeMapAggregatedFieldWells: TreeMapAggregatedFieldWells;
}>;

/** @see https://docs.aws.amazon.com/quicksight/latest/APIReference/API_WaterfallChartAggregatedFieldWells.html */
export interface WaterfallChartAggregatedFieldWells extends UnknownProperties {
  Breakdowns?: DimensionField[];
  Categories?: DimensionField[];
  Values?: MeasureField[];
}

/** @see https://docs.aws.amazon.com/quicksight/latest/APIReference/API_WaterfallChartFieldWells.html */
export interface WaterfallChartFieldWells extends UnknownProperties {
  WaterfallChartAggregatedFieldWells?: WaterfallChartAggregatedFieldWells;
}

/** @see https://docs.aws.amazon.com/quicksight/latest/APIReference/API_WordCloudAggregatedFieldWells.html */
export interface WordCloudAggregatedFieldWells extends UnknownProperties {
  GroupBy?: DimensionField[];
  Size?: MeasureField[];
}

/** @see https://docs.aws.amazon.com/quicksight/latest/APIReference/API_WordCloudFieldWells.html */
export type WordCloudFieldWells = OneOf<{
  WordCloudAggregatedFieldWells: WordCloudAggregatedFieldWells;
}>;

/** @see https://docs.aws.amazon.com/quicksight/latest/APIReference/API_InsightVisual.html */
export interface InsightVisual extends UnknownProperties {
  VisualId: string;
  DataSetIdentifier?: string;
  InsightConfiguration?: InsightConfiguration;
  Title?: import('./types.js').VisualTitle;
  Subtitle?: import('./types.js').VisualTitle;
  Actions?: UnknownProperties[];
  TopicIdentifier?: string;
  VisualContentAltText?: string;
}
/** Native insight fields belong to computations, not chart field wells. */
export interface InsightConfiguration extends UnknownProperties {
  Computations?: Computation[];
  CustomNarrative?: CustomNarrativeOptions;
  Interactions?: UnknownProperties;
}
export interface CustomNarrativeOptions extends UnknownProperties { Narrative: string }
export interface TotalAggregationComputation extends UnknownProperties {
  ComputationId: string; Name?: string; Value?: MeasureField;
}
export interface MaximumMinimumComputation extends TotalAggregationComputation {
  Type: 'MAXIMUM' | 'MINIMUM'; Time?: DimensionField;
}
export interface TopBottomRankedComputation extends TotalAggregationComputation {
  Type: 'TOP' | 'BOTTOM'; Category?: DimensionField; ResultSize?: number;
}
export interface GrowthRateComputation extends TotalAggregationComputation {
  Time?: DimensionField; PeriodSize?: number;
}
export interface PeriodOverPeriodComputation extends TotalAggregationComputation { Time?: DimensionField }
export interface MetricComparisonComputation extends UnknownProperties {
  ComputationId: string; Name?: string; Time?: DimensionField; FromValue?: MeasureField; TargetValue?: MeasureField;
}
export interface ForecastComputation extends TotalAggregationComputation {
  Time?: DimensionField; PeriodsForward?: number; PeriodsBackward?: number;
  PredictionInterval?: number; Seasonality?: 'AUTOMATIC' | 'CUSTOM';
  CustomSeasonalityValue?: number; LowerBoundary?: number; UpperBoundary?: number;
}
/** Additional documented computation variants remain opaque and cannot execute. */
export type Computation = OneOf<{
  TotalAggregation: TotalAggregationComputation;
  MaximumMinimum: MaximumMinimumComputation;
  TopBottomRanked: TopBottomRankedComputation;
  GrowthRate: GrowthRateComputation;
  PeriodOverPeriod: PeriodOverPeriodComputation;
  MetricComparison: MetricComparisonComputation;
  Forecast: ForecastComputation;
  PeriodToDate: UnknownProperties;
  TopBottomMovers: UnknownProperties;
  UniqueValues: UnknownProperties;
}>;
