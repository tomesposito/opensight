import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildApiPreview } from '../build/test/api-preview.js';
import { createApiClient } from '../build/test/api-client.js';
import { convertDefinition } from '../build/test/definition-converter.js';
import { compileVisual } from '../build/test/compiler.js';

const json = async path => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));
const fixtures = await json('../src/fixtures.generated.json');
const sales = await json('../../../fixtures/renderable-sales/analysis.json');
const sample = () => ({ id: sales.AnalysisId, name: sales.Name, definition: convertDefinition(sales.Definition) });

test('mocked API through converter and preview renders all five sales visuals with exact fixture data', async () => {
  const client = createApiClient('/api', async () => Response.json(sales));
  const preview = buildApiPreview(await client.getAnalysisDefinition(sales.AnalysisId), 'analysis', fixtures);
  assert.equal(preview.sheets[0].visuals.length, 5);
  preview.sheets[0].visuals.forEach((v, i) => {
    assert.equal(v.source, 'bundle');
    assert.deepEqual(v.rows, fixtures[1].sheets[0].visuals[i].rows);
    assert.deepEqual(v.placement, fixtures[1].sheets[0].visuals[i].placement);
    assert.equal(compileVisual(v).state, 'ready');
  });
  assert.match(preview.notice, /region = East/);
  assert.match(preview.notice, /not available over HTTP/);
});
test('real API dashboard retains observed grid and unavailable data', async () => {
  const body = await json('../../api/test/fixtures/real-dashboard.response.json');
  const client = createApiClient('/api', async () => Response.json(body));
  const preview = buildApiPreview(await client.getDashboardDefinition(body.DashboardId), 'dashboard', fixtures);
  assert.deepEqual(preview.sheets[0].visuals[0].placement, fixtures[0].sheets[0].visuals[0].placement);
  assert.equal(compileVisual(preview.sheets[0].visuals[0]).state, 'unavailable');
});
test('object key ordering and response name changes do not invalidate identical fixture definitions', () => {
  const response = sample();
  response.definition = Object.fromEntries(Object.entries(response.definition).reverse());
  delete response.name;
  const preview = buildApiPreview(response, 'analysis', fixtures);
  assert.equal(preview.name, sales.AnalysisId);
  assert.equal(compileVisual(preview.sheets[0].visuals[0]).state, 'ready');
});
for (const [name, mutate] of [
  ['filter', d => { d.filterGroups[0].Filters[0].CategoryFilter.Configuration.FilterListConfiguration.CategoryValues = ['West']; }],
  ['calculation', d => { d.calculatedFields[0].Expression = '{revenue} * 0.8'; }],
  ['parameter', d => { d.parameterDeclarations = [{ StringParameterDeclaration: { Name: 'new' } }]; }],
  ['dataset', d => { d.dataSetIdentifierDeclarations[0].dataSetArn = 'different'; }],
  ['field binding', d => { d.sheets[0].visuals[0].barChartVisual.chartConfiguration.fieldWells.barChartAggregatedFieldWells.values = []; }],
  ['unknown semantic property', d => { d.FutureSemantics = true; }],
]) {
  test(`changed ${name} prevents reuse of every fixture result`, () => {
    const response = sample();
    mutate(response.definition);
    const preview = buildApiPreview(response, 'analysis', fixtures);
    assert.ok(preview.sheets[0].visuals.every(v => v.rows === null && Object.keys(v.bindings).length === 0));
    assert.match(preview.notice, /No matching reviewed fixture definition/);
  });
}
test('unknown resource and analysis/dashboard namespace mismatch never borrow sales rows', () => {
  for (const [id, kind] of [['unknown', 'analysis'], [sales.AnalysisId, 'dashboard']]) {
    const preview = buildApiPreview({ ...sample(), id }, kind, fixtures);
    assert.ok(preview.sheets[0].visuals.every(v => v.rows === null));
  }
});
test('missing, unsupported and invalid grid layouts fall back to nonoverlapping cards with notice', () => {
  for (const layouts of [undefined, [], [{ configuration: { freeFormLayout: {} } }], [{ configuration: { gridLayout: { elements: [{ elementType: 'VISUAL', elementId: 'revenue-by-region', columnSpan: -1 }] } } }]]) {
    const response = sample();
    response.definition.sheets[0].layouts = layouts;
    const preview = buildApiPreview(response, 'analysis', fixtures);
    preview.sheets[0].visuals.forEach((v, i) => assert.deepEqual(v.placement, { column: 0, columns: 36, row: i * 6, rows: 6 }));
    assert.match(preview.notice, /full-width cards/);
  }
});
test('multiple sheets are retained and duplicate identities fail with a diagnostic', () => {
  const response = sample();
  response.definition.sheets.push({ sheetId: 'second', name: 'Second', visuals: [] });
  assert.equal(buildApiPreview(response, 'analysis', fixtures).sheets.length, 2);
  response.definition.sheets[1].sheetId = 'overview';
  assert.throws(() => buildApiPreview(response, 'analysis', fixtures), /Duplicate sheet ID/);
  const duplicate = sample();
  duplicate.definition.sheets[0].visuals.push(duplicate.definition.sheets[0].visuals[0]);
  assert.throws(() => buildApiPreview(duplicate, 'analysis', fixtures), /Duplicate visual ID/);
});
