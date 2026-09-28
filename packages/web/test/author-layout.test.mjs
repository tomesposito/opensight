import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement, useReducer } from 'react';
import { create } from 'react-test-renderer';
import { renderToStaticMarkup } from 'react-dom/server';
import { AuthorCanvas } from '../build/test/Author.js';
import { activeSheet, authorReducer, emptyDraft } from '../build/test/authoring.js';

const edit = (draft, ...actions) => actions.reduce(authorReducer, draft);
const twoVisuals = () => edit(emptyDraft(),
  { type: 'add', kind: 'bar' }, { type: 'title', title: 'Sales by category' },
  { type: 'assign', field: 'category', well: 'dimension' },
  { type: 'add', kind: 'pivot' }, { type: 'title', title: 'Regional detail' });

async function mount(t, initial = emptyDraft(), narrow = false) {
  const oldWindow = globalThis.window, oldAct = globalThis.IS_REACT_ACT_ENVIRONMENT;
  const listeners = new Set();
  const media = { matches: narrow, addEventListener: (_, fn) => listeners.add(fn), removeEventListener: (_, fn) => listeners.delete(fn) };
  globalThis.window = { matchMedia: () => media };
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let renderer, draft;
  function Harness() {
    const [state, dispatch] = useReducer(authorReducer, initial);
    draft = state;
    return createElement(AuthorCanvas, { draft, dispatch });
  }
  await act(() => { renderer = create(createElement(Harness)); });
  t.after(async () => {
    await act(() => renderer.unmount());
    globalThis.window = oldWindow; globalThis.IS_REACT_ACT_ENVIRONMENT = oldAct;
    assert.equal(listeners.size, 0);
  });
  const find = (type, predicate) => renderer.root.findAllByType(type).find(n => predicate(n.props));
  return { renderer, state: () => draft, find,
    panel: name => find('details', p => p.className === `builder-panel ${name}-panel`),
    click: async label => {
      const button = find('button', p => p['aria-label'] === label || p.children === label);
      assert.ok(button, label);
      await act(() => button.props.onClick({ stopPropagation() {} }));
    },
    viewport: async matches => { media.matches = matches; await act(() => listeners.forEach(fn => fn())); },
  };
}

test('author regions read Data → Visuals with wells → sheet → Properties with no controls inside the canvas', async t => {
  const ui = await mount(t, twoVisuals());
  const layout = ui.find('div', p => p.className === 'author-layout');
  const regions = layout.children.map(node => typeof node.type === 'string' ? node : node.findByType('details'));
  assert.deepEqual(regions.map(n => n.props.className), [
    'builder-panel fields-panel', 'builder-panel build-panel', 'author-center', 'builder-panel properties-panel',
  ]);
  const [data, visuals, sheet, properties] = regions;
  assert.equal(data.findAllByType('select')[0].props['aria-label'], 'Dataset');
  assert.ok(data.findAllByType('button').some(n => n.props['aria-label'] === 'Assign revenue'));
  const content = visuals.find(n => n.props.className === 'panel-content');
  assert.deepEqual(content.children.map(n => n.props.className), ['add-visual', 'visual-config']);
  assert.equal(visuals.findAll(n => n.props.className === 'field-wells').length, 1);
  assert.equal(sheet.props['aria-label'], 'Analysis sheet');
  assert.equal(sheet.findAll(n => n.props.className === 'sheet-toolbar').length, 1);
  assert.equal(sheet.findAll(n => ['builder-panel', 'visual-gallery', 'field-wells'].some(c => n.props.className?.split(' ').includes(c))).length, 0);
  assert.equal(properties.findAllByType('input').find(n => n.props.placeholder === 'Generated from fields').props.value, 'Regional detail');
});

test('card selection keeps docked wells, Data assignments and Properties on the same visual', async t => {
  const ui = await mount(t, twoVisuals());
  const card = ui.find('section', p => p['aria-label'] === 'Sales by category');
  await act(() => card.props.onClick());
  assert.equal(activeSheet(ui.state()).selectedId, 'visual-1');
  assert.equal(ui.panel('build').find(n => n.props.className === 'visual-config').props.id, 'configure-visual-1');
  assert.equal(ui.panel('build').find(n => n.props.className === 'selected-visual').props.children, 'Sales by category');
  assert.ok(ui.panel('build').findAllByType('button').some(n => n.props['aria-label'] === 'Remove category from Category'));
  assert.equal(ui.panel('properties').findAllByType('input').find(n => n.props.placeholder === 'Generated from fields').props.value, 'Sales by category');
  await ui.click('Assign profit');
  assert.deepEqual(activeSheet(ui.state()).visuals.map(v => v.measures), [['revenue', 'profit'], ['revenue']]);
  const configure = ui.find('button', p => p['aria-expanded'] === false);
  await act(() => configure.props.onClick());
  assert.equal(ui.panel('build').find(n => n.props.className === 'visual-config').props.id, 'configure-visual-2');
  const columns = ui.panel('build').findAllByType('fieldset').find(n => n.findByType('legend').props.children[0] === 'Columns');
  await act(() => columns.props.onFocus());
  await ui.click('Assign category');
  assert.deepEqual(activeSheet(ui.state()).visuals[1].columns, ['category']);
  assert.equal(activeSheet(ui.state()).visuals[0].dimension, 'category');
});

test('sheet switches and removal refresh docked editors and the empty-state assignment guard', async t => {
  const ui = await mount(t, twoVisuals());
  await ui.click('+ Add sheet');
  assert.equal(ui.panel('build').findAll(n => n.props.className === 'visual-config').length, 0);
  assert.equal(ui.find('button', p => p['aria-label'] === 'Assign revenue').props.disabled, true);
  assert.ok(ui.panel('properties').findAllByType('p').some(n => n.props.children === 'Select a visual to edit its display settings.'));
  await ui.click('Sheet 1');
  assert.equal(ui.panel('build').find(n => n.props.className === 'visual-config').props.id, 'configure-visual-2');
  await ui.click('Remove Regional detail');
  assert.equal(ui.panel('build').find(n => n.props.className === 'visual-config').props.id, 'configure-visual-1');
  await ui.click('Remove Sales by category');
  assert.equal(ui.panel('build').findAllByType('fieldset').length, 0);
  assert.equal(ui.find('button', p => p['aria-label'] === 'Assign revenue').props.disabled, true);
});

test('panel disclosure and narrow-screen defaults do not mutate sheet selection or saved layout', async t => {
  const initial = twoVisuals(), ui = await mount(t, initial);
  for (const name of ['fields', 'build', 'properties']) assert.equal(ui.panel(name).props.open, true);
  await act(() => ui.panel('build').props.onToggle({ currentTarget: { open: false } }));
  assert.equal(ui.panel('build').props.open, false);
  assert.equal(ui.panel('fields').props.open, true);
  assert.equal(ui.panel('properties').props.open, true);
  await ui.viewport(true);
  for (const name of ['fields', 'build', 'properties']) assert.equal(ui.panel(name).props.open, false);
  await act(() => ui.panel('build').props.onToggle({ currentTarget: { open: true } }));
  assert.equal(ui.panel('build').props.open, true);
  assert.equal(ui.panel('build').find(n => n.props.className === 'visual-config').props.id, 'configure-visual-2');
  assert.equal(ui.state(), initial);
  await ui.viewport(false);
  for (const name of ['fields', 'build', 'properties']) assert.equal(ui.panel(name).props.open, true);
  assert.equal(ui.state(), initial);
});

test('narrow screens initially collapse all three control panels while retaining the sheet', async t => {
  const ui = await mount(t, emptyDraft(), true);
  // Check the initial render before effects: native details must not emit an
  // opening toggle that races the narrow-screen default during browser mount.
  const html = renderToStaticMarkup(createElement(AuthorCanvas, { draft: emptyDraft(), dispatch() {} }));
  assert.doesNotMatch(html, /<details class="builder-panel [^"]+" open/);
  for (const name of ['fields', 'build', 'properties']) assert.equal(ui.panel(name).props.open, false);
  assert.ok(ui.find('div', p => p.className === 'author-canvas'));
});
