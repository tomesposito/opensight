import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement, useMemo } from 'react';
import { fuzzyScore, filterCommands, navigationCommands } from '../build/test/command-palette.js';
import { CommandPaletteProvider, usePaletteCommands } from '../build/test/CommandPalette.js';
import { ToastProvider } from '../build/test/Toasts.js';
import { AppNavigation } from '../build/test/AppNavigation.js';
import { demoAccess } from '../build/test/access.js';
import { mountPalette } from './command-palette-helpers.mjs';

const commands = ['Go to Home', 'Go to Analyses', 'Save draft', 'Go to sheet: Revenue'].map(label => ({ id: label, label, run() {} }));
test('fuzzy matching handles empty, case-insensitive, trimmed, subsequence and missing queries', () => {
  assert.deepEqual(filterCommands(commands, '  '), commands);
  assert.deepEqual(filterCommands(commands, '  SAVE  ').map(c => c.label), ['Save draft']);
  assert.deepEqual(filterCommands(commands, 'gtsr').map(c => c.label), ['Go to sheet: Revenue']);
  assert.deepEqual(filterCommands(commands, 'zzzz'), []);
  assert.equal(fuzzyScore('', 'word'), undefined);
  assert.notEqual(fuzzyScore('Go to sheet: Résumé', 'rés'), undefined);
  assert.notEqual(fuzzyScore('Go to sheet: 東京', '東京'), undefined);
});
test('substring and word-boundary bonuses rank results with stable ties and searchable aliases', () => {
  assert.ok(fuzzyScore('Save draft', 'save') > fuzzyScore('Some active view', 'save'));
  assert.ok(fuzzyScore('Go to Home', 'home') > fuzzyScore('Go to homes', 'ome'));
  const tied = [{ id: 'a', label: 'Sheet', run() {} }, { id: 'b', label: 'Sheet', run() {} }];
  assert.deepEqual(filterCommands(tied, 's'), tied);
  assert.equal(filterCommands([{ ...commands[0], keywords: 'dashboard' }], 'dashboard').length, 1);
});
test('navigation commands use existing destinations and hide routes denied to readers', () => {
  const calls = [], all = navigationCommands(demoAccess, route => calls.push(route));
  assert.deepEqual(all.map(c => c.label), ['Go to Home', 'Go to Analyses', 'Go to Data', 'Go to Admin', 'Go to Author']);
  all.forEach(c => c.run());
  assert.deepEqual(calls.map(c => c.page), ['home', 'analyses', 'data-prep', 'security', 'author']);
  const reader = { mode: 'hosted', session: { role: 'reader' } };
  assert.deepEqual(navigationCommands(reader, () => {}).map(c => c.label), ['Go to Home', 'Go to Admin']);
});
for (const modifier of ['metaKey', 'ctrlKey']) test(`${modifier}+K opens a labelled modal with active option, and Escape restores focus`, async t => {
  const ui = await mountPalette(t);
  assert.equal((await ui.open(modifier)).defaultPrevented, true);
  const dialog = ui.renderer.root.findByType('dialog'), input = ui.input();
  assert.equal(dialog.props.role, 'dialog'); assert.equal(dialog.props['aria-modal'], 'true');
  assert.equal(dialog.findByProps({ id: dialog.props['aria-labelledby'] }).props.children, 'Command palette');
  assert.equal(dialog.findByProps({ htmlFor: input.props.id }).props.children, 'Search commands');
  assert.equal(dialog.findByProps({ id: input.props['aria-controls'] }).props.role, 'listbox');
  assert.equal(input.props['aria-activedescendant'], ui.options()[0].props.id);
  assert.equal(ui.document.activeElement, ui.search);
  assert.equal((await ui.key('Escape')).defaultPrevented, false, 'native dialog cancel owns Escape');
  await ui.cancel(); assert.equal(ui.document.activeElement, ui.trigger);
  assert.equal(ui.renderer.root.findAllByType('dialog').length, 0); assert.deepEqual(ui.messages(), []);
});
test('arrows wrap, filtering resets selection, Enter navigates and each open starts fresh', async t => {
  const ui = await mountPalette(t);
  await ui.open(); await ui.press('ArrowUp'); assert.equal(ui.selected(), ui.labels().at(-1));
  await ui.press('ArrowDown'); assert.equal(ui.selected(), ui.labels()[0]);
  await ui.press('ArrowDown'); assert.equal(ui.selected(), ui.labels()[1]);
  await ui.filter('go to data'); assert.equal(ui.selected(), 'Go to Data');
  await ui.press('Enter');
  assert.equal(globalThis.window.location.hash, '#/data/preparation');
  assert.equal(ui.document.activeElement, ui.trigger);
  await ui.open(); assert.equal(ui.input().props.value, ''); assert.equal(ui.selected(), 'Go to Home');
});
test('no-result arrows and Enter do nothing; repeated, composing and modified Enter do not execute', async t => {
  const ui = await mountPalette(t); await ui.open(); await ui.filter('impossible-zxw');
  assert.deepEqual(ui.labels(), []); assert.equal(ui.input().props['aria-activedescendant'], undefined);
  await ui.press('ArrowDown'); await ui.press('ArrowUp'); await ui.press('Enter'); assert.ok(ui.input());
  await ui.filter('Save draft');
  for (const flags of [{ repeat: true }, { nativeEvent: { isComposing: true } }, { keyCode: 229 }, { metaKey: true }, { altKey: true }, { ctrlKey: true }, { shiftKey: true }]) await ui.press('Enter', flags);
  await act(() => ui.input().props.onCompositionStart()); await ui.press('Enter');
  assert.equal(ui.saved(), undefined);
  await act(() => ui.input().props.onCompositionEnd()); await ui.press('Enter'); assert.ok(ui.saved());
});
test('pointer selection runs only its command; Close restores focus without running anything', async t => {
  const ui = await mountPalette(t); await ui.open(); await ui.click('Close command palette');
  assert.equal(ui.document.activeElement, ui.trigger); assert.equal(ui.saved(), undefined);
  await ui.open(); await ui.run('Save draft'); assert.ok(ui.saved()); assert.equal(ui.document.activeElement, ui.trigger);
  assert.deepEqual(ui.messages(), ['Draft saved']);
});
test('Author commands use the latest save path, NEW LOOK action, and current sheet list', async t => {
  const ui = await mountPalette(t);
  const edit = title => act(() => ui.renderer.root.findByProps({ className: 'analysis-title' }).findByType('input').props.onChange({ target: { value: title } }));
  await edit('First'); await ui.open(); await ui.run('Save draft'); const id = ui.saved().id;
  await edit('Latest'); await ui.open(); await ui.filter('Save draft'); await ui.press('Enter');
  assert.equal(ui.saved().draft.title, 'Latest'); assert.equal(ui.saved().id, id);
  await ui.open(); await ui.run('Toggle theme');
  assert.equal(ui.renderer.root.findByProps({ 'aria-label': 'NEW LOOK' }).props.value, 'dark');
  await ui.open(); assert.equal(ui.renderer.root.findByType('dialog').props['data-chrome'], 'dark'); await ui.cancel();
  await ui.click('+ Add sheet'); await ui.open();
  assert.ok(ui.labels().includes('Go to sheet: Sheet 2'));
  await ui.run('Go to sheet: Sheet 1');
  assert.equal(ui.renderer.root.findAllByProps({ role: 'tab' }).find(n => n.props['aria-selected']).props.children, 'Sheet 1');
  await ui.click('Rename sheet');
  await act(() => ui.renderer.root.findByProps({ className: 'rename-sheet' }).findByType('input').props.onChange({ target: { value: 'Renamed revenue' } }));
  await act(() => ui.renderer.root.findByProps({ className: 'rename-sheet' }).props.onSubmit({ preventDefault() {} }));
  await ui.open(); assert.ok(ui.labels().includes('Go to sheet: Renamed revenue')); assert.ok(!ui.labels().includes('Go to sheet: Sheet 1')); await ui.cancel();
  await ui.click('Delete sheet'); await ui.open(); assert.ok(!ui.labels().includes('Go to sheet: Renamed revenue'));
});
test('storage failures keep recovery details and emit a failure toast, never Draft saved', async t => {
  const ui = await mountPalette(t, { blocked: true }); await ui.open(); await ui.run('Save draft');
  assert.equal(ui.saved(), undefined); assert.match(ui.messages().join(' '), /could not be saved/);
  assert.ok(!ui.messages().includes('Draft saved')); assert.match(JSON.stringify(ui.renderer.toJSON()), /Browser storage is blocked/);
});
test('Q&A opens its existing panel from Home and Author, including when already open', async t => {
  const ui = await mountPalette(t, { route: '#/home' });
  for (const page of ['home', 'author']) {
    await ui.navigate(page); await ui.open(); await ui.run('Open Q&A panel');
    assert.equal(ui.renderer.root.findAllByProps({ className: 'q-side-panel' }).length, 1);
    assert.equal(ui.document.activeElement, ui.question);
    await ui.open(); await ui.run('Open Q&A panel'); assert.equal(ui.document.activeElement, ui.question);
    await ui.click('Close Ask Q');
  }
});
test('commands unregister on route changes and unavailable Author or Q contexts add none', async t => {
  const ui = await mountPalette(t);
  for (const page of ['analyses', 'data-prep', 'security', 'fixtures']) {
    await ui.navigate(page); await ui.open();
    assert.deepEqual(ui.labels(), ['Go to Home', 'Go to Analyses', 'Go to Data', 'Go to Admin', 'Go to Author']);
    await ui.cancel(); assert.equal((await ui.key('s', { ctrlKey: true })).defaultPrevented, false);
  }
  await act(() => ui.renderer.root.findByType(AppNavigation).props.navigate({ page: 'author', draftId: 'missing' }));
  await ui.open(); assert.equal(ui.labels().length, 5);
});
for (const role of ['author', 'reader', 'reader_ai']) test(`hosted ${role} sees only commands its available UI can run`, async t => {
  const ui = await mountPalette(t, { access: { mode: 'hosted', session: { role, id: 'test', namespaceId: 'test' } } });
  await ui.open(); assert.ok(!ui.labels().includes('Open Q&A panel'));
  assert.equal(ui.labels().includes('Save draft'), role === 'author');
  assert.equal(ui.labels().some(label => label.startsWith('Go to sheet:')), role === 'author');
});
test('global shortcut retains typing/modal/IME guards and StrictMode listener cleanup', async t => {
  const ui = await mountPalette(t, { route: '#/home' });
  assert.equal(ui.listeners.size, 1);
  for (const target of [ui.search, { nodeType: 1, isContentEditable: true }]) assert.equal((await ui.key('k', { ctrlKey: true, target })).defaultPrevented, false);
  ui.document.dispatchEvent(new Event('compositionstart'));
  assert.equal((await ui.key('k', { ctrlKey: true })).defaultPrevented, false);
  ui.document.dispatchEvent(new Event('compositionend'));
  await ui.open(); assert.equal((await ui.key('k', { ctrlKey: true, target: ui.trigger })).defaultPrevented, false);
  await ui.cancel(); await act(() => ui.renderer.update(null));
  assert.equal(ui.listeners.size, 0); assert.equal((await ui.key('k', { ctrlKey: true })).defaultPrevented, false);
});
function FailureCommands() {
  usePaletteCommands(useMemo(() => ({ commands: [
    { id: 'sync', label: 'Fail synchronously', run() { throw new Error('COMMAND_FAILED'); } },
    { id: 'async', label: 'Fail asynchronously', async run() { throw new Error('ASYNC_COMMAND_FAILED'); } },
  ] }), [])); return null;
}
test('thrown and rejected commands close the palette and report failure through toasts', async t => {
  const ui = await mountPalette(t, { element: createElement(ToastProvider, null, createElement(CommandPaletteProvider, { navigate() {} }, createElement(FailureCommands))) });
  for (const label of ['Fail synchronously', 'Fail asynchronously']) { await ui.open(); await ui.run(label); }
  assert.equal(ui.renderer.root.findAllByType('dialog').length, 0);
  assert.deepEqual(ui.messages(), ['Could not run Fail synchronously: COMMAND_FAILED', 'Could not run Fail asynchronously: ASYNC_COMMAND_FAILED']);
});


test('Tab and Shift+Tab wrap between search and Close without leaving the modal', async t => {
  const ui = await mountPalette(t); await ui.open();
  let prevented = 0;
  const tab = shiftKey => act(() => ui.renderer.root.findByType('dialog').props.onKeyDown({ key: 'Tab', shiftKey, preventDefault() { prevented++; } }));
  await tab(false); assert.equal(ui.document.activeElement, ui.close);
  await tab(true); assert.equal(ui.document.activeElement, ui.search);
  assert.equal(prevented, 2);
});

test('removing a command context while open removes options and resets the active descendant', async t => {
  const ui = await mountPalette(t); await ui.open(); await ui.press('ArrowUp');
  assert.notEqual(ui.selected(), 'Go to Home');
  await ui.navigate('data-prep'); assert.equal(ui.labels().length, 5);
  assert.equal(ui.selected(), 'Go to Home');
  assert.equal(ui.input().props['aria-activedescendant'], ui.options()[0].props.id);
});
