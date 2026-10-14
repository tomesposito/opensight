import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { interactiveRequest } from '../dist/interactive.js';
import { evaluatePlan } from '../dist/evaluate.js';
import { executeLocal, planVisual } from '../dist/index.js';
const root = new URL('../../../fixtures/renderable-sales/', import.meta.url).pathname;
const json = name => JSON.parse(readFileSync(`${root}/${name}`, 'utf8'));
const metadata = { dataSet: json('describe-data-set.response.json'), dataSource: json('describe-data-source.response.json'), localData: json('local-data.json') };
const query = () => ({ dimensions: [], measures: [{ fieldId: 'Adjusted', columnName: 'Adjusted', aggregation: 'SUM' }], calculatedFields: [{ name: 'Adjusted', expression: '{revenue} * ${Factor}' }],
  filters: [{ columnName: 'region', parameterName: 'Region' }], parameterDeclarations: [{ name: 'Region', type: 'string', multiple: true }, { name: 'Factor', type: 'number', multiple: false }], parameterBindings: { Region: ['West'], Factor: [2] } });
test('parameter filters and arithmetic compile to bound SQL and execute in DuckDB', async () => {
  const request = interactiveRequest(query(), metadata), result = await executeLocal(request, { dataRoot: root });
  assert.deepEqual(result.rows, [{ Adjusted: 800 }]);
  assert.deepEqual(result.plan.parameters, [2, 'West']);
  assert.match(result.plan.sql, /CAST\(\$1 AS DOUBLE\)/);
  const body = query(); body.parameterBindings.Region = ["West' OR TRUE --"];
  const plan = planVisual(interactiveRequest(body, metadata)); assert.doesNotMatch(plan.sql, /OR TRUE/);
  assert.deepEqual((await executeLocal(interactiveRequest(body, metadata), { dataRoot: root })).rows, [{ Adjusted: null }]);
});
test('browser fixture evaluator matches typed numeric/date parameter filters and nullable arithmetic', async () => {
  const csv = readFileSync(`${root}/sales.csv`, 'utf8').trim().split('\n').map(r => r.split(',')), names = csv.shift();
  const rows = csv.map(r => Object.fromEntries(names.map((name, i) => [name, r[i] === '' ? null : ['order_id', 'revenue', 'profit'].includes(name) ? Number(r[i]) : r[i]])));
  const body = query(); body.parameterDeclarations.push({ name: 'Minimum', type: 'number', multiple: false }, { name: 'AsOf', type: 'datetime', multiple: false });
  body.parameterBindings.Minimum = [100]; body.parameterBindings.AsOf = ['2025-04-01T00:00:00Z'];
  body.filters.push({ columnName: 'revenue', parameterName: 'Minimum', operator: 'GREATER_THAN_OR_EQUAL_TO' }, { columnName: 'order_date', parameterName: 'AsOf', operator: 'EQUALS' });
  const request = interactiveRequest(body, metadata), live = await executeLocal(request, { dataRoot: root });
  assert.deepEqual(live.rows, [{ Adjusted: 300 }]); assert.deepEqual(evaluatePlan(live.plan, rows), live.rows);
});
test('wrong parameter types, missing bindings and multi-value scalar expressions fail before execution', () => {
  for (const mutate of [b => { b.parameterBindings.Factor = ['2']; }, b => { b.parameterBindings.Region = [2]; }, b => { delete b.parameterBindings.Factor; }, b => { b.parameterBindings.extra = ['x']; }, b => { b.parameterDeclarations[1].multiple = true; }, b => { b.filters[0].columnName = 'revenue'; }]) {
    const body = query(); mutate(body); assert.throws(() => planVisual(interactiveRequest(body, metadata)), /parameter|binding|Parameter/);
  }
});

test('string and datetime references bind as typed scalar expressions without interpolation', async () => {
  const label = "West'); DROP TABLE sales; --";
  const body = { dimensions: [{ fieldId: 'Label', columnName: 'Label' }], measures: [{ fieldId: 'total', columnName: 'revenue', aggregation: 'SUM' }],
    calculatedFields: [{ name: 'Label', expression: '${LabelValue}' }, { name: 'Anchor', expression: '${AsOf}' }],
    filters: [{ columnName: 'Anchor', parameterName: 'AsOf' }],
    parameterDeclarations: [{ name: 'LabelValue', type: 'string', multiple: false }, { name: 'AsOf', type: 'datetime', multiple: false }],
    parameterBindings: { LabelValue: [label], AsOf: ['2025-01-01T00:00:00Z'] },
  };
  const result = await executeLocal(interactiveRequest(body, metadata), { dataRoot: root });
  assert.deepEqual(result.rows, [{ Label: label, total: 900 }]);
  assert.doesNotMatch(result.plan.sql, /DROP TABLE/); assert.match(result.plan.sql, /AS VARCHAR/); assert.match(result.plan.sql, /AS TIMESTAMP/);
});

test('published QuickSight parameter defaults share DuckDB and prepared evaluator semantics', async () => {
  const { queryPreparedVisual } = await import('../dist/index.js');
  const body = { dimensions: [], measures: [{ fieldId: 'scaled', columnName: 'scaled', aggregation: 'SUM' }], filters: [], calculatedFields: [{ name: 'scaled', expression: '{revenue} * ${Factor}' }], parameterDeclarations: [{ name: 'Factor', type: 'number', integer: true, multiple: false }], parameterBindings: { Factor: [3] } };
  const request = interactiveRequest(body, metadata);
  request.analysis.Definition.ParameterDeclarations = [{ IntegerParameterDeclaration: { Name: 'Factor', ParameterValueType: 'SINGLE_VALUED', DefaultValues: { StaticValues: [3] } } }];
  request.analysis.Definition.Sheets[0].ParameterControls = [{ TextField: { ParameterControlId: 'factor-control', SourceParameterName: 'Factor', Title: 'Factor' } }];
  delete request.parameterDeclarations; delete request.parameterBindings;
  const live = await executeLocal(request, { dataRoot: root });
  const csv = readFileSync(`${root}/sales.csv`, 'utf8').trim().split('\n').map(r => r.split(',')), names = csv.shift();
  const columns = metadata.dataSet.DataSet.OutputColumns.map(c => ({ name: c.Name, type: c.Type }));
  const result = queryPreparedVisual(columns, csv.length, (r, c) => { const v = csv[r][names.indexOf(columns[c].name)]; return v === '' ? null : ['INTEGER', 'DECIMAL'].includes(columns[c].type) ? Number(v) : v; }, request.analysis, request.visualId, metadata.localData.dataSetArn);
  assert.deepEqual(result.rows, live.rows); assert.deepEqual(live.plan.parameters, [3]);
  request.analysis.Definition.ParameterDeclarations[0].IntegerParameterDeclaration.DefaultValues.StaticValues = ['3; SELECT 1'];
  assert.throws(() => planVisual(request), /integer/);
});
