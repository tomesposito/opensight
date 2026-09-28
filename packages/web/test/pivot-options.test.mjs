import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { create } from 'react-test-renderer';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseQsBundle } from '@opensight/bundle-parser';
import { activeSheet, authorReducer, emptyDraft, validateDraft, serializeDraft } from '../build/test/authoring.js';
import { buildAuthorVisual } from '../build/test/author-preview.js';
import { compileVisual } from '../build/test/compiler.js';
import { importBundle, exportBundle, downloadBundleBytes } from '../build/test/bundle-authoring.js';
import { rowSelection } from '../build/test/visual-selection.js';
import { VisualCard } from '../build/test/VisualCard.js';
import { PivotOptionsEditor } from '../build/test/PivotOptionsEditor.js';
const draft = () => authorReducer(emptyDraft(), { type: 'add', kind: 'pivot' });
const selected = d => activeSheet(d).visuals.find(v => v.id === activeSheet(d).selectedId);
const visual = pivot => ({ ...selected(draft()), measures: ['revenue', 'profit'], columns: ['category'], formatting: { pivot, names: { revenue: 'Sales', region: 'Territory', category: 'Product' }, decimalPlaces: 1, rules: [{ fieldId: 'profit', operator: 'gte', threshold: 0, color: '#aa0000', background: '#ffeeee' }] } });
const rows = [{ region: 'East', category: 'A', revenue: 10, profit: 0 }, { region: 'West', category: 'B', revenue: null, profit: null }];
const input = (v, data = rows) => ({ ...buildAuthorVisual(v), rows: data });

test('pivot options validate, copy reducer state and round-trip through .qs including subsequent edits', async () => {
  const pivot = { metricPlacement: 'rows', hideEmptyRows: true, hideEmptyColumns: true, wordWrap: true, columnWidth: 180 };
  const d = authorReducer(draft(), { type: 'formatting', formatting: { pivot, names: { revenue: 'Sales' } } });
  pivot.columnWidth = 90;
  assert.equal(selected(d).formatting.pivot.columnWidth, 180);
  validateDraft(JSON.parse(JSON.stringify(d)));
  const bundle = await parseQsBundle(await downloadBundleBytes(d));
  const restored = importBundle(bundle);
  assert.deepEqual(selected(restored).formatting, selected(d).formatting);
  assert.deepEqual(selected(restored).imported.issues, []);
  assert.deepEqual(exportBundle(restored), bundle);
  const edited = authorReducer(restored, { type: 'formatting', formatting: { ...selected(restored).formatting, pivot: { metricPlacement: 'columns' } } });
  assert.deepEqual(selected(importBundle(exportBundle(edited))).formatting, selected(edited).formatting);
  for (const invalid of [{ metricPlacement: 'sideways' }, { hideEmptyRows: 1 }, { hideEmptyColumns: 'true' }, { wordWrap: null }, { columnWidth: 59 }, { columnWidth: 401 }, { columnWidth: 70.5 }, { collapse: 'all' }]) {
    const before = draft();
    assert.equal(selected(authorReducer(before, { type: 'formatting', formatting: { pivot: invalid } })), selected(before));
    const bad = draft(); selected(bad).formatting = { pivot: invalid };
    assert.throws(() => validateDraft(bad));
    assert.throws(() => compileVisual(input(selected(bad))), /invalid visual formatting/);
  }
  const resource = serializeDraft(draft());
  resource.definition.sheets[0].visuals[0].pivotTableVisual.opensightFormatting = { pivot: { futureOption: true } };
  const unknown = { members: [{ path: 'analysis/authored-analysis.json', resource }] };
  const imported = importBundle(unknown);
  assert.match(JSON.stringify(imported.bundle.report), /opensightFormatting/);
  assert.deepEqual(exportBundle(imported), unknown);
});

test('metric rows preserve sparse cells, totals, names, measure rules and row selection', () => {
  const v = { ...visual({ metricPlacement: 'rows' }), totals: true };
  const c = compileVisual(input(v));
  assert.deepEqual(c.table.columns, ['Territory', 'Value', 'Product: A', 'Product: B', 'Grand total']);
  assert.deepEqual(c.table.rows, [['East', 'Sales', 10, null, 10], ['East', 'profit', 0, null, 0], ['West', 'Sales', null, null, null], ['West', 'profit', null, null, null], ['Grand total', 'Sales', 10, null, 10], ['Grand total', 'profit', 0, null, 0]]);
  assert.deepEqual(rowSelection(c, 1), { values: { region: 'East' } });
  assert.equal(rowSelection(c, 4), undefined);
  const html = renderToStaticMarkup(createElement(VisualCard, { visual: input(v) }));
  assert.equal((html.match(/color:#aa0000;background:#ffeeee">0.0/g) ?? []).length, 4);
  assert.doesNotMatch(html, /background:#ffeeee">10.0/);
  const hidden = renderToStaticMarkup(createElement(VisualCard, { visual: input({ ...v, formatting: { ...v.formatting, valueNamesVisible: false } }) }));
  assert.match(hidden, /class="sr-only">Sales/);
});

test('empty axis suppression uses nulls, preserves zeros and measure identities in both layouts', () => {
  for (const metricPlacement of ['columns', 'rows']) {
    const v = visual({ metricPlacement, hideEmptyRows: true, hideEmptyColumns: true });
    const c = compileVisual(input(v));
    assert.equal(c.state, 'ready');
    assert.ok(c.table.rows.every(row => row[0] === 'East'));
    assert.ok(c.table.rows.some(row => row.includes(0)));
    assert.ok(c.table.columns.every(name => !name.includes('Product: B')));
    assert.equal(compileVisual(input(v, [{ region: 'Empty', category: 'A', revenue: null, profit: null }])).state, 'empty');
    for (const [data, state] of [[[], 'empty'], [null, 'unavailable']]) assert.equal(compileVisual(input(v, data)).state, state);
  }
  // Hiding the first measure must not shift the second measure's formatting rule.
  const v = visual({ hideEmptyColumns: true });
  const html = renderToStaticMarkup(createElement(VisualCard, { visual: input(v, [{ region: 'East', category: 'A', revenue: null, profit: 0 }]) }));
  assert.match(html, /color:#aa0000;background:#ffeeee">0.0/);
});

test('metric rows work with subtotals and either absent axis without changing null dimensions', () => {
  const v = { ...visual({ metricPlacement: 'rows' }), rows: ['region', 'order_id'], subtotals: true, totals: true };
  const c = compileVisual(input(v, [{ region: null, order_id: 1, category: 'A', revenue: 10, profit: 0 }, { region: null, order_id: 2, category: 'A', revenue: 20, profit: null }]));
  assert.deepEqual(c.table.rows[4], [null, 'Subtotal', 'Sales', 30, 30]);
  assert.equal(rowSelection(c, 4), undefined);
  const colOnly = { ...visual({ metricPlacement: 'rows' }), rows: [], dimension: null };
  assert.deepEqual(compileVisual(input(colOnly, rows.slice(0, 1))).table.rows, [['Sales', 10], ['profit', 0]]);
  const rowOnly = { ...visual({ metricPlacement: 'rows' }), columns: [] };
  assert.deepEqual(compileVisual(input(rowOnly, rows.slice(0, 1))).table.rows, [['East', 'Sales', 10], ['East', 'profit', 0]]);
});

test('pivot wrapping and sizing apply to semantic table cells and header cells', () => {
  const html = renderToStaticMarkup(createElement(VisualCard, { visual: input(visual({ wordWrap: true, columnWidth: 180 })) }));
  assert.match(html, /table-layout:fixed;width:900px/);
  assert.match(html, /<th[^>]*white-space:normal;overflow-wrap:anywhere;width:180px/);
  assert.match(html, /<td[^>]*white-space:normal;overflow-wrap:anywhere;width:180px/);
  const nowrap = renderToStaticMarkup(createElement(VisualCard, { visual: input(visual({ wordWrap: false })) }));
  assert.match(nowrap, /white-space:nowrap/);
});

test('pivot panel edits every option through the reducer and preserves name overrides', async t => {
  const old = globalThis.IS_REACT_ACT_ENVIRONMENT; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let d = draft(), renderer;
  selected(d).formatting = { names: { revenue: 'Sales' } };
  const render = () => createElement(PivotOptionsEditor, { visual: selected(d), dispatch(action) { d = authorReducer(d, action); renderer.update(render()); } });
  await act(() => { renderer = create(render()); });
  t.after(async () => { await act(() => renderer.unmount()); globalThis.IS_REACT_ACT_ENVIRONMENT = old; });
  await act(() => renderer.root.findByType('select').props.onChange({ target: { value: 'rows' } }));
  for (const checkbox of renderer.root.findAllByType('input').filter(n => n.props.type === 'checkbox')) await act(() => checkbox.props.onChange({ target: { checked: true } }));
  await act(() => renderer.root.findAllByType('input').find(n => n.props.type === 'number').props.onChange({ target: { value: '180' } }));
  assert.deepEqual(selected(d).formatting, { names: { revenue: 'Sales' }, pivot: { metricPlacement: 'rows', hideEmptyRows: true, hideEmptyColumns: true, wordWrap: true, columnWidth: 180 } });
  await act(() => renderer.update(createElement(PivotOptionsEditor, { visual: { ...selected(d), kind: 'table' }, dispatch() {} })));
  assert.equal(renderer.toJSON(), null);
});
