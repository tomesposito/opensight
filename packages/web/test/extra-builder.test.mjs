import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AuthorCanvas } from '../build/test/Author.js';
import { EXTRA_VISUALS } from '../build/test/visual-catalog.js';
import { activeSheet, authorReducer, emptyDraft, serializeDraft, serializeVisual, validateDraft, capabilityNote } from '../build/test/authoring.js';
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
