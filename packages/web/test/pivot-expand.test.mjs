import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { create } from 'react-test-renderer';
import { activeSheet, authorReducer, emptyDraft } from '../build/test/authoring.js';
import { buildAuthorVisual } from '../build/test/author-preview.js';
import { compileVisual, rowGroupKey, rowGroupVisibility } from '../build/test/compiler.js';
import { VisualCard } from '../build/test/VisualCard.js';
const base = () => activeSheet(authorReducer(emptyDraft(), { type: 'add', kind: 'pivot' })).visuals[0];
const input = (v, rows) => ({ ...buildAuthorVisual(v), rows });
const sales = [
  { region: 'East', category: 'Hardware', revenue: 100 },
  { region: 'East', category: 'Software', revenue: 300 },
  { region: 'West', category: 'Hardware', revenue: 400 },
];

test('pivot emits typed rowGroupPaths aligned with rows, kinds and hide-empty filtering', () => {
  const v = { ...base(), rows: ['region', 'category'], subtotals: true, totals: true };
  const result = compileVisual(input(v, sales));
  assert.deepEqual(result.table.rowKinds, ['detail', 'detail', 'subtotal', 'detail', 'subtotal', 'total']);
  assert.deepEqual(result.table.rowGroupPaths, [['East', 'Hardware'], ['East', 'Software'], ['East'], ['West', 'Hardware'], ['West'], []]);
  const typed = compileVisual(input(v, [{ region: null, category: 1, revenue: 5 }, { region: '(null)', category: '1', revenue: 6 }]));
  assert.deepEqual(typed.table.rowGroupPaths, [[null, 1], [null], ['(null)', '1'], ['(null)'], []]);
  // hideEmptyRows filtering keeps paths aligned with the surviving rows.
  const sparse = compileVisual(input({ ...v, formatting: { pivot: { hideEmptyRows: true } } }, [
    { region: 'East', category: 'Hardware', revenue: null },
    { region: 'West', category: 'Hardware', revenue: 4 },
  ]));
  assert.deepEqual(sparse.table.rows.map(row => row[0]), ['West', 'West', 'Grand total']);
  assert.deepEqual(sparse.table.rowGroupPaths, [['West', 'Hardware'], ['West'], []]);
  const plain = compileVisual(input({ ...base(), rows: ['region', 'category'] }, sales));
  assert.deepEqual(plain.table.rowGroupPaths, [['East', 'Hardware'], ['East', 'Software'], ['West', 'Hardware']]);
});

test('rowGroupVisibility collapses strict descendants only; anchors and grand total stay', () => {
  const paths = [['East', 'Hardware'], ['East', 'Software'], ['East'], ['West', 'Hardware'], ['West'], []];
  const east = new Set([rowGroupKey(['East'])]);
  assert.deepEqual(rowGroupVisibility(paths, east), [false, false, true, true, true, true]);
  const child = new Set([rowGroupKey(['West', 'Hardware'])]);
  assert.deepEqual(rowGroupVisibility(paths, child), [true, true, true, true, true, true]);
  const both = new Set([rowGroupKey(['East']), rowGroupKey(['West'])]);
  assert.deepEqual(rowGroupVisibility(paths, both), [false, false, true, false, true, true]);
  // Collapsing a leaf-level group hides nothing: its own detail rows stay visible.
  const leaf = new Set([rowGroupKey(['West', 'Hardware'])]);
  assert.equal(rowGroupVisibility(paths, leaf)[3], true);
  // Typed keys never collide: collapsing string '1' leaves numeric 1 expanded.
  const typedPaths = [[1], ['1'], []];
  assert.deepEqual(rowGroupVisibility(typedPaths, new Set([rowGroupKey(['1'])])), [true, true, true]);
  assert.deepEqual(rowGroupVisibility(paths, new Set()), [true, true, true, true, true, true]);
});

test('pivot with subtotals renders expand/collapse toggles on subtotal rows only', () => {
  const v = { ...base(), rows: ['region', 'category'], subtotals: true, totals: true };
  const html = renderToStaticMarkup(createElement(VisualCard, { visual: input(v, sales) }));
  const toggles = html.match(/class="expand-toggle"/g) ?? [];
  assert.equal(toggles.length, 2);
  assert.match(html, /aria-expanded="true"/);
  assert.match(html, /aria-label="Collapse row group East"/);
  assert.match(html, /aria-label="Collapse row group West"/);
  const totalRow = html.match(/<tr class="total">.*?<\/tr>/s)?.[0] ?? '';
  assert.doesNotMatch(totalRow, /expand-toggle/);
});

test('pivot without subtotals renders group headers; single-level pivots have no toggles', () => {
  const v = { ...base(), rows: ['region', 'category'], totals: true };
  const html = renderToStaticMarkup(createElement(VisualCard, { visual: input(v, sales) }));
  assert.equal((html.match(/class="expand-toggle"/g) ?? []).length, 2);
  assert.equal((html.match(/class="row-group"/g) ?? []).length, 2);
  assert.doesNotMatch(html, /class="subtotal"/);
  const single = { ...base(), rows: ['region'], subtotals: true };
  const singleHtml = renderToStaticMarkup(createElement(VisualCard, { visual: input(single, sales) }));
  assert.doesNotMatch(singleHtml, /expand-toggle/);
});

test('toggle click collapses and re-expands a row group in the rendered table', async t => {
  const oldWindow = globalThis.window, oldAct = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.window = { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) };
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const v = { ...base(), rows: ['region', 'category'], subtotals: true, totals: true };
  let renderer;
  await act(() => { renderer = create(createElement(VisualCard, { visual: input(v, sales) })); });
  t.after(async () => { await act(() => renderer.unmount()); globalThis.window = oldWindow; globalThis.IS_REACT_ACT_ENVIRONMENT = oldAct; });
  const bodyRows = () => renderer.root.findAllByType('tr').filter(tr => tr.parent?.type === 'tbody');
  const toggle = label => renderer.root.findAllByType('button').find(b => b.props.className === 'expand-toggle' && b.props['aria-label'] === label);
  const click = async button => { assert.ok(button); await act(() => button.props.onClick({ stopPropagation() {} })); };
  assert.equal(bodyRows().length, 6);
  await click(toggle('Collapse row group East'));
  // East detail rows hide; the East subtotal anchor, West rows and the grand total stay.
  assert.equal(bodyRows().length, 4);
  assert.equal(bodyRows()[0].props.className, 'subtotal');
  assert.ok(toggle('Expand row group East'));
  assert.equal(toggle('Expand row group East').props['aria-expanded'], false);
  await click(toggle('Expand row group East'));
  assert.equal(bodyRows().length, 6);
  assert.ok(toggle('Collapse row group East'));
});

async function mount(t, visual, rows = sales, extras = {}) {
  const oldAct = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let renderer;
  const render = v => createElement(VisualCard, { visual: input(v, rows), ...extras });
  await act(() => { renderer = create(render(visual)); });
  t.after(async () => { await act(() => renderer.unmount()); globalThis.IS_REACT_ACT_ENVIRONMENT = oldAct; });
  const toggles = () => renderer.root.findAllByType('button').filter(b => b.props.className === 'expand-toggle');
  const toggle = label => toggles().find(b => b.props['aria-label'] === label);
  return {
    toggles, toggle, rows: () => renderer.root.findAllByType('tr').filter(tr => tr.parent?.type === 'tbody'),
    update: async v => { await act(() => renderer.update(render(v))); },
    click: async label => { const b = toggle(label); assert.ok(b, label); await act(() => b.props.onClick({ stopPropagation() {} })); },
  };
}

test('nested groups preserve independent state when parents collapse, including without subtotals', async t => {
  for (const subtotals of [true, false]) await t.test(`subtotals ${subtotals}`, async t => {
    const v = { ...base(), rows: ['region', 'category', 'order_id'], subtotals, totals: true };
    const rows = [...sales.map((r, i) => ({ ...r, order_id: i + 1 })), { region: 'West', category: 'Software', order_id: 4, revenue: 25 }];
    const ui = await mount(t, v, rows);
    const initial = ui.rows().length;
    assert.equal(ui.toggles().length, 6);
    await ui.click('Collapse row group East / Hardware');
    assert.equal(ui.rows().length, initial - 1);
    await ui.click('Collapse row group East');
    assert.equal(ui.rows().length, initial - 4);
    assert.equal(ui.toggle('Expand row group East / Hardware'), undefined);
    await ui.click('Collapse row group West');
    assert.equal(ui.rows().length, 3); // Two anchors and the grand total.
    await ui.click('Expand row group East');
    assert.ok(ui.toggle('Expand row group East / Hardware'));
    assert.ok(ui.toggle('Expand row group West'));
    await ui.click('Expand row group East / Hardware');
    await ui.click('Expand row group West');
    assert.equal(ui.rows().length, initial);
  });
});

test('saved state renders immediately and local viewer state survives recompilation', async t => {
  const v = { ...base(), rows: ['region', 'category'], subtotals: true, totals: true, formatting: { pivot: { collapsedRowGroups: [['East']] } } };
  const ui = await mount(t, v);
  assert.equal(ui.rows().length, 4);
  await ui.click('Collapse row group West');
  await ui.update({ ...v, title: 'New title', formatting: { ...v.formatting, decimalPlaces: 2 } });
  assert.equal(ui.rows().length, 3);
  assert.ok(ui.toggle('Expand row group East'));
  assert.ok(ui.toggle('Expand row group West'));
  await ui.update({ ...v, formatting: { pivot: { collapsedRowGroups: [] } } });
  assert.equal(ui.rows().length, 6);
});

test('metric rows use one focusable toggle per group and retain every subtotal measure', async t => {
  const v = { ...base(), rows: ['region', 'category'], measures: ['revenue', 'profit'], subtotals: true, totals: true,
    formatting: { pivot: { metricPlacement: 'rows', hideEmptyRows: true, hideEmptyColumns: true } } };
  const ui = await mount(t, v, sales.map(r => ({ ...r, profit: r.revenue / 10 })), { interaction: { onSelect() { assert.fail('toggle must not trigger a data selection'); } } });
  assert.equal(ui.toggles().length, 2);
  for (const button of ui.toggles()) { assert.equal(button.props.type, 'button'); assert.notEqual(button.props.tabIndex, -1); }
  await ui.click('Collapse row group East');
  assert.equal(ui.rows().length, 8);
  assert.equal(ui.rows().filter(r => r.props.className === 'subtotal').length, 4);
  assert.equal(ui.toggle('Expand row group East').props['aria-expanded'], false);
  await ui.click('Expand row group East');
  assert.equal(ui.rows().length, 12);
});

test('hide-empty options only create headers for surviving children and typed keys stay distinct', async t => {
  const v = { ...base(), rows: ['region', 'category'], formatting: { pivot: { hideEmptyRows: true, collapsedRowGroups: [[1]] } } };
  const ui = await mount(t, v, [{ region: 1, category: 'A', revenue: 2 }, { region: '1', category: 'B', revenue: 3 }, { region: null, category: 'C', revenue: null }]);
  assert.equal(ui.toggles().length, 2);
  assert.equal(ui.rows().length, 3);
  assert.equal(ui.rows().filter(r => r.props.className === 'detail').length, 1);
});
