import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

async function mount(t, initial = emptyDraft(), viewportWidth = 1440) {
  const oldWindow = globalThis.window, oldAct = globalThis.IS_REACT_ACT_ENVIRONMENT;
  const listeners = new Set();
  const queries = new Map();
  globalThis.window = { matchMedia: query => {
    if (!queries.has(query)) {
      const maxWidth = Number(query.match(/max-width: (\d+)px/)[1]);
      const media = { maxWidth, matches: viewportWidth <= maxWidth,
        addEventListener: (_, fn) => listeners.add({ media, fn }),
        removeEventListener: (_, fn) => { for (const listener of listeners) if (listener.fn === fn) listeners.delete(listener); },
      };
      queries.set(query, media);
    }
    return queries.get(query);
  } };
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
    viewport: async width => {
      viewportWidth = width;
      await act(() => {
        for (const media of queries.values()) {
          const matches = width <= media.maxWidth;
          if (matches === media.matches) continue;
          media.matches = matches;
          for (const listener of listeners) if (listener.media === media) listener.fn();
        }
      });
    },
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
  await ui.viewport(1100);
  for (const name of ['fields', 'build', 'properties']) assert.equal(ui.panel(name).props.open, false);
  await act(() => ui.panel('build').props.onToggle({ currentTarget: { open: true } }));
  assert.equal(ui.panel('build').props.open, true);
  assert.equal(ui.panel('build').find(n => n.props.className === 'visual-config').props.id, 'configure-visual-2');
  assert.equal(ui.state(), initial);
  await ui.viewport(1440);
  for (const name of ['fields', 'build', 'properties']) assert.equal(ui.panel(name).props.open, true);
  assert.equal(ui.state(), initial);
});

test('narrow screens initially collapse all three control panels while retaining the sheet', async t => {
  const ui = await mount(t, emptyDraft(), 390);
  // Check the initial render before effects: native details must not emit an
  // opening toggle that races the narrow-screen default during browser mount.
  const html = renderToStaticMarkup(createElement(AuthorCanvas, { draft: emptyDraft(), dispatch() {} }));
  assert.doesNotMatch(html, /<details class="builder-panel [^"]+" open/);
  for (const name of ['fields', 'build', 'properties']) assert.equal(ui.panel(name).props.open, false);
  assert.ok(ui.find('div', p => p.className === 'author-canvas'));
});

test('laptop defaults keep Data and Visuals open and Properties docked closed without changing the draft', async t => {
  const initial = twoVisuals(), ui = await mount(t, initial, 1280);
  const html = renderToStaticMarkup(createElement(AuthorCanvas, { draft: initial, dispatch() {} }));
  assert.match(html, /<details class="builder-panel fields-panel" open/);
  assert.match(html, /<details class="builder-panel build-panel" open/);
  assert.doesNotMatch(html, /<details class="builder-panel properties-panel" open/);
  for (const name of ['fields', 'build']) assert.equal(ui.panel(name).props.open, true);
  assert.equal(ui.panel('properties').props.open, false);
  await act(() => ui.panel('properties').props.onToggle({ currentTarget: { open: true } }));
  await ui.viewport(1366);
  assert.equal(ui.panel('properties').props.open, true, 'resizing within a breakpoint preserves the user choice');
  assert.equal(ui.panel('properties').findAllByType('input').find(n => n.props.placeholder === 'Generated from fields').props.value, 'Regional detail');
  await ui.viewport(1400);
  for (const name of ['fields', 'build', 'properties']) assert.equal(ui.panel(name).props.open, true);
  await ui.viewport(1399);
  assert.equal(ui.panel('properties').props.open, false);
  for (const name of ['fields', 'build']) assert.equal(ui.panel(name).props.open, true);
  assert.equal(ui.state(), initial);
});

// Renderer tests do not apply CSS. Check the stylesheet contract here as well;
// the offline demo's browser checks validate the actual geometry and scrolling.
const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
function rule(selector) {
  const start = css.indexOf(`${selector} {`);
  assert.ok(start >= 0, `Missing layout rule: ${selector}`);
  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));
  return Object.fromEntries(body.split(';').filter(s => s.trim()).map(s => s.trim().split(/:\s*(.*)/s).slice(0, 2)));
}

test('desktop tracks reserve most of the default workspace for the sheet and return closed-panel space', () => {
  const layout = rule('.author-layout');
  assert.equal(rule('main.author-main')['max-width'], 'none');
  assert.equal(layout.display, 'grid');
  assert.equal(layout['grid-template-columns'], 'var(--data-width) var(--build-width) minmax(0, 1fr) var(--properties-width)');
  const rails = [['fields', 'data'], ['build', 'build'], ['properties', 'properties']].map(([panel, track]) => {
    const open = parseFloat(layout[`--${track}-width`]);
    const closed = parseFloat(rule(`.author-layout:has(> .${panel}-panel:not([open]))`)[`--${track}-width`]);
    assert.ok(closed >= 40 && closed <= 48, `${panel} retains an accessible compact rail`);
    assert.ok(open > closed, `${panel} returns space to the sheet when closed`);
    return { open, closed };
  });
  for (const width of [1101, 1280, 1366, 1399, 1400, 1440, 1920]) {
    const workspace = width - 2 * parseFloat(rule('main.author-main').padding);
    const supportingWidth = rails.reduce((sum, rail, i) => sum + (i === 2 && width < 1400 ? rail.closed : rail.open), 0);
    const sheetWidth = workspace - supportingWidth - 3 * parseFloat(layout.gap);
    assert.ok(sheetWidth > workspace / 2, `Sheet occupies the majority at ${width}px`);
  }
});

test('panels and gallery scroll in their docks, headings remain reachable, and actual-size canvas scroll stays contained', () => {
  const panel = rule('.builder-panel');
  assert.equal(panel.position, 'sticky');
  assert.ok(parseFloat(panel.top) >= 0);
  assert.equal(panel.overflow, 'auto');
  assert.match(panel['max-height'], /100vh/);
  assert.equal(rule('.builder-panel > summary').position, 'sticky');
  assert.equal(rule('.builder-panel > summary').top, '0');
  assert.equal(rule('.visual-gallery').overflow, 'auto');
  assert.ok(parseFloat(rule('.visual-gallery')['max-height']) <= 240);
  assert.equal(rule('.canvas-viewport').overflow, 'auto');
  assert.equal(rule('.canvas-viewport')['min-width'], '0');
  assert.match(css, /@media \(min-width: 1101px\)\s*\{\s*\.builder-panel:not\(\[open\]\) > summary \{ writing-mode: vertical-rl;/);
  assert.match(css, /@media \(max-width: 1100px\)\s*\{\s*\.author-layout \{ display: flex; flex-direction: column; \}/);
});
