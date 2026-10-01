import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AuthorCanvas } from '../build/test/Author.js';
import { DataSources } from '../build/test/DataSources.js';
import { activeSheet, emptyDraft, authorReducer, dataFields, validateDraft, serializeDraft, saveDraft, loadDraft } from '../build/test/authoring.js';
import { buildAuthorQuery, buildDistinctQuery, loadAuthorRows } from '../build/test/author-query.js';
import { buildAuthorVisual } from '../build/test/author-preview.js';
import { compileVisual } from '../build/test/compiler.js';
import { allowed } from '../build/test/access.js';
const dataset = { id: 'prepared-csv', name: 'Uploaded CSV', columns: [{ name: 'team', type: 'STRING' }, { name: 'amount', type: 'INTEGER' }, { name: 'day', type: 'DATETIME' }] };
const draft = kind => authorReducer({ ...emptyDraft(), dataset }, { type: 'add', kind });
test('uploaded schema replaces sales defaults, drives field assignments, calculations and category filters', () => {
  let d = draft('bar');
  assert.deepEqual(dataFields([], dataset).map(f => f.name), ['team', 'amount', 'day']);
  assert.equal(activeSheet(d).visuals[0].dimension, 'team');
  assert.deepEqual(activeSheet(d).visuals[0].measures, ['amount']);
  d = authorReducer(d, { type: 'calculation-add', field: { name: 'doubled', expression: '{amount} * 2', role: 'measure' } });
  assert.equal(d.calculatedFields.length, 1);
  d = authorReducer(d, { type: 'assign', field: 'doubled', well: 'values' });
  d = authorReducer(d, { type: 'filter', columnName: 'team', values: ['North'] });
  validateDraft(d);
  const request = buildAuthorQuery(activeSheet(d).visuals[0], d.calculatedFields, [], dataset);
  assert.deepEqual(request.filters, [{ columnName: 'team', values: ['North'] }]);
  assert.deepEqual(request.calculatedFields, [{ name: 'doubled', expression: '{amount} * 2' }]);
  const html = renderToStaticMarkup(createElement(AuthorCanvas, { draft: d, dispatch() {}, client: { dataset, queryDataset() {} } }));
  assert.match(html, /Assign team/); assert.match(html, /Assign doubled/); assert.doesNotMatch(html, /Assign revenue|Assign region/);
});
test('live uploaded queries target the selected dataset and arbitrary dates compile into real chart rows', async () => {
  const d = draft('line'), visual = activeSheet(d).visuals[0], request = buildAuthorQuery(visual, [], [], dataset);
  assert.deepEqual(request.dimensions, [{ fieldId: 'day', columnName: 'day', granularity: 'MONTH' }]);
  const result = await loadAuthorRows({ dataset, async queryDataset(id, body) {
    assert.equal(id, dataset.id); assert.deepEqual(body, request);
    return { rows: [{ month: '2026-01', amount: 9 }] };
  } }, request, new AbortController().signal);
  const compiled = compileVisual({ ...buildAuthorVisual(visual, [], dataset), rows: result.rows });
  assert.equal(compiled.state, 'ready'); assert.deepEqual(compiled.table.rows, [['2026-01', 9]]);
  const failed = await loadAuthorRows({ dataset, async queryDataset(id) { assert.equal(id, dataset.id); throw new Error('PREP_SOURCE_NOT_FOUND'); } }, request, new AbortController().signal);
  assert.equal(failed.rows, null); assert.match(failed.message, /Source data expired.*re-upload.*PREP_SOURCE_NOT_FOUND/);
  assert.equal(buildDistinctQuery('team', [], [], dataset).measures[0].columnName, 'amount');
});
test('local draft validation and export preserve the binding without inventing a sales binding or embedding rows', () => {
  const d = draft('bar'), stored = new Map(), storage = () => ({ getItem: k => stored.get(k) ?? null, setItem: (k, v) => stored.set(k, v) });
  assert.equal(saveDraft(d, storage), 'Draft saved on this device.'); assert.deepEqual(loadDraft(storage).draft, d);
  const exported = serializeDraft(d);
  assert.equal(exported.definition.dataSetIdentifierDeclarations[0].dataSetArn, 'opensight:dataset:prepared-csv');
  assert.doesNotMatch(JSON.stringify(exported), /renderable-sales|"rows":\[/);
  for (const bad of [{ ...dataset, id: '../escape' }, { ...dataset, id: 'sales' }, { ...dataset, columns: [{ name: 'bad', type: 'SQL' }] }, { ...dataset, columns: [dataset.columns[0], dataset.columns[0]] }, { ...dataset, sql: 'SELECT *' }]) assert.throws(() => validateDraft({ ...d, dataset: bad }));
});
test('local file UI discloses its cap and expiry while the static demo stays disabled', () => {
  const html = renderToStaticMarkup(createElement(DataSources, { local: true, client: { uploadFile() {}, validateConnector() {} } }));
  assert.match(html, /Local form limit: 8 MiB/); assert.match(html, /expire after 24 hours or restart/); assert.doesNotMatch(html, /type="file"[^>]*disabled/);
  const demo = renderToStaticMarkup(createElement(DataSources));
  assert.match(demo, /File uploads need a local or hosted API/); assert.match(demo, /type="file"[^>]*disabled/);
  assert.equal(allowed({ mode: 'local' }, 'build'), true);
  for (const capability of ['ai', 'admin']) assert.equal(allowed({ mode: 'local' }, capability), false);
});
