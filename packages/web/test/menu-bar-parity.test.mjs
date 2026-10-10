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
    labels: name => menu(name).findAllByType(AuthorMenuItem).filter(n => !n.parent?.props.hidden).map(n => n.props.label),
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

test('Edit has Themes, real settings and unavailable empty history', async t => {
  const ui = await mount(t);
  assert.deepEqual(ui.labels('Edit'), ['Undo', 'Redo', 'Themes', 'Analysis Settings']);
  assert.equal(ui.item('Edit', 'Themes').props['aria-disabled'], false);
  for (const label of ['Undo', 'Redo']) {
    assert.equal(ui.item('Edit', label).props['aria-disabled'], true);
    await ui.click('Edit', label);
  }
  assert.deepEqual(ui.calls, []);
  await ui.update({ canUndo: true, canRedo: true, onUndo: () => ui.calls.push('undo'), onRedo: () => ui.calls.push('redo') });
  await ui.click('Edit', 'Undo'); await ui.click('Edit', 'Redo');
  assert.deepEqual(ui.calls, ['undo', 'redo']);
  await ui.update({ dataAvailable: false });
  assert.equal(ui.item('Edit', 'Analysis Settings').props['aria-disabled'], false);
  await ui.click('Edit', 'Analysis Settings');
  assert.equal(ui.renderer.root.findByType('dialog').findByType('h2').props.children, 'Analysis Settings');
  assert.match(ui.item('Edit', 'Themes').props.title, /Add data/);
});

test('control focus opens nested sections and their dock, switches tabs, and tolerates missing DOM', async () => {
  const { focusAuthorControl } = await import('../build/test/AuthorToolbar.js');
  const calls = [], outer = { open: false }, inner = { open: false, parentElement: { closest: () => outer } };
  const target = { closest: () => inner, focus: () => calls.push('focus'), scrollIntoView: () => calls.push('scroll') };
  const workspace = { querySelector: selector => selector.includes('data-properties-tab') ? { click: () => calls.push('tab') } : target };
  assert.equal(focusAuthorControl({ closest: () => workspace }, '[data-author-control="theme"]', 'Visual'), target);
  assert.deepEqual(calls, ['tab', 'scroll', 'focus']);
  assert.equal(inner.open, true); assert.equal(outer.open, true);
  assert.doesNotThrow(() => focusAuthorControl(null, 'missing'));
  assert.doesNotThrow(() => focusAuthorControl({}, 'missing'));
});

test('Data exposes all reference actions, retains preparation, and routes Add data to sources', async t => {
  const calls = [];
  const ui = await mount(t, { onSources: () => calls.push('sources'), onPrep: () => calls.push('prep') });
  assert.deepEqual(ui.labels('Data'), ['Data', 'Add data', 'Add Calculated Field', 'Parameters', 'Add Parameter', 'Prepare data…']);
  await ui.click('Data', 'Add data'); await ui.click('Data', 'Prepare data…');
  assert.deepEqual(calls, ['sources', 'prep']);
  await ui.update({ onSources: undefined }); await ui.click('Data', 'Add data');
  assert.deepEqual(calls, ['sources', 'prep', 'prep']);
  await ui.update({ dataAvailable: false, onSources: undefined, onPrep: undefined });
  for (const label of ['Add data', 'Add Calculated Field', 'Parameters', 'Add Parameter']) {
    assert.equal(ui.item('Data', label).props['aria-disabled'], true); assert.ok(ui.item('Data', label).props.title);
  }
  assert.equal(ui.item('Data', 'Data').props['aria-disabled'], false, 'the empty data dock is still available');
});

test('Insert adds sheets, visuals and insights through the reducer and guards unavailable editors', async t => {
  const ui = await mount(t, { oEntry: createElement('button', { className: 'q-trigger' }, 'Q') });
  assert.deepEqual(ui.labels('Insert'), ['Add Sheet', 'Add Visual', 'Add Text', 'Add Image', 'Add Insight', 'Build visual with Q', 'Add Calculated Field', 'Add Filter', 'Add Parameter']);
  for (const label of ['Add Sheet', 'Add Visual', 'Add Insight']) await ui.click('Insert', label);
  assert.deepEqual(ui.calls, [{ type: 'sheet-add' }, { type: 'add', kind: 'bar' }, { type: 'add', kind: 'insight' }]);
  assert.equal(ui.item('Insert', 'Build visual with Q').props['aria-disabled'], false);
  for (const label of ['Add Text', 'Add Image']) assert.equal(ui.item('Insert', label).props['aria-disabled'], true);
  await ui.update({ draft: emptyDraft(), oEntry: undefined });
  assert.match(ui.item('Insert', 'Add Filter').props.title, /Select a visual/);
  assert.match(ui.item('Insert', 'Build visual with Q').props.title, /unavailable/);
  await ui.update({ dataAvailable: false });
  for (const label of ['Add Visual', 'Add Insight', 'Build visual with Q', 'Add Calculated Field', 'Add Filter', 'Add Parameter']) {
    assert.equal(ui.item('Insert', label).props['aria-disabled'], true);
    await ui.click('Insert', label);
  }
  assert.equal(ui.calls.length, 3, 'disabled insert actions do not dispatch');
});

test('Sheets retains add and switching, offers rename, and explains unsupported sheet features', async t => {
  const draft = authorReducer(emptyDraft(), { type: 'sheet-add' });
  const ui = await mount(t, { draft });
  assert.deepEqual(ui.labels('Sheets'), ['Add Sheet', 'Duplicate Sheet', 'Rename Sheet', 'Add Title', 'Add Description', 'Layout Settings', 'Sheet 1', 'Sheet 2']);
  await ui.click('Sheets', 'Add Sheet'); await ui.click('Sheets', 'Sheet 1');
  assert.deepEqual(ui.calls, [{ type: 'sheet-add' }, { type: 'sheet-select', id: 'sheet-1' }]);
  for (const label of ['Duplicate Sheet', 'Add Title', 'Add Description', 'Layout Settings']) {
    assert.equal(ui.item('Sheets', label).props['aria-disabled'], true); assert.match(ui.item('Sheets', label).props.title, /not supported/);
    await ui.click('Sheets', label);
  }
  assert.equal(ui.calls.length, 2);
  await ui.update({ dataAvailable: false });
  assert.equal(ui.item('Sheets', 'Rename Sheet').props['aria-disabled'], false, 'sheet tabs also exist before adding data');
});

const objectItems = ['Format Object', 'Field Wells', 'Title', 'Subtitle', 'Data Labels', 'Legend', 'Conditional Formatting', 'Tooltips', 'Highlights', 'Reference Lines', 'Actions', 'Placement', 'Style', 'Rules', 'Forecast', 'Anomaly', 'Export Visual to CSV', 'Export Table to Excel'];
test('Objects exposes every reference item, retains selection/removal and gates absent visual capabilities', async t => {
  const ui = await mount(t);
  assert.deepEqual(ui.labels('Objects').slice(0, 18), objectItems);
  for (const label of ['Format Object', 'Field Wells', 'Title', 'Subtitle', 'Data Labels', 'Legend', 'Conditional Formatting', 'Actions']) assert.equal(ui.item('Objects', label).props['aria-disabled'], false, label);
  for (const label of ['Tooltips', 'Highlights', 'Reference Lines', 'Placement', 'Style', 'Rules', 'Forecast', 'Anomaly', 'Export Visual to CSV', 'Export Table to Excel']) {
    assert.equal(ui.item('Objects', label).props['aria-disabled'], true); assert.match(ui.item('Objects', label).props.title, /not supported/);
    await ui.click('Objects', label);
  }
  await ui.click('Objects', 'visual-1 · bar'); await ui.click('Objects', 'Remove selected visual');
  assert.deepEqual(ui.calls, [{ type: 'select', id: 'visual-1' }, { type: 'remove', id: 'visual-1' }]);
  await ui.update({ draft: authorReducer(emptyDraft(), { type: 'add', kind: 'table' }) });
  for (const label of ['Data Labels', 'Legend']) assert.match(ui.item('Objects', label).props.title, /this visual type/);
  await ui.update({ draft: emptyDraft() });
  for (const label of objectItems) { assert.equal(ui.item('Objects', label).props['aria-disabled'], true); assert.match(ui.item('Objects', label).props.title, /Select a visual/); }
});

test('Print calls the browser action, PDF explains its destination and Cancel never prints', async t => {
  let prints = 0;
  const ui = await mount(t, { onPrint: () => prints++ });
  await ui.click('File', 'Print'); assert.equal(prints, 1);
  await ui.click('File', 'Export to PDF');
  let dialog = ui.renderer.root.findByType('dialog');
  assert.match(JSON.stringify(ui.renderer.toJSON()), /Save as PDF.*current sheet.*visible table rows/);
  assert.equal(prints, 1);
  await act(() => dialog.findAllByType('button').find(b => b.props.children === 'Cancel').props.onClick());
  assert.equal(ui.renderer.root.findAllByType('dialog').length, 0); assert.equal(prints, 1);
  await ui.click('File', 'Export to PDF'); dialog = ui.renderer.root.findByType('dialog');
  await act(() => dialog.findAllByType('button').find(b => b.props.children === 'Continue to Save as PDF').props.onClick());
  assert.equal(prints, 2); assert.equal(ui.renderer.root.findAllByType('dialog').length, 0);
  await ui.update({ busy: true });
  for (const label of ['Print', 'Export to PDF', 'Save as Analysis']) {
    assert.equal(ui.item('File', label).props['aria-disabled'], true); await ui.click('File', label);
  }
  assert.equal(prints, 2);
});

test('disabled reasons stay expanded until closing so focus transfer cannot move the next click target', async t => {
  const ui = await mount(t);
  const item = ui.menu('Edit').findAllByType(AuthorMenuItem).find(node => node.props.label === 'Undo');
  const wrapper = () => item.findByProps({ className: 'author-menu-item' });
  assert.equal(wrapper().props['data-reason-revealed'], undefined);
  await act(() => wrapper().props.onFocus()); assert.equal(wrapper().props['data-reason-revealed'], true);
  await ui.click('Edit', 'Undo'); assert.deepEqual(ui.calls, []);
  await ui.click('Edit', 'Analysis Settings'); assert.equal(ui.renderer.root.findByType('dialog').findByType('h2').props.children, 'Analysis Settings');
  assert.equal(wrapper().props['data-reason-revealed'], true);
  await act(() => ui.menu('Edit').props.onToggle({ currentTarget: { open: false } }));
  assert.equal(wrapper().props['data-reason-revealed'], undefined);
  await act(() => wrapper().props.onPointerEnter()); assert.equal(wrapper().props['data-reason-revealed'], true);
});
