import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { loadSyntheticAnalysis, summarizeBundle } from '@opensight/bundle-parser';

const base = new URL('../../../fixtures/renderable-sales/', import.meta.url);
const read = (file) => readFileSync(new URL(file, base), 'utf8');
const json = (file) => JSON.parse(read(file));
const analysis = loadSyntheticAnalysis(fileURLToPath(new URL('analysis.json', base)));
const dataset = json('describe-data-set.response.json').DataSet;
const source = json('describe-data-source.response.json').DataSource;
const queries = json('expected-queries.json');
const semanticCases = json('semantic-cases.json');
const [sheet] = analysis.Definition.Sheets;
const physical = dataset.PhysicalTableMap.sales.RelationalTable;
const columns = new Map(physical.InputColumns.map((c) => [c.Name, c.Type]));
const calculations = new Map(analysis.Definition.CalculatedFields.map((c) => [c.Name, c]));

function walk(value, visit) {
  if (!value || typeof value !== 'object') return;
  visit(value);
  Object.values(value).forEach((child) => walk(child, visit));
}

test('fixture links the definition, dataset, source, physical table and CSV', () => {
  assert.equal(analysis.Definition.DataSetIdentifierDeclarations[0].DataSetArn, dataset.Arn);
  assert.equal(physical.DataSourceArn, source.Arn);
  assert.equal(source.Type, 'POSTGRESQL');
  assert.equal(dataset.LogicalTableMap.sales.Source.PhysicalTableId, 'sales');
  assert.equal(json('local-data.json').dataSetArn, dataset.Arn);
  assert.equal(json('local-data.json').physicalTableId, 'sales');
  assert.deepEqual(read(json('local-data.json').csv).trim().split('\n')[0].split(','), [...columns.keys()]);
  assert.deepEqual(dataset.OutputColumns, physical.InputColumns);
});

test('five visual types bind valid fields, SUM measures, a calculation and layout elements', () => {
  const summary = summarizeBundle(analysis);
  assert.deepEqual(summary.visuals.map((v) => v.kind), ['BarChartVisual', 'LineChartVisual', 'TableVisual', 'KPIVisual', 'PieChartVisual']);
  assert.deepEqual(queries.map((q) => q.visualId), summary.visuals.map((v) => v.visualId));
  const boundCalculations = new Set();
  for (const entry of sheet.Visuals) {
    const [body] = Object.values(entry);
    assert.ok(body.ChartConfiguration.FieldWells);
    let fieldCount = 0;
    walk(body.ChartConfiguration.FieldWells, (value) => {
      if (value.FieldId) {
        fieldCount++;
        assert.equal(value.Column.DataSetIdentifier, 'sales_data');
        assert.ok(columns.has(value.Column.ColumnName) || calculations.has(value.Column.ColumnName));
        if (calculations.has(value.Column.ColumnName)) boundCalculations.add(value.Column.ColumnName);
      }
      if (value.NumericalMeasureField) {
        assert.equal(value.NumericalMeasureField.AggregationFunction.SimpleNumericalAggregation, 'SUM');
      }
    });
    assert.ok(fieldCount > 0);
  }
  assert.deepEqual([...boundCalculations], [...calculations.keys()]);
  assert.equal(calculations.get('discounted_revenue').Expression, '{revenue} * 0.9');
  assert.equal(sheet.Visuals[1].LineChartVisual.ChartConfiguration.FieldWells.LineChartAggregatedFieldWells.Category[0].DateDimensionField.DateGranularity, 'MONTH');
  const elements = sheet.Layouts[0].Configuration.GridLayout.Elements;
  assert.deepEqual(elements.map((e) => e.ElementId), summary.visuals.map((v) => v.visualId));
  for (const element of elements) {
    assert.equal(element.ElementType, 'VISUAL');
    assert.ok(element.ColumnSpan > 0 && element.ColumnIndex + element.ColumnSpan <= 36);
    assert.ok(element.RowSpan > 0);
  }
});

test('filter scope and predicate match the reference queries; inventory parameter is actually bound', () => {
  const group = analysis.Definition.FilterGroups[0];
  assert.equal(group.Status, 'ENABLED');
  assert.equal(group.CrossDataset, 'SINGLE_DATASET');
  assert.deepEqual(group.ScopeConfiguration, { AllSheets: {} });
  const filter = group.Filters[0].CategoryFilter;
  assert.deepEqual(filter.Column, { DataSetIdentifier: 'sales_data', ColumnName: 'region' });
  assert.deepEqual(filter.Configuration.FilterListConfiguration, { MatchOperator: 'EQUALS', CategoryValues: ['East'], NullOption: 'NON_NULLS_ONLY' });
  for (const query of queries) assert.match(query.sql, /WHERE region = 'East'/);
  const smoke = JSON.parse(readFileSync(new URL('../../../fixtures/sample-sales-analysis.json', import.meta.url), 'utf8'));
  const parameter = smoke.Definition.ParameterDeclarations[0].StringParameterDeclaration;
  const smokeGroup = smoke.Definition.FilterGroups[0];
  assert.equal(smokeGroup.Filters[0].CategoryFilter.Configuration.CustomFilterConfiguration.ParameterName, parameter.Name);
  assert.deepEqual(parameter.DefaultValues.StaticValues, ['East']);
  assert.deepEqual(smokeGroup.ScopeConfiguration.SelectedSheets.SheetVisualScopingConfigurations.map((s) => s.SheetId), smoke.Definition.Sheets.map((s) => s.SheetId));
});

// Deliberately a handwritten SQL oracle. No production compiler exists yet.
function database() {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE sales (order_id INTEGER, order_date TEXT, region TEXT, category TEXT, revenue REAL, profit REAL)');
  const insert = db.prepare('INSERT INTO sales VALUES (?, ?, ?, ?, ?, ?)');
  for (const line of read('sales.csv').trim().split('\n').slice(1)) {
    const cells = line.split(',');
    assert.equal(cells.length, 6);
    insert.run(...cells.map((value, index) => value === '' ? null : [0, 4, 5].includes(index) ? Number(value) : value));
  }
  return db;
}
for (const scenario of [...queries, ...semanticCases]) {
  test(`SQL data oracle: ${scenario.visualId ?? scenario.id}`, (t) => {
    const db = database();
    t.after(() => db.close());
    const rows = db.prepare(scenario.sql).all().map((row) => ({ ...row }));
    assert.deepEqual(rows, scenario.rows);
  });
}
