import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { act, createElement } from 'react';
import { create } from 'react-test-renderer';
import { renderToStaticMarkup } from 'react-dom/server';
import { Dashboard } from '../build/test/Dashboard.js';
import { VisualCard } from '../build/test/VisualCard.js';
import { VisualActionMenu } from '../build/test/VisualActionMenu.js';
import { AccessProvider, demoAccess } from '../build/test/access.js';

const json = async path => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));
const generated = await json('../src/fixtures.generated.json');
const sales = generated.find(f => f.id === 'renderable-sales');
const byId = id => sales.sheets[0].visuals.find(v => {
  const body = Object.values(v.definition)[0];
  return (body.VisualId ?? body.visualId) === id;
});
const clone = (id, overrides = {}, visualId) => {
  const v = structuredClone(byId(id));
  if (visualId) { const key = Object.keys(v.definition)[0]; v.definition[key] = { ...v.definition[key], VisualId: visualId }; }
  return { ...v, ...overrides };
};

const selectFilter = { id: 'f1', name: 'Filter region', sourceField: 'region', targets: 'all', mappings: {}, activation: 'select' };
const menuFilter = { id: 'f2', name: 'Menu filter region', sourceField: 'region', targets: 'all', mappings: {}, activation: 'menu' };
const menuUrl = { id: 'u1', name: 'Open region page', sourceField: 'region', urlTemplate: 'https://example.com/{region}', activation: 'menu' };
const selectUrl = { id: 'u2', name: 'Open region now', sourceField: 'region', urlTemplate: 'https://example.com/{region}', activation: 'select' };
const selectNav = { id: 'n1', name: 'Go to details', sourceField: 'region', targetSheetId: 's2', parameterMappings: {}, activation: 'select' };

const sourceVisual = (overrides = {}) => clone('revenue-by-region', {
  path: 'test/s1/source',
  rows: [{ region: 'East', revenue: 500 }, { region: 'West', revenue: 300 }],
  filterActions: [selectFilter, menuFilter],
  urlActions: [menuUrl],
  navigationActions: [],
  ...overrides,
});
const targetVisual = () => clone('sales-table', {
  path: 'test/s1/target',
  rows: [{ region: 'East', revenue: 100 }, { region: 'West', revenue: 200 }],
}, 'sales-table-target');
const kpiVisual = () => clone('total-revenue', { path: 'test/s1/kpi', urlActions: [menuUrl] });
const pieVisual = () => clone('share-by-category', { path: 'test/s1/pie' });
const fixture = (sourceOverrides = {}) => ({
  id: 'actions-test', name: 'Actions', description: 'desc', provenance: 'test', notice: 'notice',
  sheets: [
    { id: 's1', name: 'Overview', visuals: [sourceVisual(sourceOverrides), targetVisual(), kpiVisual(), pieVisual()] },
    { id: 's2', name: 'Details', visuals: [clone('revenue-by-region', { path: 'test/s2/only', rows: [{ region: 'East', revenue: 1 }] })] },
  ],
});

async function mount(t, fx) {
  const oldWindow = globalThis.window, oldAct = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const opened = [];
  globalThis.window = { open: (url, target) => { opened.push([url, target]); } };
  let renderer;
  await act(() => { renderer = create(createElement(AccessProvider, { access: demoAccess }, createElement(Dashboard, { fixture: fx }))); });
  t.after(async () => { await act(() => renderer.unmount()); globalThis.window = oldWindow; globalThis.IS_REACT_ACT_ENVIRONMENT = oldAct; });
  const cards = () => renderer.root.findAllByType(VisualCard);
  const cardFor = path => cards().find(c => c.props.visual.path === path);
  const menus = () => renderer.root.findAllByType(VisualActionMenu);
  return { renderer, opened, cards, cardFor, menus,
    select: async (path, selection) => { await act(() => cardFor(path).props.interaction.onSelect(selection)); },
  };
}

test('interaction reaches only visuals with actions and no origin problem', async t => {
  const ui = await mount(t, fixture());
  assert.ok(ui.cardFor('test/s1/source').props.interaction, 'source with actions');
  assert.equal(ui.cardFor('test/s1/target').props.interaction, undefined, 'no actions');
  assert.equal(ui.cardFor('test/s1/pie').props.interaction, undefined, 'no actions');
  assert.equal(ui.cardFor('test/s1/kpi').props.interaction, undefined, 'KPI cannot originate actions');
});

test('view cards render the ⋯ menu with menu-option actions, disabled until selection', async t => {
  const ui = await mount(t, fixture());
  const menus = ui.menus();
  assert.equal(menus.length, 2, 'source and KPI cards have menu-option actions');
  const sourceMenu = menus.find(m => m.props.items.some(i => i.id === 'f2'));
  assert.deepEqual(sourceMenu.props.items.map(i => i.id), ['f2', 'u1']);
  assert.equal(sourceMenu.props.selection, undefined);
  // Open the menu through the mounted tree: items are disabled without a selection.
  await act(() => sourceMenu.findByProps({ 'aria-label': 'Run action' }).props.onClick({ stopPropagation() {} }));
  for (const item of sourceMenu.findAllByProps({ role: 'menuitem' })) {
    assert.equal(item.props.disabled, true);
    assert.equal(item.props.title, 'Select a data point first');
  }
});

test('selecting a data point stores the selection and enables the menu', async t => {
  const ui = await mount(t, fixture());
  await ui.select('test/s1/source', { values: { region: 'East' } });
  const sourceMenu = ui.menus().find(m => m.props.items.some(i => i.id === 'f2'));
  assert.deepEqual(sourceMenu.props.selection, { values: { region: 'East' } });
  const html = renderToStaticMarkup(createElement(VisualActionMenu, { items: sourceMenu.props.items, selection: sourceMenu.props.selection, onInvoke() {} }));
  assert.doesNotMatch(html, /disabled=""/);
  // Toggling the same point clears the selection again.
  await ui.select('test/s1/source', { values: { region: 'East' } });
  assert.equal(ui.menus().find(m => m.props.items.some(i => i.id === 'f2')).props.selection, undefined);
});

test('select-activated URL action opens the resolved URL on click', async t => {
  const ui = await mount(t, fixture({ urlActions: [selectUrl] }));
  await ui.select('test/s1/source', { values: { region: 'West' } });
  assert.deepEqual(ui.opened, [['https://example.com/West', '_blank']]);
});

test('select-activated navigation action switches the dashboard sheet', async t => {
  const ui = await mount(t, fixture({ navigationActions: [selectNav] }));
  assert.equal(ui.cards().length, 4);
  await ui.select('test/s1/source', { values: { region: 'East' } });
  assert.equal(ui.cards().length, 1);
  assert.equal(ui.cards()[0].props.visual.path, 'test/s2/only');
});

test('menu-option URL action opens against the stored selection', async t => {
  const ui = await mount(t, fixture());
  const menu = () => ui.menus().find(m => m.props.items.some(i => i.id === 'u1'));
  await act(() => menu().props.onInvoke(menuUrl));
  assert.deepEqual(ui.opened, [], 'no selection: menu invocation is a no-op');
  await ui.select('test/s1/source', { values: { region: 'East' } });
  await act(() => menu().props.onInvoke(menuUrl));
  assert.deepEqual(ui.opened, [['https://example.com/East', '_blank']]);
});

test('menu-option filter action never fires on selection click', async t => {
  const ui = await mount(t, fixture({ filterActions: [menuFilter] }));
  await ui.select('test/s1/source', { values: { region: 'East' } });
  assert.equal(ui.cardFor('test/s1/target').props.visual.rows.length, 2, 'menu filters wait for the ⋯ menu');
  assert.deepEqual(ui.opened, []);
  assert.equal(ui.cards().length, 4, 'no navigation happened');
});

test('select-activated filter applies to target visual pinned rows', async t => {
  const ui = await mount(t, fixture());
  await ui.select('test/s1/source', { values: { region: 'East' } });
  assert.deepEqual(ui.cardFor('test/s1/target').props.visual.rows, [{ region: 'East', revenue: 100 }]);
  assert.equal(ui.cardFor('test/s1/source').props.visual.rows.length, 2, 'the source visual is not its own target');
});

test('menu-option filter applies from the ⋯ menu and toggles back off', async t => {
  const ui = await mount(t, fixture({ filterActions: [menuFilter] }));
  await ui.select('test/s1/source', { values: { region: 'East' } });
  assert.equal(ui.cardFor('test/s1/target').props.visual.rows.length, 2, 'menu filter waits for the menu');
  const menu = () => ui.menus().find(m => m.props.items.some(i => i.id === 'f2'));
  await act(() => menu().props.onInvoke(menuFilter));
  assert.deepEqual(ui.cardFor('test/s1/target').props.visual.rows, [{ region: 'East', revenue: 100 }]);
  await act(() => menu().props.onInvoke(menuFilter));
  assert.equal(ui.cardFor('test/s1/target').props.visual.rows.length, 2);
});

test('unmappable filter column surfaces a problem note instead of filtering silently', async t => {
  const ui = await mount(t, fixture());
  await ui.select('test/s1/source', { values: { region: 'East' } });
  const pie = ui.cardFor('test/s1/pie');
  assert.match(pie.props.actionNote ?? '', /FILTER_COLUMN_UNMAPPED: region is not a pinned result column for this visual/);
  assert.equal(pie.props.visual.rows.length, 2, 'rows are never filtered when the column cannot be mapped');
});

test('Reset actions clears selections and restores pinned rows', async t => {
  const ui = await mount(t, fixture());
  const reset = () => ui.renderer.root.findAllByType('button').find(b => b.children?.includes('Reset actions'));
  assert.equal(reset().props.disabled, true, 'disabled with no active selections');
  await ui.select('test/s1/source', { values: { region: 'East' } });
  assert.equal(reset().props.disabled, false);
  const status = ui.renderer.root.findAllByType('span').find(s => s.props.role === 'status' && typeof s.children?.join === 'function' && s.children.join('').includes('active selection'));
  assert.match(status.children.join(''), /1 active selection\(s\) revenue-by-region: region = East/);
  assert.match(status.children.join(''), /Filters apply to pinned rows locally; no queries run/);
  await act(() => reset().props.onClick());
  assert.equal(ui.cardFor('test/s1/target').props.visual.rows.length, 2);
  assert.equal(reset().props.disabled, true);
});
