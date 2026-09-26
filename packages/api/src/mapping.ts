import type { BundleAnalysis, BundleDashboard } from '@opensight/bundle-parser';

export type JsonObject = Record<string, unknown>;
export function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// Rules are context-specific: an unknown subtree is never traversed or recased.
type Rule = readonly [target: string, children?: Schema];
interface Schema { readonly [source: string]: Rule }

function mapValue(value: unknown, schema: Schema): unknown {
  if (Array.isArray(value)) return value.map(item => mapValue(item, schema));
  if (!isObject(value)) return value;
  const entries: [string, unknown][] = [];
  const targets = new Set<string>();
  for (const [key, child] of Object.entries(value)) {
    const rule = Object.hasOwn(schema, key) ? schema[key] : undefined;
    const target = rule?.[0] ?? key;
    if (targets.has(target)) throw new Error(`Archive-to-API property collision: ${target}`);
    targets.add(target);
    entries.push([target, rule?.[1] ? mapValue(child, rule[1]) : child]);
  }
  // fromEntries also preserves literal __proto__ keys as ordinary JSON data.
  return Object.fromEntries(entries);
}

const column: Schema = { dataSetIdentifier: ['DataSetIdentifier'], columnName: ['ColumnName'] };
const field: Schema = {
  fieldId: ['FieldId'], column: ['Column', column],
  aggregationFunction: ['AggregationFunction', { simpleNumericalAggregation: ['SimpleNumericalAggregation'] }],
};
const title: Schema = { visibility: ['Visibility'] };
const itemsLimit: Schema = { otherCategories: ['OtherCategories'] };
const pie: Schema = {
  visualId: ['VisualId'], title: ['Title', title], subtitle: ['Subtitle', title],
  actions: ['Actions'], columnHierarchies: ['ColumnHierarchies'],
  chartConfiguration: ['ChartConfiguration', {
    fieldWells: ['FieldWells', {
      pieChartAggregatedFieldWells: ['PieChartAggregatedFieldWells', {
        category: ['Category', { categoricalDimensionField: ['CategoricalDimensionField', field] }],
        values: ['Values', { numericalMeasureField: ['NumericalMeasureField', field] }],
      }],
    }],
    sortConfiguration: ['SortConfiguration', {
      categorySort: ['CategorySort', { fieldSort: ['FieldSort', { fieldId: ['FieldId'], direction: ['Direction'] }] }],
      categoryItemsLimit: ['CategoryItemsLimit', itemsLimit],
      smallMultiplesLimitConfiguration: ['SmallMultiplesLimitConfiguration', itemsLimit],
    }],
    donutOptions: ['DonutOptions', { arcOptions: ['ArcOptions', { arcThickness: ['ArcThickness'] }] }],
    dataLabels: ['DataLabels', { visibility: ['Visibility'], overlap: ['Overlap'] }],
    tooltip: ['Tooltip', {
      tooltipVisibility: ['TooltipVisibility'], selectedTooltipType: ['SelectedTooltipType'],
      fieldBasedTooltip: ['FieldBasedTooltip', {
        aggregationVisibility: ['AggregationVisibility'], tooltipTitleType: ['TooltipTitleType'],
        tooltipFields: ['TooltipFields', {
          fieldTooltipItem: ['FieldTooltipItem', { fieldId: ['FieldId'], visibility: ['Visibility'] }],
        }],
      }],
    }],
  }],
};
const canvas: Schema = {
  screenCanvasSizeOptions: ['ScreenCanvasSizeOptions', {
    resizeOption: ['ResizeOption'], optimizedViewPortWidth: ['OptimizedViewPortWidth'],
  }],
};
const grid: Schema = {
  elements: ['Elements', {
    elementId: ['ElementId'], elementType: ['ElementType'], columnSpan: ['ColumnSpan'], rowSpan: ['RowSpan'],
  }],
  canvasSizeOptions: ['CanvasSizeOptions', canvas],
};
const definition: Schema = {
  dataSetIdentifierDeclarations: ['DataSetIdentifierDeclarations', { identifier: ['Identifier'], dataSetArn: ['DataSetArn'] }],
  sheets: ['Sheets', {
    sheetId: ['SheetId'], name: ['Name'], contentType: ['ContentType'],
    visuals: ['Visuals', { pieChartVisual: ['PieChartVisual', pie] }],
    layouts: ['Layouts', { configuration: ['Configuration', { gridLayout: ['GridLayout', grid] }] }],
  }],
  // Only empty arrays are observed; nonempty items remain opaque.
  calculatedFields: ['CalculatedFields'], parameterDeclarations: ['ParameterDeclarations'], filterGroups: ['FilterGroups'],
  analysisDefaults: ['AnalysisDefaults', {
    defaultNewSheetConfiguration: ['DefaultNewSheetConfiguration', {
      interactiveLayoutConfiguration: ['InteractiveLayoutConfiguration', { grid: ['Grid', grid] }],
      sheetContentType: ['SheetContentType'],
    }],
  }],
  options: ['Options', {
    weekStart: ['WeekStart'], excludedDataSetArns: ['ExcludedDataSetArns'],
    qbusinessInsightsStatus: ['QBusinessInsightsStatus'],
    customActionDefaults: ['CustomActionDefaults', {
      // This API member really begins with lowercase h (see the API catalog).
      highlightOperation: ['highlightOperation', { trigger: ['Trigger'] }],
    }],
  }],
  queryExecutionOptions: ['QueryExecutionOptions', { queryExecutionMode: ['QueryExecutionMode'] }],
};
const availability: Schema = { availabilityStatus: ['AvailabilityStatus'] };
const publishOptions: Schema = {
  adHocFilteringOption: ['AdHocFilteringOption', availability],
  exportToCSVOption: ['ExportToCSVOption', availability],
  sheetControlsOption: ['SheetControlsOption', { visibilityState: ['VisibilityState'] }],
  sheetLayoutElementMaximizationOption: ['SheetLayoutElementMaximizationOption', availability],
  visualMenuOption: ['VisualMenuOption', availability],
  visualAxisSortOption: ['VisualAxisSortOption', availability],
  exportWithHiddenFieldsOption: ['ExportWithHiddenFieldsOption', availability],
  dataPointDrillUpDownOption: ['DataPointDrillUpDownOption', availability],
  dataPointMenuLabelOption: ['DataPointMenuLabelOption', availability],
  dataPointTooltipOption: ['DataPointTooltipOption', availability],
  executiveSummaryOption: ['ExecutiveSummaryOption', availability],
  dataStoriesSharingOption: ['DataStoriesSharingOption', availability],
  dataQAEnabledOption: ['DataQAEnabledOption', availability],
};

/** Adapts only observed archive fields; never asserts full API-schema validity. */
export function fromArchive(resource: BundleAnalysis | BundleDashboard): JsonObject {
  const { resourceType, ...body } = resource;
  const schema: Schema = {
    name: ['Name'], definition: ['Definition', definition],
    ...(resourceType === 'analysis'
      ? { analysisId: ['AnalysisId'] as const }
      : { dashboardId: ['DashboardId'] as const, dashboardPublishOptions: ['DashboardPublishOptions', publishOptions] as const }),
  };
  const mapped = mapValue(body, schema);
  if (!isObject(mapped)) throw new Error('Expected an archive object');
  return mapped;
}
