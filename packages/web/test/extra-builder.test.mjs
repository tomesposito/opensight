import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AuthorCanvas } from '../build/test/Author.js';
import { EXTRA_VISUALS } from '../build/test/visual-catalog.js';
import { activeSheet, authorReducer, emptyDraft, serializeDraft, serializeVisual, validateDraft, capabilityNote, authorVisualProblem } from '../build/test/authoring.js';
import { importBundle, exportBundle } from '../build/test/bundle-authoring.js';
import { buildAuthorQuery } from '../build/test/author-query.js';
import { executeFixtureQuery } from '../build/test/fixture-query.js';
import { compileVisual } from '../build/test/compiler.js';
const add = kind => authorReducer(emptyDraft(), { type: 'add', kind });
const visual = d => activeSheet(d).visuals[0];
for (const kind of Object.keys(EXTRA_VISUALS)) test(`${kind}: gallery, wells, preview query and camelCase bundle round-trip`, () => {
  const draft = add(kind); validateDraft(draft);
  const html = renderToStaticMarkup(createElement(AuthorCanvas, { draft, dispatch() {} }));
  assert.ok(html.includes(`value="${kind}"`)); assert.ok(capabilityNote(kind).length > 20); assert.match(html, /role="note"/);
  const v = visual(draft), query = buildAuthorQuery(v); assert.ok(query);
  const raw = serializeDraft(draft), bundle = { members: [{ path: 'analysis/authored-analysis.json', resource: raw }] };
  const imported = importBundle(bundle); assert.equal(visual(imported).kind, kind);
  assert.deepEqual(visual(imported).measures, v.measures); assert.deepEqual(visual(imported).rows, v.rows); assert.deepEqual(visual(imported).columns, v.columns);
  assert.deepEqual(exportBundle(imported), bundle); assert.deepEqual(visual(imported).imported.issues, []);
  const result = executeFixtureQuery(query); assert.ok(result.rows, result.message);
  const input = { source: 'bundle', definition: serializeVisual(v, false), rows: result.rows, bindings: kind === 'area' ? { order_date: 'month' } : {}, path: '$' };
  if (kind.endsWith('Map')) assert.throws(() => compileVisual(input), /geo fields|country fields/);
  else { const c = compileVisual(input); assert.equal(c.state, 'ready'); assert.ok(c.option.series.length); }
});
test('heatmap wells assign separate dimensions; gauge rejects dimension assignment; scatter measure order is editable', () => {
  let d = add('heatmap');
  d = authorReducer(d, { type: 'assign', field: 'order_date', well: 'columns' });
  assert.deepEqual(visual(d).rows, ['region']); assert.deepEqual(visual(d).columns, ['order_date']); validateDraft(d);
  d = authorReducer(add('gauge'), { type: 'assign', field: 'region' }); assert.equal(visual(d).dimension, null);
  d = authorReducer(add('scatter'), { type: 'measure-move', index: 1, offset: -1 }); assert.deepEqual(visual(d).measures, ['profit', 'revenue']);
  const wells = serializeVisual(visual(d)).scatterPlotVisual.chartConfiguration.fieldWells.scatterPlotCategoricallyAggregatedFieldWells;
  assert.equal(wells.xAxis[0].numericalMeasureField.column.columnName, 'profit');
});
test('unsupported options on a newly supported visual remain reported and preserved', () => {
  const raw = serializeDraft(add('scatter')); raw.definition.sheets[0].visuals[0].scatterPlotVisual.chartConfiguration.futureRegression = { mode: 'unknown' };
  const bundle = { members: [{ path: 'analysis/authored-analysis.json', resource: raw }] }, draft = importBundle(bundle);
  assert.match(JSON.stringify(draft.bundle.report), /futureRegression.*retained/); assert.deepEqual(exportBundle(draft), bundle);
});

test('scatter wells cap at X, Y and size; kind changes cannot silently serialize a fourth measure', () => {
  let draft = add('scatter');
  for (const name of ['Margin', 'Cost']) draft = authorReducer(draft, { type: 'calculation-add', field: { name, expression: '{revenue} - {profit}', role: 'measure' } });
  for (const field of ['Margin', 'Cost']) draft = authorReducer(draft, { type: 'assign', field, well: 'values' });
  assert.deepEqual(visual(draft).measures, ['revenue', 'profit', 'Margin']);
  draft = authorReducer(draft, { type: 'kind', kind: 'bar' });
  draft = authorReducer(draft, { type: 'assign', field: 'Cost', well: 'values' });
  assert.equal(visual(draft).measures.length, 4);
  draft = authorReducer(draft, { type: 'kind', kind: 'scatter' });
  assert.equal(visual(draft).measures.length, 3);
  validateDraft(draft);
});

test('radar exposes Category, optional Color, and Values with independent preview series', () => {
  let draft = add('radar');
  const html = renderToStaticMarkup(createElement(AuthorCanvas, { draft, dispatch() {} }));
  for (const label of ['Category', 'Color', 'Values']) assert.ok(html.includes(`aria-label="Assign ${label}"`));
  assert.match(html, /Optional color dimension/); assert.ok(html.includes(capabilityNote('radar')));
  assert.match(html, /Show legend/);
  for (const [field, well] of [['category', 'rows'], ['region', 'columns'], ['profit', 'values']]) draft = authorReducer(draft, { type: 'assign', field, well });
  validateDraft(draft);
  assert.deepEqual(visual(draft).rows, ['category']); assert.deepEqual(visual(draft).columns, ['region']);
  const query = buildAuthorQuery(visual(draft));
  assert.deepEqual(query.dimensions.map(d => d.columnName), ['category', 'region']);
  assert.deepEqual(query.measures.map(m => m.columnName), ['revenue', 'profit']);
  const result = executeFixtureQuery(query); assert.ok(result.rows, result.message);
  const definition = serializeVisual(visual(draft));
  const c = compileVisual({ definition, rows: result.rows, bindings: {}, source: 'bundle', path: '$' });
  assert.equal(c.option.series.length, new Set(result.rows.map(r => r.region)).size * 2);
  const bundle = { members: [{ path: 'analysis/authored-analysis.json', resource: serializeDraft(draft) }] };
  const imported = importBundle(bundle);
  assert.deepEqual(visual(imported).columns, ['region']); assert.deepEqual(visual(imported).imported.issues, []);
  assert.deepEqual(exportBundle(imported), bundle);
  draft = authorReducer(draft, { type: 'unassign', field: 'region', well: 'columns' });
  assert.deepEqual(visual(draft).columns, []); validateDraft(draft);
});

test('radar well replacements and type changes cap Category and Color at one dimension', () => {
  let draft = add('radar');
  for (const field of ['category', 'order_date']) draft = authorReducer(draft, { type: 'assign', field, well: 'columns' });
  assert.deepEqual(visual(draft).columns, ['order_date']);
  draft = authorReducer(draft, { type: 'assign', field: 'category', well: 'rows' });
  assert.deepEqual(visual(draft).rows, ['category']); validateDraft(draft);
  draft = authorReducer(draft, { type: 'kind', kind: 'pivot' });
  draft = authorReducer(draft, { type: 'assign', field: 'region', well: 'rows' });
  assert.equal(visual(draft).rows.length, 2);
  draft = authorReducer(draft, { type: 'kind', kind: 'radar' });
  assert.deepEqual(visual(draft).rows, ['category']); validateDraft(draft);
  visual(draft).rows.push('region');
  assert.throws(() => validateDraft(draft), /Invalid or unsupported/);
});

test('radar import reports unsupported native options and invalid wells, blocks queries, preserves originals', () => {
  for (const change of [
    c => { c.shape = 'CIRCLE'; },
    c => { c.axesRangeScale = 'SHARED'; },
    c => { c.startAngle = 90; },
    c => { c.colorAxis = {}; },
    c => { c.sortConfiguration = { colorSort: [] }; },
    c => { c.tooltip = { selectedTooltipType: 'DETAILED' }; },
    c => { c.fieldWells.radarChartAggregatedFieldWells.category = []; },
    c => { c.fieldWells.radarChartAggregatedFieldWells.values = []; },
  ]) {
    const resource = serializeDraft(add('radar'));
    change(resource.definition.sheets[0].visuals[0].radarChartVisual.chartConfiguration);
    const bundle = { members: [{ path: 'analysis/authored-analysis.json', resource }] }, imported = importBundle(bundle);
    assert.match(JSON.stringify(imported.bundle.report), /CompileError.*unsupported property|CompileError.*RADAR_/);
    assert.match(authorVisualProblem(visual(imported)), /Unsupported features/);
    assert.equal(buildAuthorQuery(visual(imported)), null);
    assert.deepEqual(exportBundle(imported), bundle);
  }
});
