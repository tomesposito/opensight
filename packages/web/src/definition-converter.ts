import type { BundleDefinition, BundleSheet, BundleVisual } from '@opensight/bundle-parser';

type ObjectValue = Record<string, unknown>;
type Rule = readonly [target: string, children?: Schema];
interface Schema { readonly [source: string]: Rule }

export function object(value: unknown, path: string): ObjectValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${path}: expected an object`);
  return value as ObjectValue;
}
function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${path}: expected an array`);
  return value;
}
function text(value: unknown, path: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${path}: expected a nonempty string`);
  return value;
}

// Only named members in a known context are converted. Unknown subtrees and
// dictionary keys stay verbatim; never recursively lowercase arbitrary JSON.
function map(value: unknown, schema: Schema, path: string): unknown {
  if (Array.isArray(value)) return value.map((item, i) => map(item, schema, `${path}[${i}]`));
  if (!value || typeof value !== 'object') return value;
  const targets = new Set<string>();
  return Object.fromEntries(Object.entries(value).map(([key, child]) => {
    const rule = Object.hasOwn(schema, key) ? schema[key] : undefined;
    const target = rule?.[0] ?? key;
    if (targets.has(target)) throw new Error(`${path}.${key}: API-to-bundle property collision at ${target}`);
    targets.add(target);
    return [target, rule?.[1] ? map(child, rule[1], `${path}.${key}`) : child];
  }));
}

// Schema helpers list API member names explicitly; they never rewrite arbitrary
// dictionary keys, strings, expressions, enum values, or unknown subtrees.
const members = (names: string): Schema => Object.fromEntries(names.split(' ').map(name => [name, [
  name.replace(/^[A-Z]+(?=[A-Z][a-z]|$)|^[A-Z]/u, prefix => prefix.toLowerCase()),
]]));
const visibility: Schema = members('Visibility');
const font: Schema = { ...members('FontColor FontDecoration'), FontSize: ['fontSize', members('Relative Absolute')] };
const displayFormat: Schema = {
  ...members('NumberScale Prefix Suffix Symbol'),
  DecimalPlacesConfiguration: ['decimalPlacesConfiguration', members('DecimalPlaces')],
  NullValueFormatConfiguration: ['nullValueFormatConfiguration', members('NullString')],
  NegativeValueConfiguration: ['negativeValueConfiguration', members('DisplayMode')],
  SeparatorConfiguration: ['separatorConfiguration', {
    DecimalSeparator: ['decimalSeparator'], ThousandsSeparator: ['thousandsSeparator', members('Symbol Visibility')],
  }],
};
const numberFormat: Schema = {
  NumberDisplayFormatConfiguration: ['numberDisplayFormatConfiguration', displayFormat],
  CurrencyDisplayFormatConfiguration: ['currencyDisplayFormatConfiguration', displayFormat],
  PercentageDisplayFormatConfiguration: ['percentageDisplayFormatConfiguration', displayFormat],
};
const format: Schema = {
  ...members('DateTimeFormat'), ...numberFormat, FormatConfiguration: ['formatConfiguration', numberFormat],
  NullValueFormatConfiguration: ['nullValueFormatConfiguration', members('NullString')],
};
const interactions: Schema = {
  VisualMenuOption: ['visualMenuOption', members('AvailabilityStatus')],
  TextBoxMenuOption: ['textBoxMenuOption', members('AvailabilityStatus')],
};
const conditionalStyle: Schema = {
  Icon: ['icon', { CustomCondition: ['customCondition', {
    ...members('Color Expression'), IconOptions: ['iconOptions', members('Icon')],
  }] }],
  TextColor: ['textColor', {
    Solid: ['solid', members('Color Expression')],
    Gradient: ['gradient', { Expression: ['expression'], Color: ['color', { Stops: ['stops', members('Color DataValue GradientOffset')] }] }],
  }],
};
const conditionalFormatting: Schema = { ConditionalFormattingOptions: ['conditionalFormattingOptions', {
  ComparisonValue: ['comparisonValue', conditionalStyle],
  Cell: ['cell', { FieldId: ['fieldId'], TextFormat: ['textFormat', conditionalStyle] }],
}] };
const column: Schema = { DataSetIdentifier: ['dataSetIdentifier'], ColumnName: ['columnName'] };
const field: Schema = {
  FieldId: ['fieldId'], Column: ['column', column], DateGranularity: ['dateGranularity'],
  HierarchyId: ['hierarchyId'], FormatConfiguration: ['formatConfiguration', format],
  AggregationFunction: ['aggregationFunction', { SimpleNumericalAggregation: ['simpleNumericalAggregation'] }],
};
const dimension: Schema = {
  CategoricalDimensionField: ['categoricalDimensionField', field],
  DateDimensionField: ['dateDimensionField', field], NumericalDimensionField: ['numericalDimensionField', field],
};
const measure: Schema = { NumericalMeasureField: ['numericalMeasureField', field],
  CategoricalMeasureField: ['categoricalMeasureField', field], DateMeasureField: ['dateMeasureField', field],
  CalculatedMeasureField: ['calculatedMeasureField', members('FieldId Expression')] };
const wells: Schema = {
  Latitude: ['latitude', dimension], Longitude: ['longitude', dimension], Geospatial: ['geospatial', dimension], Groups: ['groups', dimension], OpenSightSample: ['opensightSample', dimension], Sizes: ['sizes', measure],
  Rows: ['rows', dimension], Columns: ['columns', dimension], Category: ['category', dimension], GroupBy: ['groupBy', dimension], Values: ['values', measure],
  Colors: ['colors', dimension], SmallMultiples: ['smallMultiples', dimension],
  TargetValues: ['targetValues', measure], TrendGroups: ['trendGroups', dimension],
  BarValues: ['barValues', measure], LineValues: ['lineValues', measure],
  XAxis: ['xAxis', measure], YAxis: ['yAxis', measure], Size: ['size', measure], Label: ['label', dimension],
};
const title: Schema = {
  Visibility: ['visibility'], FormatText: ['formatText', { PlainText: ['plainText'], RichText: ['richText'] }],
};
const limit: Schema = members('OtherCategories ItemsLimit');
const sort: Schema = { FieldSort: ['fieldSort', members('FieldId Direction')] };
const labels: Schema = members('Visibility Overlap MeasureLabelVisibility');
const axis: Schema = { ScrollbarOptions: ['scrollbarOptions', visibility] };
const border: Schema = members('Style Thickness Color');
const tableStyle: Schema = { Border: ['border', { UniformBorder: ['uniformBorder', border],
  SideSpecificBorder: ['sideSpecificBorder', { InnerHorizontal: ['innerHorizontal', border] }],
}] };
const visualBody: Schema = {
  VisualId: ['visualId'], Title: ['title', title], Subtitle: ['subtitle', title],
  Actions: ['actions', {
    ...members('CustomActionId Name Status Trigger'), ActionOperations: ['actionOperations', {
      FilterOperation: ['filterOperation', {
        SelectedFieldsConfiguration: ['selectedFieldsConfiguration', members('SelectedFieldOptions SelectedFields')],
        TargetVisualsConfiguration: ['targetVisualsConfiguration', {
          SameSheetTargetVisualConfiguration: ['sameSheetTargetVisualConfiguration', members('TargetVisualOptions TargetVisuals')],
        }],
      }],
    }],
  }],
  ConditionalFormatting: ['conditionalFormatting', conditionalFormatting],
  ColumnHierarchies: ['columnHierarchies', { DateTimeHierarchy: ['dateTimeHierarchy', members('HierarchyId DrillDownFilters')] }],
  ChartConfiguration: ['chartConfiguration', {
    FieldWells: ['fieldWells', {
      ...Object.fromEntries(['FunnelChartAggregatedFieldWells', 'TreeMapAggregatedFieldWells', 'HeatMapAggregatedFieldWells', 'BoxPlotAggregatedFieldWells', 'WordCloudAggregatedFieldWells', 'HistogramAggregatedFieldWells', 'FilledMapAggregatedFieldWells', 'GeospatialMapAggregatedFieldWells'].map(name => [name, [name[0]!.toLowerCase() + name.slice(1), wells] as Rule])),
      PieChartAggregatedFieldWells: ['pieChartAggregatedFieldWells', wells],
      BarChartAggregatedFieldWells: ['barChartAggregatedFieldWells', wells],
      LineChartAggregatedFieldWells: ['lineChartAggregatedFieldWells', wells],
      TableAggregatedFieldWells: ['tableAggregatedFieldWells', wells],
      PivotTableAggregatedFieldWells: ['pivotTableAggregatedFieldWells', wells],
      KPIFieldWells: ['kpiFieldWells', wells], ComboChartAggregatedFieldWells: ['comboChartAggregatedFieldWells', wells],
      ScatterPlotCategoricallyAggregatedFieldWells: ['scatterPlotCategoricallyAggregatedFieldWells', wells], ...wells,
    }],
    TotalOptions: ['totalOptions', { ...members('TotalsVisibility'),
      RowTotalOptions: ['rowTotalOptions', members('TotalsVisibility')], ColumnTotalOptions: ['columnTotalOptions', members('TotalsVisibility')],
      RowSubtotalOptions: ['rowSubtotalOptions', members('TotalsVisibility')], ColumnSubtotalOptions: ['columnSubtotalOptions', members('TotalsVisibility')],
    }],
    OpenSightBins: ['opensightBins'], OpenSightGauge: ['opensightGauge'],
    OpenSightSubtotalOptions: ['opensightSubtotalOptions', members('TotalsVisibility')],
    Orientation: ['orientation'], BarsArrangement: ['barsArrangement'], Type: ['type'],
    Interactions: ['interactions', interactions], CategoryAxis: ['categoryAxis', axis], XAxisDisplayOptions: ['xAxisDisplayOptions', axis],
    BarDataLabels: ['barDataLabels', labels], LineDataLabels: ['lineDataLabels', labels],
    TableInlineVisualizations: ['tableInlineVisualizations', { DataBars: ['dataBars', members('FieldId')] }],
    TableOptions: ['tableOptions', { CellStyle: ['cellStyle', tableStyle], HeaderStyle: ['headerStyle', tableStyle] }],
    KPIOptions: ['kpiOptions', {
      PrimaryValueDisplayType: ['primaryValueDisplayType'],
      PrimaryValueFontConfiguration: ['primaryValueFontConfiguration', font], SecondaryValueFontConfiguration: ['secondaryValueFontConfiguration', font],
      ProgressBar: ['progressBar', visibility], TrendArrows: ['trendArrows', visibility],
      Sparkline: ['sparkline', members('TooltipVisibility Type Visibility')],
      Comparison: ['comparison', { ComparisonMethod: ['comparisonMethod'], ComparisonFormat: ['comparisonFormat', numberFormat] }],
      VisualLayoutOptions: ['visualLayoutOptions', { StandardLayout: ['standardLayout', members('Type')] }],
    }],
    DonutOptions: ['donutOptions', { ArcOptions: ['arcOptions', { ArcThickness: ['arcThickness'] }] }],
    DataLabels: ['dataLabels', labels],
    Legend: ['legend', members('Visibility Position Width')],
    Tooltip: ['tooltip', {
      TooltipVisibility: ['tooltipVisibility'], SelectedTooltipType: ['selectedTooltipType'],
      FieldBasedTooltip: ['fieldBasedTooltip', {
        AggregationVisibility: ['aggregationVisibility'], TooltipTitleType: ['tooltipTitleType'],
        TooltipFields: ['tooltipFields', { FieldTooltipItem: ['fieldTooltipItem', { FieldId: ['fieldId'], Visibility: ['visibility'] }] }],
      }],
    }],
    SortConfiguration: ['sortConfiguration', {
      CategorySort: ['categorySort', sort], TrendGroupSort: ['trendGroupSort', sort], RowSort: ['rowSort', sort],
      CategoryItemsLimit: ['categoryItemsLimit', limit], SmallMultiplesLimitConfiguration: ['smallMultiplesLimitConfiguration', limit],
    }],
  }],
};
const canvas: Schema = {
  ScreenCanvasSizeOptions: ['screenCanvasSizeOptions', { ResizeOption: ['resizeOption'], OptimizedViewPortWidth: ['optimizedViewPortWidth'] }],
};
const grid: Schema = {
  Elements: ['elements', {
    ElementId: ['elementId'], ElementType: ['elementType'], ColumnIndex: ['columnIndex'], ColumnSpan: ['columnSpan'],
    RowIndex: ['rowIndex'], RowSpan: ['rowSpan'],
  }], CanvasSizeOptions: ['canvasSizeOptions', canvas],
};
const freeForm: Schema = {
  Elements: ['elements', {
    ...members('ElementId ElementType XAxisLocation YAxisLocation Width Height Visibility'),
    BorderStyle: ['borderStyle', members('Visibility Color')], SelectedBorderStyle: ['selectedBorderStyle', members('Visibility Color')],
    BackgroundStyle: ['backgroundStyle', members('Visibility Color')], LoadingAnimation: ['loadingAnimation', visibility],
  }], CanvasSizeOptions: ['canvasSizeOptions', canvas],
};
const parameterBody: Schema = {
  ...members('Name ParameterValueType TimeGranularity'),
  DefaultValues: ['defaultValues', {
    StaticValues: ['staticValues'], DynamicValue: ['dynamicValue', {
      ...members('DataSetIdentifier DefaultValueColumn GroupNameColumn UserNameColumn'),
    }], RollingDate: ['rollingDate', members('Expression DataSetIdentifier')],
  }],
  ValueWhenUnset: ['valueWhenUnset', members('ValueWhenUnsetOption CustomValue')],
};
const categoryConfig: Schema = members('MatchOperator NullOption ParameterName CategoryValue CategoryValues SelectAllOptions');
const rangeValue: Schema = members('Parameter StaticValue');
const filterBody: Schema = {
  ...members('FilterId NullOption IncludeMinimum IncludeMaximum TimeGranularity RelativeDateType RelativeDateValue ParameterName MinimumGranularity'),
  Column: ['column', column], RangeMinimum: ['rangeMinimum', rangeValue], RangeMaximum: ['rangeMaximum', rangeValue],
  RangeMinimumValue: ['rangeMinimumValue', rangeValue], RangeMaximumValue: ['rangeMaximumValue', rangeValue],
  AnchorDateConfiguration: ['anchorDateConfiguration', members('AnchorOption ParameterName')],
  ExcludePeriodConfiguration: ['excludePeriodConfiguration', members('Amount Granularity Status')],
  AggregationFunction: ['aggregationFunction', members('SimpleNumericalAggregation')],
  Configuration: ['configuration', {
    FilterListConfiguration: ['filterListConfiguration', categoryConfig], CustomFilterConfiguration: ['customFilterConfiguration', categoryConfig],
    CustomFilterListConfiguration: ['customFilterListConfiguration', categoryConfig],
  }],
};
const definition: Schema = {
  DataSetIdentifierDeclarations: ['dataSetIdentifierDeclarations', { Identifier: ['identifier'], DataSetArn: ['dataSetArn'] }],
  Sheets: ['sheets', {
    SheetId: ['sheetId'], Name: ['name'], ContentType: ['contentType'], ...members('Title Description'),
    TextBoxes: ['textBoxes', { ...members('SheetTextBoxId Content'), Interactions: ['interactions', interactions] }],
    ParameterControls: ['parameterControls', { DateTimePicker: ['dateTimePicker', {
      ...members('ParameterControlId SourceParameterName Title'), DisplayOptions: ['displayOptions', {
        TitleOptions: ['titleOptions', { FontConfiguration: ['fontConfiguration', font] }],
      }],
    }] }],
    Visuals: ['visuals', {
      ...Object.fromEntries(['FunnelChartVisual', 'GaugeChartVisual', 'TreeMapVisual', 'HeatMapVisual', 'BoxPlotVisual', 'WordCloudVisual', 'HistogramVisual', 'FilledMapVisual', 'GeospatialMapVisual'].map(name => [name, [name[0]!.toLowerCase() + name.slice(1), visualBody] as Rule])),
      PieChartVisual: ['pieChartVisual', visualBody], BarChartVisual: ['barChartVisual', visualBody],
      ComboChartVisual: ['comboChartVisual', visualBody], ScatterPlotVisual: ['scatterPlotVisual', visualBody],
      KPIVisual: ['kpiVisual', visualBody], LineChartVisual: ['lineChartVisual', visualBody], TableVisual: ['tableVisual', visualBody], PivotTableVisual: ['pivotTableVisual', visualBody],
    }],
    Layouts: ['layouts', { Configuration: ['configuration', { GridLayout: ['gridLayout', grid], FreeFormLayout: ['freeFormLayout', freeForm] }] }],
  }],
  CalculatedFields: ['calculatedFields', members('DataSetIdentifier Name Expression')],
  ParameterDeclarations: ['parameterDeclarations', {
    StringParameterDeclaration: ['stringParameterDeclaration', parameterBody], IntegerParameterDeclaration: ['integerParameterDeclaration', parameterBody],
    DecimalParameterDeclaration: ['decimalParameterDeclaration', parameterBody], DateTimeParameterDeclaration: ['dateTimeParameterDeclaration', parameterBody],
  }],
  FilterGroups: ['filterGroups', {
    ...members('FilterGroupId CrossDataset Status'),
    Filters: ['filters', {
      CategoryFilter: ['categoryFilter', filterBody], NumericRangeFilter: ['numericRangeFilter', filterBody],
      RelativeDatesFilter: ['relativeDatesFilter', filterBody], TimeRangeFilter: ['timeRangeFilter', filterBody],
    }],
    ScopeConfiguration: ['scopeConfiguration', {
      AllSheets: ['allSheets', {}], SelectedSheets: ['selectedSheets', {
        SheetVisualScopingConfigurations: ['sheetVisualScopingConfigurations', members('SheetId Scope VisualIds')],
      }],
    }],
  }],
  AnalysisDefaults: ['analysisDefaults', { DefaultNewSheetConfiguration: ['defaultNewSheetConfiguration', {
    InteractiveLayoutConfiguration: ['interactiveLayoutConfiguration', { Grid: ['grid', grid], FreeForm: ['freeForm', freeForm] }], SheetContentType: ['sheetContentType'],
  }] }],
  Options: ['options', {
    WeekStart: ['weekStart'], ExcludedDataSetArns: ['excludedDataSetArns'], QBusinessInsightsStatus: ['qbusinessInsightsStatus'],
    CustomActionDefaults: ['customActionDefaults', { highlightOperation: ['highlightOperation', { Trigger: ['trigger'] }] }],
  }],
  QueryExecutionOptions: ['queryExecutionOptions', { QueryExecutionMode: ['queryExecutionMode'] }],
};

function visual(value: unknown, path: string): BundleVisual {
  const entries = Object.entries(object(value, path));
  if (entries.length !== 1) throw new Error(`${path}: expected exactly one visual variant`);
  const [kind, raw] = entries[0]!;
  const body = object(raw, `${path}.${kind}`);
  // Unknown variants keep their original key/configuration, but expose identity
  // through BundleVisualBody so the UI can locate an unsupported-visual card.
  const visualId = text(body.visualId ?? body.VisualId, `${path}.${kind}.visualId`);
  return { [kind]: { ...body, visualId } };
}
function sheet(value: unknown, path: string): BundleSheet {
  const s = object(value, path);
  const result: BundleSheet = { ...s, sheetId: text(s.sheetId, `${path}.sheetId`) };
  if (s.name !== undefined) result.name = text(s.name, `${path}.name`);
  if (s.contentType !== undefined) result.contentType = text(s.contentType, `${path}.contentType`);
  if (s.visuals !== undefined) result.visuals = array(s.visuals, `${path}.visuals`).map((v, i) => visual(v, `${path}.visuals[${i}]`));
  if (s.layouts !== undefined) result.layouts = array(s.layouts, `${path}.layouts`).map((v, i) => object(v, `${path}.layouts[${i}]`));
  return result;
}

/** Provisional API projection into bundle types (also reused by synthetic fixtures), not an archive validator
 * or an execution grant. compileVisual validates every rendered field/config. */
export function convertDefinition(raw: unknown): BundleDefinition {
  object(raw, 'Definition');
  const d = object(map(raw, definition, 'Definition'), 'Definition');
  const result: BundleDefinition = {
    ...d,
    dataSetIdentifierDeclarations: array(d.dataSetIdentifierDeclarations, 'Definition.DataSetIdentifierDeclarations').map((value, i) => {
      const path = `Definition.DataSetIdentifierDeclarations[${i}]`;
      const ds = object(value, path);
      return { ...ds, identifier: text(ds.identifier, `${path}.Identifier`), dataSetArn: text(ds.dataSetArn, `${path}.DataSetArn`) };
    }),
  };
  if (d.sheets !== undefined) result.sheets = array(d.sheets, 'Definition.Sheets').map((s, i) => sheet(s, `Definition.sheets[${i}]`));
  for (const key of ['calculatedFields', 'parameterDeclarations', 'filterGroups'] as const) {
    if (d[key] !== undefined) result[key] = array(d[key], `Definition.${key}`);
  }
  for (const key of ['analysisDefaults', 'options', 'queryExecutionOptions'] as const) {
    if (d[key] !== undefined) result[key] = object(d[key], `Definition.${key}`);
  }
  return result;
}
