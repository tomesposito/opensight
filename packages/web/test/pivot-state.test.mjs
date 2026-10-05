import test from 'node:test';
import assert from 'node:assert/strict';
import { parseQsBundle } from '@opensight/bundle-parser';
import { activeSheet, authorReducer, emptyDraft, serializeDraft, validateDraft } from '../build/test/authoring.js';
import { buildAuthorVisual } from '../build/test/author-preview.js';
import { compileVisual } from '../build/test/compiler.js';
import { importBundle, exportBundle, downloadBundleBytes } from '../build/test/bundle-authoring.js';

const pivot = () => authorReducer(authorReducer(emptyDraft(), { type: 'add', kind: 'pivot' }), { type: 'assign', well: 'rows', field: 'category' });
const first = d => activeSheet(d).visuals[0];
const groups = d => first(d).formatting?.pivot?.collapsedRowGroups ?? [];
const toggle = (d, path, collapsed = true) => authorReducer(d, { type: 'pivot-row-group', id: first(d).id, path, collapsed });

test('row-group state targets its visual, copies typed paths and survives unrelated edits', () => {
  let d = authorReducer(pivot(), { type: 'add', kind: 'pivot' });
  const path = ['East'];
  d = toggle(d, path); path[0] = 'West';
  assert.deepEqual(groups(d), [['East']]);
  assert.equal(activeSheet(d).visuals[1].formatting, undefined);
  d = toggle(d, ['West']);
  d = toggle(d, ['East']);
  assert.deepEqual(groups(d), [['West'], ['East']]);
  d = toggle(d, ['East'], false);
  assert.deepEqual(groups(d), [['West']]);
  d = authorReducer(d, { type: 'select', id: first(d).id });
  d = authorReducer(d, { type: 'title', title: 'Sales' });
  d = authorReducer(d, { type: 'display', property: 'subtotals', value: true });
  d = authorReducer(d, { type: 'assign', field: 'profit', well: 'values' });
  assert.deepEqual(groups(d), [['West']]);
  d = authorReducer(d, { type: 'assign', field: 'order_date', well: 'rows' });
  assert.deepEqual(groups(d), []);
  for (const path of [[], ['East', 'A', 'month'], [{}], [NaN]]) assert.equal(toggle(d, path), d);
  assert.equal(authorReducer(d, { type: 'pivot-row-group', id: 'missing', path: ['East'], collapsed: true }), d);
});

test('import, edit, JSON and .qs export retain collapsed groups and independent child state', async () => {
  let d = authorReducer(pivot(), { type: 'assign', field: 'order_date', well: 'rows' });
  for (const path of [['East', 'Hardware'], ['East'], [null], ['1'], [1], [true]]) d = toggle(d, path);
  const bundle = await parseQsBundle(await downloadBundleBytes(d));
  let imported = importBundle(bundle);
  assert.deepEqual(first(imported).imported.issues, []);
  assert.deepEqual(exportBundle(imported), bundle);
  assert.deepEqual(groups(imported), groups(d));
  const c = compileVisual(buildAuthorVisual(first(imported)));
  assert.deepEqual(c.model.formatting.pivot.collapsedRowGroups, groups(d));
  imported = toggle(imported, ['East'], false);
  imported = authorReducer(imported, { type: 'title', title: 'Edited pivot' });
  const again = importBundle(await parseQsBundle(await downloadBundleBytes(imported)));
  assert.deepEqual(groups(again), [['East', 'Hardware'], [null], ['1'], [1], [true]]);
  assert.equal(first(again).title, 'Edited pivot');
  assert.deepEqual(groups(importBundle(exportBundle(imported))), groups(again));
  validateDraft(JSON.parse(JSON.stringify(again)));
});

test('malformed persisted collapse state is rejected and retained with a named import error', () => {
  for (const collapsedRowGroups of [null, 'all', [[]], [[{}]], [[NaN]], [[Infinity]], [['East'], ['East']]]) {
    const d = pivot();
    first(d).formatting = { pivot: { collapsedRowGroups } };
    assert.throws(() => validateDraft(d));
    assert.throws(() => compileVisual(buildAuthorVisual(first(d))), /CompileError.*invalid visual formatting/);
  }
  const resource = serializeDraft(pivot());
  resource.definition.sheets[0].visuals[0].pivotTableVisual.opensightFormatting = { pivot: { collapsedRowGroups: [[]] } };
  const bundle = { members: [{ path: 'analysis/authored-analysis.json', resource }] };
  const imported = importBundle(bundle);
  assert.match(first(imported).imported.issues.join(' '), /opensightFormatting.*retained, read-only/);
  assert.deepEqual(exportBundle(imported), bundle);
});
