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

const column: Schema = { DataSetIdentifier: ['dataSetIdentifier'], ColumnName: ['columnName'] };
const field: Schema = {
  FieldId: ['fieldId'], Column: ['column', column], DateGranularity: ['dateGranularity'],
  AggregationFunction: ['aggregationFunction', { SimpleNumericalAggregation: ['simpleNumericalAggregation'] }],
};
const dimension: Schema = {
  CategoricalDimensionField: ['categoricalDimensionField', field],
  DateDimensionField: ['dateDimensionField', field], NumericalDimensionField: ['numericalDimensionField', field],
};
const measure: Schema = { NumericalMeasureField: ['numericalMeasureField', field] };
const wells: Schema = {
  Category: ['category', dimension], GroupBy: ['groupBy', dimension], Values: ['values', measure],
  Colors: ['colors', dimension], SmallMultiples: ['smallMultiples', dimension],
  TargetValues: ['targetValues', measure], TrendGroups: ['trendGroups', dimension],
};
const title: Schema = {
  Visibility: ['visibility'], FormatText: ['formatText', { PlainText: ['plainText'], RichText: ['richText'] }],
};
const limit: Schema = { OtherCategories: ['otherCategories'] };
const visualBody: Schema = {
  VisualId: ['visualId'], Title: ['title', title], Subtitle: ['subtitle', title],
  Actions: ['actions'], ColumnHierarchies: ['columnHierarchies'],
  ChartConfiguration: ['chartConfiguration', {
    FieldWells: ['fieldWells', {
      PieChartAggregatedFieldWells: ['pieChartAggregatedFieldWells', wells],
      BarChartAggregatedFieldWells: ['barChartAggregatedFieldWells', wells],
      LineChartAggregatedFieldWells: ['lineChartAggregatedFieldWells', wells],
      TableAggregatedFieldWells: ['tableAggregatedFieldWells', wells], ...wells,
    }],
    Orientation: ['orientation'], BarsArrangement: ['barsArrangement'],
    DonutOptions: ['donutOptions', { ArcOptions: ['arcOptions', { ArcThickness: ['arcThickness'] }] }],
    DataLabels: ['dataLabels', { Visibility: ['visibility'], Overlap: ['overlap'] }],
    Legend: ['legend', { Visibility: ['visibility'] }],
    Tooltip: ['tooltip', {
      TooltipVisibility: ['tooltipVisibility'], SelectedTooltipType: ['selectedTooltipType'],
      FieldBasedTooltip: ['fieldBasedTooltip', {
        AggregationVisibility: ['aggregationVisibility'], TooltipTitleType: ['tooltipTitleType'],
        TooltipFields: ['tooltipFields', { FieldTooltipItem: ['fieldTooltipItem', { FieldId: ['fieldId'], Visibility: ['visibility'] }] }],
      }],
    }],
    SortConfiguration: ['sortConfiguration', {
      CategorySort: ['categorySort', { FieldSort: ['fieldSort', { FieldId: ['fieldId'], Direction: ['direction'] }] }],
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
const definition: Schema = {
  DataSetIdentifierDeclarations: ['dataSetIdentifierDeclarations', { Identifier: ['identifier'], DataSetArn: ['dataSetArn'] }],
  Sheets: ['sheets', {
    SheetId: ['sheetId'], Name: ['name'], ContentType: ['contentType'],
    Visuals: ['visuals', {
      PieChartVisual: ['pieChartVisual', visualBody], BarChartVisual: ['barChartVisual', visualBody],
      KPIVisual: ['kpiVisual', visualBody], LineChartVisual: ['lineChartVisual', visualBody], TableVisual: ['tableVisual', visualBody],
    }],
    Layouts: ['layouts', { Configuration: ['configuration', { GridLayout: ['gridLayout', grid] }] }],
  }],
  CalculatedFields: ['calculatedFields'], ParameterDeclarations: ['parameterDeclarations'], FilterGroups: ['filterGroups'],
  AnalysisDefaults: ['analysisDefaults', { DefaultNewSheetConfiguration: ['defaultNewSheetConfiguration', {
    InteractiveLayoutConfiguration: ['interactiveLayoutConfiguration', { Grid: ['grid', grid] }], SheetContentType: ['sheetContentType'],
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

/** Browser-only projection into existing bundle types, not an archive validator
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
