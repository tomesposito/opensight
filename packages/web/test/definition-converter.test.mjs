import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { convertDefinition } from '../build/test/definition-converter.js';
import { compileVisual, CompileError } from '../build/test/compiler.js';

const json = async path => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));
const sales = await json('../../../fixtures/renderable-sales/analysis.json');
const fixtures = await json('../src/fixtures.generated.json');
const expected = await json('./fixtures/sales.bundle.json');
const convertVisual = visual => convertDefinition({ DataSetIdentifierDeclarations: [], Sheets: [{ SheetId: 's', Visuals: [visual] }] }).sheets[0].visuals[0];

test('PascalCase sales fixture converts to the complete expected bundle projection without mutation', () => {
  const before = structuredClone(sales);
  assert.deepEqual(convertDefinition(sales.Definition), expected);
  assert.deepEqual(sales, before);
});
test('real dashboard API fixture converts back to the original observed bundle definition', async () => {
  const response = await json('../../api/test/fixtures/real-dashboard.response.json');
  assert.deepEqual(convertDefinition(response.Definition), fixtures[0].apiResource.definition);
});
for (const visual of fixtures[1].sheets[0].visuals) {
  const kind = Object.keys(visual.definition)[0];
  test(`converted ${kind} compiles to the same model, options and result cells`, () => {
    assert.deepEqual(compileVisual({ ...visual, source: 'bundle', definition: convertVisual(visual.definition) }), compileVisual(visual));
  });
}
test('converts donut, labels, legend, tooltip and category field sort without changing enum values', () => {
  const input = structuredClone(fixtures[1].sheets[0].visuals[4]);
  const config = input.definition.PieChartVisual.ChartConfiguration;
  Object.assign(config, {
    DonutOptions: { ArcOptions: { ArcThickness: 'MEDIUM' } },
    Legend: { Visibility: 'HIDDEN' }, DataLabels: { Visibility: 'HIDDEN', Overlap: 'DISABLE_OVERLAP' },
    Tooltip: { TooltipVisibility: 'HIDDEN' },
    SortConfiguration: { CategorySort: [{ FieldSort: { FieldId: 'revenue', Direction: 'DESC' } }] },
  });
  const converted = convertVisual(input.definition);
  assert.deepEqual(converted.pieChartVisual.chartConfiguration.donutOptions, { arcOptions: { arcThickness: 'MEDIUM' } });
  const result = compileVisual({ ...input, source: 'bundle', definition: converted });
  assert.deepEqual(result.option.series[0].radius, ['42%', '70%']);
  assert.deepEqual(result.option.series[0].data, [{ name: 'Software', value: 300 }, { name: 'Hardware', value: 200 }]);
  assert.equal(result.model.legend, false);
  assert.equal(result.model.tooltip, false);
  assert.equal(result.model.labels, false);
});
test('converts horizontal stacked bars and numerical dimension fields', () => {
  const input = structuredClone(fixtures[1].sheets[0].visuals[0]);
  const config = input.definition.BarChartVisual.ChartConfiguration;
  Object.assign(config, { Orientation: 'HORIZONTAL', BarsArrangement: 'STACKED' });
  const category = config.FieldWells.BarChartAggregatedFieldWells.Category[0];
  category.NumericalDimensionField = category.CategoricalDimensionField;
  delete category.CategoricalDimensionField;
  const converted = convertVisual(input.definition);
  assert.equal(converted.barChartVisual.chartConfiguration.orientation, 'HORIZONTAL');
  assert.deepEqual(compileVisual({ ...input, source: 'bundle', definition: converted }), compileVisual(input));
});
test('preserves absent optional fields and empty arrays, multiple sheets and opaque semantic items', () => {
  assert.deepEqual(convertDefinition({ DataSetIdentifierDeclarations: [] }), { dataSetIdentifierDeclarations: [] });
  const semantic = { Map: { PascalKey: 1, __literal: true }, Expression: 'SUM({PascalColumn})' };
  assert.deepEqual(convertDefinition({ DataSetIdentifierDeclarations: [], Sheets: [{ SheetId: 'a' }, { SheetId: 'b', Visuals: [] }], FilterGroups: [semantic], ParameterDeclarations: [], CalculatedFields: [] }), {
    dataSetIdentifierDeclarations: [], sheets: [{ sheetId: 'a' }, { sheetId: 'b', visuals: [] }], filterGroups: [semantic], parameterDeclarations: [], calculatedFields: [],
  });
});
test('unknown visual/configuration stays visible to compiler rejection rather than disappearing', () => {
  const future = { HeatMapVisual: { VisualId: 'heat', ChartConfiguration: { FutureMap: { PascalKey: 1 } } } };
  const converted = convertVisual(future);
  assert.deepEqual(converted, { HeatMapVisual: { ...future.HeatMapVisual, visualId: 'heat' } });
  assert.throws(() => compileVisual({ source: 'bundle', definition: converted, rows: null, bindings: {}, path: '$' }), CompileError);
  const input = structuredClone(fixtures[1].sheets[0].visuals[0]);
  input.definition.BarChartVisual.ChartConfiguration.ReferenceLines = [{ KeyMap: { PascalKey: 1 } }];
  const definition = convertVisual(input.definition);
  assert.deepEqual(definition.barChartVisual.chartConfiguration.ReferenceLines, [{ KeyMap: { PascalKey: 1 } }]);
  assert.throws(() => compileVisual({ ...input, source: 'bundle', definition }), /ReferenceLines: unsupported property/);
});
test('nonempty unsupported field wells, calculations and actions still fail after conversion', () => {
  for (const change of [
    body => { body.ChartConfiguration.FieldWells.BarChartAggregatedFieldWells.Colors = [{}]; },
    body => { body.ChartConfiguration.FieldWells.BarChartAggregatedFieldWells.Values = [{ CalculatedMeasureField: { FieldId: 'x', Expression: 'sum({revenue})' } }]; },
    body => { body.Actions = [{ CustomActionId: 'click' }]; },
  ]) {
    const input = structuredClone(fixtures[1].sheets[0].visuals[0]);
    change(input.definition.BarChartVisual);
    assert.throws(() => compileVisual({ ...input, source: 'bundle', definition: convertVisual(input.definition) }), CompileError);
  }
});
test('rejects casing collisions and preserves unknown dictionary/prototype keys', () => {
  assert.throws(() => convertDefinition({ DataSetIdentifierDeclarations: [], dataSetIdentifierDeclarations: [] }), /collision/);
  assert.throws(() => convertVisual({ KPIVisual: { VisualId: 'x', visualId: 'y' } }), /collision/);
  const input = JSON.parse('{"DataSetIdentifierDeclarations":[],"__proto__":{"PascalKey":1},"FutureMap":{"KPIVisual":2}}');
  const result = convertDefinition(input);
  assert.equal(Object.getPrototypeOf(result), Object.prototype);
  assert.deepEqual(result.__proto__, { PascalKey: 1 });
  assert.deepEqual(result.FutureMap, { KPIVisual: 2 });
});
test('rejects malformed definition, dataset, sheet and visual envelopes with context', () => {
  for (const input of [null, [], {}, { DataSetIdentifierDeclarations: [{}] }, { DataSetIdentifierDeclarations: [], Sheets: {} }, { DataSetIdentifierDeclarations: [], Sheets: [{ SheetId: 'x', Visuals: [{}] }] }]) {
    assert.throws(() => convertDefinition(input), /Definition/);
  }
});

test('converts nonempty parameters, filters, scopes and calculations without rewriting expressions', () => {
  const expression = 'ifelse({MixedCaseColumn} > ${Threshold}, "Keep CAPS", 0)';
  const input = {
    DataSetIdentifierDeclarations: [],
    ParameterDeclarations: [
      { StringParameterDeclaration: { Name: 'Region', ParameterValueType: 'MULTI_VALUED', DefaultValues: { StaticValues: ['MixedCase'] } } },
      { DateTimeParameterDeclaration: { Name: 'AsOf', DefaultValues: { RollingDate: { Expression: 'addDateTime(-1, "DD", now())' } } } },
      { IntegerParameterDeclaration: { Name: 'Months', ParameterValueType: 'SINGLE_VALUED', DefaultValues: { StaticValues: [3] } } },
      { DecimalParameterDeclaration: { Name: 'Threshold', ParameterValueType: 'SINGLE_VALUED', DefaultValues: { DynamicValue: {
        DataSetIdentifier: 'Sales', DefaultValueColumn: 'Limit', UserNameColumn: 'User',
      } }, ValueWhenUnset: { CustomValue: 1.5 } } },
    ],
    CalculatedFields: [{ DataSetIdentifier: 'Sales', Name: 'Flag', Expression: expression }],
    FilterGroups: [{ FilterGroupId: 'f', CrossDataset: 'SINGLE_DATASET', ScopeConfiguration: { AllSheets: {} }, Filters: [
      { NumericRangeFilter: { FilterId: 'numeric', Column: { DataSetIdentifier: 'Sales', ColumnName: 'Revenue' }, RangeMinimum: { Parameter: 'Threshold' }, IncludeMinimum: true, NullOption: 'ALL_VALUES' } },
      { RelativeDatesFilter: { FilterId: 'date', Column: { DataSetIdentifier: 'Sales', ColumnName: 'Date' }, RelativeDateType: 'LAST', RelativeDateValue: 3, TimeGranularity: 'MONTH', NullOption: 'ALL_VALUES', AnchorDateConfiguration: { AnchorOption: 'NOW' } } },
      { CategoryFilter: { FilterId: 'region', Column: { DataSetIdentifier: 'Sales', ColumnName: 'Region' }, Configuration: { CustomFilterConfiguration: { MatchOperator: 'EQUALS', ParameterName: 'Region', NullOption: 'NON_NULLS_ONLY' } } } },
    ] }],
  };
  const before = structuredClone(input);
  const result = convertDefinition(input);
  assert.deepEqual(result.calculatedFields, [{ dataSetIdentifier: 'Sales', name: 'Flag', expression }]);
  assert.deepEqual(result.parameterDeclarations.map(p => Object.keys(p)[0]), ['stringParameterDeclaration', 'dateTimeParameterDeclaration', 'integerParameterDeclaration', 'decimalParameterDeclaration']);
  assert.deepEqual(result.parameterDeclarations[0].stringParameterDeclaration.defaultValues.staticValues, ['MixedCase']);
  assert.deepEqual(result.parameterDeclarations[3].decimalParameterDeclaration.defaultValues.dynamicValue, {
    dataSetIdentifier: 'Sales', defaultValueColumn: 'Limit', userNameColumn: 'User',
  });
  assert.deepEqual(result.filterGroups[0].scopeConfiguration, { allSheets: {} });
  const filters = result.filterGroups[0].filters;
  assert.deepEqual(filters[0].numericRangeFilter.rangeMinimum, { parameter: 'Threshold' });
  assert.deepEqual(filters[1].relativeDatesFilter.anchorDateConfiguration, { anchorOption: 'NOW' });
  assert.deepEqual(filters[2].categoryFilter.configuration.customFilterConfiguration, { matchOperator: 'EQUALS', parameterName: 'Region', nullOption: 'NON_NULLS_ONLY' });
  assert.deepEqual(input, before);
});

test('converts wrapped KPI wells, table measures and selected-sheet filter scoping', () => {
  const measure = { CategoricalMeasureField: { FieldId: 'count', Column: { DataSetIdentifier: 'Sales', ColumnName: 'Product' }, AggregationFunction: 'COUNT' } };
  const wrapped = convertVisual({ KPIVisual: { VisualId: 'kpi', ChartConfiguration: { FieldWells: { KPIFieldWells: { Values: [measure] } } } } });
  assert.deepEqual(wrapped.kpiVisual.chartConfiguration.fieldWells.kpiFieldWells.values, [{ categoricalMeasureField: {
    fieldId: 'count', column: { dataSetIdentifier: 'Sales', columnName: 'Product' }, aggregationFunction: 'COUNT',
  } }]);
  const table = convertVisual({ TableVisual: { VisualId: 'table', ChartConfiguration: { FieldWells: { TableAggregatedFieldWells: { Values: [{ CalculatedMeasureField: { FieldId: 'm', Expression: 'sum({Sales})' } }] } } } } });
  assert.equal(table.tableVisual.chartConfiguration.fieldWells.tableAggregatedFieldWells.values[0].calculatedMeasureField.expression, 'sum({Sales})');
  const result = convertDefinition({ DataSetIdentifierDeclarations: [], FilterGroups: [{ ScopeConfiguration: { SelectedSheets: {
    SheetVisualScopingConfigurations: [{ SheetId: 's', Scope: 'SELECTED_VISUALS', VisualIds: ['kpi', 'table'] }],
  } } }] });
  assert.deepEqual(result.filterGroups[0].scopeConfiguration.selectedSheets.sheetVisualScopingConfigurations, [{ sheetId: 's', scope: 'SELECTED_VISUALS', visualIds: ['kpi', 'table'] }]);
});
