import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { create } from 'react-test-renderer';
import { AuthorToolbar } from '../build/test/AuthorToolbar.js';
import { AuthorMenuItem } from '../build/test/AuthorMenuItem.js';
import { authorReducer, emptyDraft } from '../build/test/authoring.js';

async function mount(t, overrides = {}) {
  const previous = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const calls = [];
  const props = { draft: authorReducer(emptyDraft(), { type: 'add', kind: 'bar' }), dispatch: action => calls.push(action), fit: true,
    onFit: () => calls.push('fit'), onJson: () => calls.push('json'), onBundle: () => calls.push('bundle'), onImport: () => calls.push('import'), ...overrides };
  let renderer;
  await act(() => { renderer = create(createElement(AuthorToolbar, props)); });
  t.after(async () => { await act(() => renderer.unmount()); globalThis.IS_REACT_ACT_ENVIRONMENT = previous; });
  const menu = name => renderer.root.findAllByType('details').find(n => n.findByType('summary').props.children === name);
  const item = (name, label) => menu(name).findAllByType(AuthorMenuItem).find(n => n.props.label === label).findByType('button');
  return { renderer, calls, props, menu, item,
    labels: name => menu(name).findAllByType(AuthorMenuItem).map(n => n.props.label),
    click: (name, label) => act(() => item(name, label).props.onClick()),
    update: updates => act(() => renderer.update(createElement(AuthorToolbar, { ...props, ...updates }))),
  };
}

test('File follows reference order and retains definition downloads behind Exports', async t => {
  const ui = await mount(t);
  assert.deepEqual(ui.labels('File'), ['Add to Favorites', 'Publish', 'Save as Analysis', 'Share', 'Rename', 'Import', 'Print', 'Exports', 'Export to PDF', 'Autosave On']);
  await ui.click('File', 'Import'); await ui.click('File', 'Exports');
  await ui.click('File', 'Download .qs'); await ui.click('File', 'Export JSON');
  assert.deepEqual(ui.calls, ['import', 'bundle', 'json']);
  assert.equal(ui.item('File', 'Exports').props['data-menu-keep-open'], true);
  await ui.click('File', 'Publish');
  assert.match(JSON.stringify(ui.renderer.toJSON()), /This static demo has no publication destination/);
  const autosave = ui.item('File', 'Autosave On');
  assert.equal(autosave.props['aria-checked'], true);
  assert.match(autosave.props.title, /always on.*not synced or shared/);
});

test('File unavailable items expose reasons and cannot invoke actions; export/import busy guards hold', async t => {
  const ui = await mount(t);
  for (const label of ['Add to Favorites', 'Save as Analysis', 'Share', 'Print', 'Export to PDF', 'Autosave On']) {
    const button = ui.item('File', label);
    assert.equal(button.props['aria-disabled'], true, label);
    assert.ok(button.props.title.length > 10);
    assert.equal(ui.menu('File').findByProps({ id: button.props['aria-describedby'] }).props.children, button.props.title);
    await ui.click('File', label);
  }
  assert.deepEqual(ui.calls, []);
  await ui.click('File', 'Exports');
  await ui.update({ busy: true, jsonDisabled: true, autosaveError: 'Browser storage is blocked.' });
  for (const label of ['Import', 'Download .qs', 'Export JSON']) { assert.equal(ui.item('File', label).props['aria-disabled'], true); await ui.click('File', label); }
  assert.deepEqual(ui.calls, []);
  assert.match(ui.item('File', 'Autosave On').props.title, /could not save.*Browser storage is blocked/);
});
