import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { create } from 'react-test-renderer';
import { NewSheetDialog, OPTIMIZE_WIDTHS } from '../build/test/NewSheetDialog.js';
import { authorReducer, emptyDraft, activeSheet, layoutSettingsValid, DEFAULT_LAYOUT_SETTINGS } from '../build/test/authoring.js';

async function mount(t, props = {}) {
  const oldAct = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const dispatched = [], actions = [];
  const defaults = { defaultName: 'Sheet 2', defaultWidth: 1600, dispatch: action => dispatched.push(action), onClose: () => actions.push('close') };
  let renderer; await act(() => { renderer = create(createElement(NewSheetDialog, { ...defaults, ...props })); });
  t.after(async () => { await act(() => renderer.unmount()); globalThis.IS_REACT_ACT_ENVIRONMENT = oldAct; });
  const button = name => renderer.root.findAllByType('button').find(b => b.props.children === name);
  return { dispatched, actions, button, get root() { return renderer.root; }, text: () => JSON.stringify(renderer.toJSON()),
    radios: () => renderer.root.findAllByType('input').filter(i => i.props.type === 'radio'),
    selects: () => renderer.root.findAllByType('select'),
    click: name => act(() => button(name).props.onClick()),
    textInput: () => renderer.root.findAllByType('input').find(i => i.props.type !== 'radio'),
    setName: value => act(() => renderer.root.findAllByType('input').find(i => i.props.type !== 'radio').props.onChange({ target: { value } })),
    setSelect: (ariaLabel, value) => act(() => renderer.root.findAllByType('select').find(s => s.props['aria-label'] === ariaLabel).props.onChange({ target: { value } })),
    submit: () => act(() => renderer.root.findByType('form').props.onSubmit({ preventDefault() {} })),
  };
}

test('interactive sheet card is the default; pixel-perfect card is parked and disabled', async t => {
  const ui = await mount(t);
  assert.match(ui.text(), /New sheet/);
  assert.match(ui.text(), /Interactive sheet/);
  assert.match(ui.text(), /Single page, interactive content/);
  const [interactive, pixel] = ui.radios();
  assert.equal(interactive.props.value, 'interactive');
  assert.equal(interactive.props.defaultChecked, true);
  assert.equal(pixel.props.value, 'pixel-perfect');
  assert.equal(pixel.props.disabled, true);
  assert.match(ui.text(), /Pixel-perfect reports are a future polish item and are not built yet/);
  const layouts = ui.selects().find(s => s.props['aria-label'] === 'Layout');
  assert.deepEqual(layouts.props.children.map(o => o.props.value), ['tiled']);
  const widths = ui.selects().find(s => s.props['aria-label'] === 'Optimize for viewing on');
  assert.deepEqual(widths.props.children.map(o => Number(o.props.value)), [...OPTIMIZE_WIDTHS]);
  assert.equal(widths.props.value, '1600');
});

test('create sheet dispatches the name and optimize width, then closes', async t => {
  const ui = await mount(t, { defaultName: 'Sheet 2', defaultWidth: 1920 });
  assert.equal(ui.selects().find(s => s.props['aria-label'] === 'Optimize for viewing on').props.value, '1920');
  ui.setName('  Regional  ');
  ui.setSelect('Optimize for viewing on', '2400');
  await ui.submit();
  assert.deepEqual(ui.dispatched, [{ type: 'sheet-add', name: '  Regional  ', settings: { ...DEFAULT_LAYOUT_SETTINGS(), optimizeWidth: 2400 } }]);
  assert.deepEqual(ui.actions, ['close']);
});

test('cancel and Escape close without dispatching', async t => {
  const ui = await mount(t);
  await ui.click('Cancel');
  assert.deepEqual(ui.dispatched, []);
  assert.deepEqual(ui.actions, ['close']);
  let prevented = false;
  await act(() => ui.root.findByType('dialog').props.onCancel({ preventDefault() { prevented = true; } }));
  assert.ok(prevented);
  assert.deepEqual(ui.actions, ['close', 'close']);
});

test('sheet-add honors name and settings; falls back on blank name or invalid settings', () => {
  let draft = authorReducer(emptyDraft(), { type: 'sheet-add', name: 'Regional', settings: { rowHeight: 42, margin: 12, optimizeWidth: 1920 } });
  let sheet = activeSheet(draft);
  assert.equal(sheet.name, 'Regional');
  assert.deepEqual(sheet.layoutSettings, { rowHeight: 42, margin: 12, optimizeWidth: 1920 });
  draft = authorReducer(draft, { type: 'sheet-add', name: '   ', settings: { rowHeight: 42, margin: 12, optimizeWidth: 99999 } });
  sheet = activeSheet(draft);
  assert.match(sheet.name, /^Sheet \d+$/);
  assert.equal(sheet.layoutSettings, undefined);
});

test('layoutSettingsValid accepts or rejects optimizeWidth honestly', () => {
  assert.ok(layoutSettingsValid({ rowHeight: 42, margin: 12 }));
  assert.ok(layoutSettingsValid({ rowHeight: 42, margin: 12, optimizeWidth: 1600 }));
  assert.ok(!layoutSettingsValid({ rowHeight: 42, margin: 12, optimizeWidth: 100 }));
  assert.ok(!layoutSettingsValid({ rowHeight: 42, margin: 12, optimizeWidth: 5000 }));
  assert.ok(!layoutSettingsValid({ rowHeight: 42, margin: 12, optimizeWidth: 1600.5 }));
  assert.ok(!layoutSettingsValid({ rowHeight: 42, margin: 12, optimizeWidth: '1600' }));
});
