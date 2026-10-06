import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { create } from 'react-test-renderer';
import { renderToStaticMarkup } from 'react-dom/server';
import { Author, AuthorCanvas } from '../build/test/Author.js';
import { createDraftStore } from '../build/test/local-drafts.js';
import { AuthorToolbar } from '../build/test/AuthorToolbar.js';
import { FormattingEditor } from '../build/test/FormattingEditor.js';
import { activeSheet, authorReducer, emptyDraft, serializeDraft, DRAFT_KEY as STORAGE_KEY } from '../build/test/authoring.js';

async function mount(t, element, stored) {
  const oldWindow = globalThis.window, oldAct = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const values = new Map(stored ? [[STORAGE_KEY, JSON.stringify(stored)]] : []);
  const storage = { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v) };
  globalThis.window = { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), localStorage: storage };
  let renderer; await act(() => { renderer = create(element); });
  t.after(async () => { await act(() => renderer.unmount()); globalThis.window = oldWindow; globalThis.IS_REACT_ACT_ENVIRONMENT = oldAct; });
  const find = (type, predicate) => renderer.root.findAllByType(type).find(n => predicate(n.props));
  const click = async label => { const n = find('button', p => p.children === label || p['aria-label'] === label); assert.ok(n, label); await act(() => n.props.onClick()); };
  return { renderer, find, click, saved: () => createDraftStore(() => storage, { mode: 'demo' }).restore()?.draft };
}
const add = kind => authorReducer(emptyDraft(), { type: 'add', kind });

test('header keeps identity, menus, working O entry, canvas actions and NEW LOOK in order', async t => {
  const ui = await mount(t, createElement(Author), add('bar'));
  const header = ui.find('header', p => p.className === 'author-topbar app-header');
  assert.equal(header.children[0].props.className, 'brand');
  const title = header.findByType('input');
  await act(() => title.props.onChange({ target: { value: 'Sales analysis' } }));
  await ui.click('Save draft');
  assert.equal(ui.saved().title, 'Sales analysis');
  const nav = ui.find('nav', p => p['aria-label'] === 'Analysis menu');
  assert.deepEqual(nav.children.map(n => n.type), [...Array(7).fill('details'), 'button', 'div', 'button', 'button', 'button', 'label']);
  assert.equal(nav.children[9].props.children, 'Add visual');
  assert.equal(nav.children[10].props.children, 'FIT TO WIDTH');
  assert.equal(nav.children[11].props.children, 'PUBLISH');
  const toggle = nav.findByType('select');
  assert.equal(toggle.props['aria-label'], 'NEW LOOK');
  const before = serializeDraft(ui.saved());
  await act(() => toggle.props.onChange({ target: { value: 'dark' } }));
  assert.equal(ui.find('div', p => p.className === 'author-workspace').props['data-chrome'], 'dark');
  await ui.click('Save draft');
  assert.equal(ui.saved().chrome, 'dark');
  assert.deepEqual(serializeDraft(ui.saved()), before, 'chrome does not change the analysis definition');
  await act(() => nav.findByProps({ className: 'q-trigger' }).props.onClick());
  const panel = ui.find('div', p => p.role === 'dialog');
  await act(() => panel.findByProps({ id: 'o-question' }).props.onChange({ target: { value: 'sum revenue by region' } }));
  await act(() => panel.findByType('form').props.onSubmit({ preventDefault() {} }));
  const answer = ui.find('div', p => p.className === 'o-answer');
  assert.ok(answer);
  assert.equal(panel.findByProps({ className: 'o-answer' }), answer, 'Q answers belong to the side panel');
  assert.equal(nav.findAll(n => n.props.className === 'o-answer').length, 0, 'Q answers are outside the toolbar');
  await ui.click('Close Ask Q');
  assert.equal(ui.find('div', p => p.role === 'dialog'), undefined);
  await act(() => nav.findByProps({ className: 'q-trigger' }).props.onClick());
  await act(() => ui.renderer.root.findByProps({ id: 'o-question' }).props.onChange({ target: { value: 'sum revenue by region' } }));
  await act(() => ui.renderer.root.findByProps({ className: 'o-bar' }).props.onSubmit({ preventDefault() {} }));
  await ui.click('ADD TO ANALYSIS');
  await ui.click('Close Ask Q');
  await ui.click('Save draft');
  assert.equal(activeSheet(ui.saved()).visuals.length, 2);
});

test('toolbar exposes all seven menus, callbacks, busy guards and honest publish status', async t => {
  let calls = [];
  const props = { draft: add('bar'), dispatch: a => calls.push(a), fit: true, onFit: () => calls.push('fit'), onJson: () => calls.push('json'), onBundle: () => calls.push('bundle'), onImport: () => calls.push('import') };
  const ui = await mount(t, createElement(AuthorToolbar, props));
  assert.deepEqual(ui.renderer.root.findAllByType('summary').map(n => n.props.children), ['File', 'Edit', 'Data', 'Insert', 'Sheets', 'Objects', 'Search']);
  for (const label of ['Import bundle…', 'Download .qs', 'Export JSON', 'FIT TO WIDTH']) await ui.click(label);
  assert.deepEqual(calls, ['import', 'bundle', 'json', 'fit']);
  await ui.click('Add bar visual'); await ui.click('Add sheet'); await ui.click('Remove selected visual');
  assert.deepEqual(calls.slice(4), [{ type: 'add', kind: 'bar' }, { type: 'sheet-add' }, { type: 'remove', id: 'visual-1' }]);
  await ui.click('Add visual');
  assert.equal(calls.length, 7, 'Add visual focuses the gallery instead of dispatching a visual action');
  await ui.click('PUBLISH');
  assert.match(ui.find('div', p => p.role === 'status').props.children[0], /This static demo has no publication destination/);
  await ui.click('Dismiss'); assert.equal(ui.find('div', p => p.role === 'status'), undefined);
  await act(() => ui.renderer.update(createElement(AuthorToolbar, { ...props, busy: true, jsonDisabled: true })));
  for (const label of ['Import bundle…', 'Download .qs', 'Export JSON']) assert.equal(ui.find('button', p => p.children === label).props.disabled, true);
});

test('search selects a matching visual on another sheet in order', async t => {
  let draft = authorReducer(add('bar'), { type: 'sheet-add' });
  draft = authorReducer(draft, { type: 'add', kind: 'gauge' });
  draft = authorReducer(draft, { type: 'title', title: 'Revenue target' });
  const calls = [];
  const ui = await mount(t, createElement(AuthorToolbar, { draft, dispatch: a => calls.push(a), onFit() {}, onJson() {}, onBundle() {}, onImport() {}, fit: true }));
  await act(() => ui.find('input', p => p.type === 'search').props.onChange({ target: { value: 'target' } }));
  const searchMenu = ui.renderer.root.findAllByType('details').find(n => n.findByType('summary').props.children === 'Search');
  const button = searchMenu.findAllByType('button').find(n => Array.isArray(n.props.children) && n.props.children.includes('Revenue target'));
  assert.ok(button); await act(() => button.props.onClick());
  assert.deepEqual(calls, [{ type: 'sheet-select', id: 'sheet-2' }, { type: 'select', id: 'visual-2' }]);
});

test('FIT TO WIDTH changes canvas width and preserves the persisted grid', async t => {
  const draft = add('bar');
  const ui = await mount(t, createElement(Author), draft);
  const canvas = () => ui.find('div', p => p.className === 'author-canvas');
  assert.equal(canvas().props.style.width, '100%');
  await ui.click('FIT TO WIDTH'); assert.equal(canvas().props.style.width, 1200);
  assert.deepEqual(activeSheet(ui.saved()).layout, activeSheet(draft).layout);
  await ui.click('FIT TO WIDTH'); assert.equal(canvas().props.style.width, '100%');
  assert.deepEqual(ui.saved(), draft);
});

test('Properties exposes display, table formatting, total and naming sections without duplicate toggles', () => {
  const html = renderToStaticMarkup(createElement(AuthorCanvas, { draft: add('pivot'), dispatch() {} }));
  for (const title of ['Display settings', 'Headers', 'Cells', 'Total', 'Subtotal', 'Row names', 'Column names', 'Value names', 'Conditional formatting']) assert.ok(html.includes(`<summary>${title}</summary>`), title);
  assert.equal((html.match(/Show totals/g) ?? []).length, 1);
  assert.equal((html.match(/Show subtotals/g) ?? []).length, 1);
  for (const [kind, label] of [['gauge', 'Gauge maximum'], ['histogram', 'Histogram bins'], ['bar100', 'Horizontal bars']]) assert.ok(renderToStaticMarkup(createElement(AuthorCanvas, { draft: add(kind), dispatch() {} })).includes(label));
});

test('format editor dispatches visibility, names, cells, totals and validated rules to the selected visual', async t => {
  const visual = activeSheet(add('table')).visuals[0], calls = [];
  const ui = await mount(t, createElement(FormattingEditor, { visual, dispatch: a => calls.push(a) }));
  const labelInput = label => ui.renderer.root.findAllByType('label').find(n => Array.isArray(n.props.children) && n.props.children.includes(label))?.findByType('input');
  for (const [label, value] of [['Show headers', false], ['Cell font size', 18], ['revenue', 'Sales'], ['Show totals', true]]) {
    const n = labelInput(label); assert.ok(n, label); await act(() => n.props.onChange({ target: { value, checked: value } }));
  }
  assert.deepEqual(calls.slice(0, 4), [{ type: 'formatting', formatting: { headersVisible: false } }, { type: 'formatting', formatting: { fontSize: 18 } }, { type: 'formatting', formatting: { names: { revenue: 'Sales' } } }, { type: 'display', property: 'totals', value: true }]);
  const threshold = labelInput('Rule threshold');
  await act(() => threshold.props.onChange({ target: { value: '' } }));
  assert.equal(ui.find('button', p => p.children === 'Add formatting rule').props.disabled, true);
  await act(() => threshold.props.onChange({ target: { value: '100' } }));
  await ui.click('Add formatting rule'); assert.equal(calls.at(-1).formatting.rules[0].threshold, 100);
  await ui.click('Reset formatting'); assert.deepEqual(calls.at(-1), { type: 'formatting', formatting: {} });
});
