import assert from 'node:assert/strict';
import test from 'node:test';
import { executeLocal, planVisual, QueryEngineError } from '@opensight/query-engine';
import { body, calculation, measure, request, selectedScope, wells } from './helpers.mjs';

const cases = [
  ['null analysis', r => { r.analysis = null; }, 'INVALID_INPUT', '$.analysis'],
  ['null calculated fields', r => { r.analysis.Definition.CalculatedFields = null; }, 'INVALID_INPUT', '.CalculatedFields'],
  ['null filter groups', r => { r.analysis.Definition.FilterGroups = null; }, 'INVALID_INPUT', '.FilterGroups'],
  ['null dimensions', r => { r.visualId = 'sales-table'; wells(r).GroupBy = null; }, 'INVALID_INPUT', '.GroupBy'],
  ['null dataset', r => { r.dataSet = null; }, 'INVALID_INPUT', '$.dataSet'],
  ['missing metadata', r => { delete r.dataSource; }, 'INVALID_INPUT', '$.dataSource'],
  ['missing local binding', r => { delete r.localData; }, 'INVALID_INPUT', '$.localData'],
  ['unresolved dataset security', r => { delete r.localData.security; }, 'SECURITY_REJECTED', '$.localData.security'],
  ['unknown security assertion', r => { r.localData.security.dataset = 'unknown'; }, 'SECURITY_REJECTED', '$.localData.security'],
  ['unresolved source policy', r => { delete r.localData.security.source; }, 'SECURITY_REJECTED', '$.localData.security'],
  ['RLS', r => { r.dataSet.DataSet.RowLevelPermissionDataSet = {}; }, 'SECURITY_REJECTED', '.RowLevelPermissionDataSet'],
  ['RLS tags', r => { r.dataSet.DataSet.RowLevelPermissionTagConfiguration = {}; }, 'SECURITY_REJECTED', '.RowLevelPermissionTagConfiguration'],
  ['CLS', r => { r.dataSet.DataSet.ColumnLevelPermissionRules = []; }, 'SECURITY_REJECTED', '.ColumnLevelPermissionRules'],
  ['unknown policy', r => { r.dataSet.DataSet.SecurityPolicy = {}; }, 'SECURITY_REJECTED', '.SecurityPolicy'],
  ['source restriction', r => { r.dataSource.DataSource.VpcConnectionProperties = {}; }, 'SECURITY_REJECTED', '.VpcConnectionProperties'],
  ['dataset transform', r => { r.dataSet.DataSet.LogicalTableMap.sales.DataTransforms = [{ FilterOperation: {} }]; }, 'UNSUPPORTED_FEATURE', '.DataTransforms'],
  ['physical custom SQL', r => { r.dataSet.DataSet.PhysicalTableMap.sales.CustomSql = {}; }, 'UNSUPPORTED_FEATURE', '.CustomSql'],
  ['join', r => { r.dataSet.DataSet.LogicalTableMap.sales.Source = { JoinInstruction: {} }; }, 'UNSUPPORTED_FEATURE', '.JoinInstruction'],
  ['multiple physical tables', r => { r.dataSet.DataSet.PhysicalTableMap.extra = {}; }, 'INVALID_INPUT', '.PhysicalTableMap'],
  ['unknown source', r => { r.dataSource.DataSource.Arn = 'missing'; }, 'UNRESOLVED_BINDING', '.Arn'],
  ['unknown physical mapping', r => { r.localData.physicalTableId = 'missing'; }, 'UNRESOLVED_BINDING', '$.localData'],
  ['unknown dataset mapping', r => { r.analysis.Definition.DataSetIdentifierDeclarations[0].DataSetArn = 'missing'; }, 'UNRESOLVED_BINDING', '.DataSetArn'],
  ['unknown logical source', r => { r.dataSet.DataSet.LogicalTableMap.sales.Source.PhysicalTableId = 'missing'; }, 'UNRESOLVED_BINDING', '.PhysicalTableId'],
  ['schema mismatch', r => { r.dataSet.DataSet.OutputColumns.pop(); }, 'UNSUPPORTED_FEATURE', '.OutputColumns'],
  ['unknown column type', r => { r.dataSet.DataSet.OutputColumns[0].Type = 'BOOLEAN'; }, 'UNSUPPORTED_FEATURE', '.Type'],
  ['duplicate columns', r => { r.dataSet.DataSet.OutputColumns.push(r.dataSet.DataSet.OutputColumns[0]); }, 'INVALID_INPUT', '.Name'],
  ['unknown dataset property', r => { r.dataSet.DataSet.FutureTransform = {}; }, 'UNSUPPORTED_FEATURE', '.FutureTransform'],
  ['unknown analysis property', r => { r.analysis.Definition.FutureFilter = {}; }, 'UNSUPPORTED_FEATURE', '.FutureFilter'],
  ['parameters', r => { r.analysis.Definition.ParameterDeclarations = [{}]; }, 'UNSUPPORTED_FEATURE', '.ParameterDeclarations'],
  ['controls', r => { r.analysis.Definition.Sheets[0].FilterControls = [{}]; }, 'UNSUPPORTED_FEATURE', '.FilterControls'],
  ['missing visual', r => { r.visualId = 'missing'; }, 'UNRESOLVED_BINDING', '$.visualId'],
  ['duplicate visual ID', r => { r.analysis.Definition.Sheets[0].Visuals.push(r.analysis.Definition.Sheets[0].Visuals[0]); }, 'INVALID_INPUT', '.VisualId'],
  ['ambiguous visual', r => { r.analysis.Definition.Sheets[0].Visuals[3].BarChartVisual = {}; }, 'INVALID_INPUT', '.Visuals[3]'],
  ['unknown visual', r => { r.analysis.Definition.Sheets[0].Visuals[3] = { PivotTableVisual: body(r) }; }, 'UNSUPPORTED_FEATURE', '.PivotTableVisual'],
  ['missing field wells', r => { delete body(r).ChartConfiguration.FieldWells; }, 'INVALID_INPUT', '.FieldWells'],
  ['sorting', r => { body(r).ChartConfiguration.SortConfiguration = {}; }, 'UNSUPPORTED_FEATURE', '.SortConfiguration'],
  ['actions', r => { body(r).Actions = [{}]; }, 'UNSUPPORTED_FEATURE', '.Actions'],
  ['empty measures', r => { wells(r).Values = []; }, 'INVALID_INPUT', '.Values'],
  ['null measure', r => { wells(r).Values = [null]; }, 'INVALID_INPUT', '.Values[0]'],
  ['multiple field variants', r => { wells(r).Values[0].CategoricalMeasureField = {}; }, 'INVALID_INPUT', '.Values[0]'],
  ['unknown column', r => { wells(r).Values = [measure('missing')]; }, 'UNRESOLVED_BINDING', '.ColumnName'],
  ['non-numeric measure', r => { wells(r).Values = [measure('region')]; }, 'TYPE_MISMATCH', '.NumericalMeasureField'],
  ['cross-dataset measure', r => { wells(r).Values[0].NumericalMeasureField.Column.DataSetIdentifier = 'other'; }, 'UNRESOLVED_BINDING', '.DataSetIdentifier'],
  ['implicit aggregation', r => { delete wells(r).Values[0].NumericalMeasureField.AggregationFunction; }, 'INVALID_INPUT', '.AggregationFunction'],
  ['unsupported aggregate', r => { wells(r).Values = [measure('revenue', 'MEDIAN')]; }, 'UNSUPPORTED_FEATURE', '.AggregationFunction'],
  ['ambiguous aggregate', r => { wells(r).Values[0].NumericalMeasureField.AggregationFunction.PercentileAggregation = {}; }, 'UNSUPPORTED_FEATURE', '.PercentileAggregation'],
  ['duplicate output', r => { wells(r).Values.push(measure('profit', 'SUM', 'REVENUE')); }, 'INVALID_INPUT', '.FieldId'],
  ['wrong date granularity', r => { r.visualId = 'revenue-trend'; wells(r).Category[0].DateDimensionField.DateGranularity = 'WEEK'; }, 'UNSUPPORTED_FEATURE', '.DateGranularity'],
  ['wrong dimension type', r => { r.visualId = 'revenue-by-region'; wells(r).Category[0].CategoricalDimensionField.Column.ColumnName = 'revenue'; }, 'TYPE_MISMATCH', '.CategoricalDimensionField'],
  ['unknown filter', r => { r.analysis.Definition.FilterGroups[0].Filters = [{ NumericRangeFilter: {} }]; }, 'UNSUPPORTED_FEATURE', '.Filters[0]'],
  ['unknown filter scope', r => { r.analysis.Definition.FilterGroups[0].ScopeConfiguration = { Unknown: {} }; }, 'UNSUPPORTED_FEATURE', '.ScopeConfiguration'],
  ['missing filter status', r => { delete r.analysis.Definition.FilterGroups[0].Status; }, 'UNSUPPORTED_FEATURE', '.Status'],
  ['unresolved visual scope', r => { r.analysis.Definition.FilterGroups[0].ScopeConfiguration = selectedScope(['missing']); }, 'UNRESOLVED_BINDING', '.VisualIds[0]'],
  ['unresolved sheet scope', r => { const scope = selectedScope(['sales-table']); scope.SelectedSheets.SheetVisualScopingConfigurations[0].SheetId = 'missing'; r.analysis.Definition.FilterGroups[0].ScopeConfiguration = scope; }, 'UNRESOLVED_BINDING', '.SheetId'],
  ['ambiguous group predicate', r => { r.analysis.Definition.FilterGroups[0].Filters.push(r.analysis.Definition.FilterGroups[0].Filters[0]); }, 'UNSUPPORTED_FEATURE', '.Filters'],
  ['unknown null policy', r => { r.analysis.Definition.FilterGroups[0].Filters[0].CategoryFilter.Configuration.FilterListConfiguration.NullOption = 'ALL_VALUES'; }, 'UNSUPPORTED_FEATURE', '.NullOption'],
  ['dynamic filter', r => { r.analysis.Definition.FilterGroups[0].Filters[0].CategoryFilter.Configuration.FilterListConfiguration.ParameterName = 'region'; }, 'UNSUPPORTED_FEATURE', '.ParameterName'],
  ['numeric category filter', r => { r.analysis.Definition.FilterGroups[0].Filters[0].CategoryFilter.Column.ColumnName = 'order_id'; }, 'TYPE_MISMATCH', '.Filters[0]'],
  ['calculation missing column', r => calculation(r, '{missing} * 2'), 'UNRESOLVED_BINDING', '.Expression'],
  ['calculation type mismatch', r => calculation(r, '{region} * 2'), 'TYPE_MISMATCH', '.Expression'],
  ['calculation self-cycle', r => calculation(r, '{calculated} * 2'), 'CALCULATION_CYCLE', '.Expression'],
  ['calculation indirect cycle', r => { calculation(r, '{discounted_revenue}'); r.analysis.Definition.CalculatedFields[0].Expression = '{calculated}'; }, 'CALCULATION_CYCLE', '.Expression'],
  ['calculation duplicate name', r => calculation(r, '2', 'revenue'), 'INVALID_INPUT', '.Name'],
  ['calculation syntax', r => calculation(r, '({revenue} * 2'), 'INVALID_INPUT', '.Expression'],
  ['calculation empty reference', r => calculation(r, '{}'), 'INVALID_INPUT', '.Expression'],
  ['calculation trailing SQL', r => calculation(r, '{revenue}; DROP TABLE sales'), 'INVALID_INPUT', '.Expression'],
  ['nonfinite literal', r => calculation(r, '1e999'), 'INVALID_INPUT', '.Expression'],
  ['excessive expression nesting', r => calculation(r, '('.repeat(101) + '1' + ')'.repeat(101)), 'INVALID_INPUT', '.Expression'],
  ['table calculation', r => calculation(r, 'sumOver({revenue}, [], PRE_AGG)'), 'UNSUPPORTED_FEATURE', '.Expression'],
  ['mixed aggregation grain', r => calculation(r, '{revenue} + sum({profit})'), 'UNSUPPORTED_FEATURE', '.Expression'],
  ['remote CSV', r => { r.localData.csv = 's3://example/sales.csv'; }, 'LOCAL_DATA_ERROR', '.csv'],
  ['absolute CSV', r => { r.localData.csv = '/tmp/sales.csv'; }, 'LOCAL_DATA_ERROR', '.csv'],
  ['CSV traversal', r => { r.localData.csv = '../sales.csv'; }, 'LOCAL_DATA_ERROR', '.csv'],
  ['CSV glob', r => { r.localData.csv = '*.csv'; }, 'LOCAL_DATA_ERROR', '.csv'],
  ['unknown timezone', r => { r.localData.timezone = 'Europe/Paris'; }, 'UNSUPPORTED_FEATURE', '.timezone'],
];

for (const [name, mutate, code, pathSuffix] of cases) {
  test(`reject ${name} with a located diagnostic before opening local data`, async () => {
    const r = request();
    mutate(r);
    const check = e => e instanceof QueryEngineError && e.code === code && e.path.endsWith(pathSuffix);
    assert.throws(() => planVisual(r), check);
    await assert.rejects(executeLocal(r, { dataRoot: '/does-not-exist' }), check);
  });
}

test('malformed top-level request is a located error', () => {
  assert.throws(() => planVisual(null), { code: 'INVALID_INPUT', path: '$' });
});
