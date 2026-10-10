import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { create } from 'react-test-renderer';
import { renderToStaticMarkup } from 'react-dom/server';
import { AnalysisSettings } from '../build/test/AnalysisSettings.js';
import { authorReducer, emptyDraft, parseDraft, serializeDraft, validateDraft, analysisSettingsError } from '../build/test/authoring.js';
import { authorHistoryReducer, createAuthorHistory } from '../build/test/author-history.js';
import { importBundle, exportBundle, downloadBundleBytes } from '../build/test/bundle-authoring.js';
import { DARK_THEME, LIGHT_THEME } from '../build/test/themes.js';
import { parseQsBundle } from '@opensight/bundle-parser';

const settings = { type: 'analysis-settings', title: ' Revenue analysis ', description: 'Synthetic revenue\nMonthly review.', theme: DARK_THEME };

test('settings are one reversible command and persist through validation/storage/JSON/.qs', async () => {
  const original = authorReducer(emptyDraft(), { type: 'add', kind: 'bar' });
  let state = createAuthorHistory(original);
  state = authorHistoryReducer(state, settings);
  const saved = state.draft;
  assert.equal(state.undo.length, 1); assert.equal(saved.title, 'Revenue analysis'); assert.equal(saved.description, settings.description);
  validateDraft(saved); assert.deepEqual(parseDraft(JSON.stringify(saved)), saved);
  assert.deepEqual(parseDraft(JSON.stringify(emptyDraft())), emptyDraft(), 'old drafts remain valid');
  assert.equal(serializeDraft(saved).definition.opensightDescription, settings.description);
  const bundle = await parseQsBundle(await downloadBundleBytes(saved)), imported = importBundle(bundle);
  assert.equal(imported.title, saved.title); assert.equal(imported.description, saved.description); assert.deepEqual(imported.theme, DARK_THEME);
  assert.deepEqual(exportBundle(imported), bundle, 'unmodified import is lossless');
  state = authorHistoryReducer(state, { type: 'undo' }); assert.deepEqual(state.draft, original);
  state = authorHistoryReducer(state, { type: 'redo' }); assert.deepEqual(state.draft, saved);
});

test('imported primary settings update without changing other resources; blank descriptions round-trip', () => {
  const resource = serializeDraft(authorReducer(emptyDraft(), settings));
  const secondary = { ...structuredClone(resource), analysisId: 'second', name: 'Other analysis' };
  const bundle = { members: [{ path: 'analysis/authored-analysis.json', resource }, { path: 'analysis/second.json', resource: secondary }] };
  const imported = importBundle(bundle), changed = authorReducer(imported, { ...settings, title: 'Updated', description: '', theme: LIGHT_THEME });
  const exported = exportBundle(changed);
  assert.deepEqual(exported.members[1], bundle.members[1]);
  assert.equal(exported.members[0].resource.name, 'Updated'); assert.equal(exported.members[0].resource.definition.opensightDescription, '');
  assert.equal(importBundle(exported).description, ''); assert.deepEqual(importBundle(exported).theme, LIGHT_THEME);
  assert.deepEqual(authorHistoryReducer(authorHistoryReducer(createAuthorHistory(imported), { ...settings, description: '' }), { type: 'undo' }).draft, imported);
});

test('settings and stored descriptions reject malformed input; unknown imported extension stays read-only until explicitly edited', () => {
  for (const invalid of [{ title: '' }, { title: '  ' }, { title: 'x'.repeat(257) }, { title: 'bad\nname' }, { description: 'x'.repeat(4001) }, { description: 'null\0char' }, { description: {} }, { theme: { fontFamily: 'url(https://example.invalid)' } }]) {
    const action = { ...settings, ...invalid }, draft = emptyDraft();
    assert.ok(analysisSettingsError(action)); assert.equal(authorReducer(draft, action), draft);
  }
  for (const description of [null, 3, {}, 'x'.repeat(4001), '\0']) assert.throws(() => validateDraft({ ...emptyDraft(), description }));
  const resource = serializeDraft(emptyDraft()); resource.definition.opensightDescription = { future: true };
  const bundle = { members: [{ path: 'analysis/authored-analysis.json', resource }] }, imported = importBundle(bundle);
  assert.equal(imported.description, undefined); assert.match(JSON.stringify(imported.bundle.report), /unsupported definition retained, read-only/);
  assert.deepEqual(exportBundle(imported), bundle);
  assert.equal(exportBundle(authorReducer(imported, settings)).members[0].resource.definition.opensightDescription, settings.description);
});

test('settings alone create an analysis from a dataset-only import while preserving dependencies', () => {
  const bundle = { members: [{ path: 'dataset/source.json', resource: { resourceType: 'dataset', dataSetId: 'source', name: 'Synthetic source', importMode: 'DIRECT_QUERY', physicalTableMap: {} } }] };
  const imported = importBundle(bundle);
  const updated = authorReducer(imported, { type: 'analysis-settings', title: imported.title, description: 'Notes' });
  const exported = exportBundle(updated);
  assert.deepEqual(exported.members[0], bundle.members[0]);
  assert.equal(exported.members.at(-1).resource.definition.opensightDescription, 'Notes');
});

async function mount(t, draft = emptyDraft()) {
  const previous = globalThis.IS_REACT_ACT_ENVIRONMENT; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let renderer; const calls = [];
  await act(() => { renderer = create(createElement(AnalysisSettings, { draft, dispatch: action => calls.push(action), onClose: () => calls.push('close') })); });
  t.after(async () => { await act(() => renderer.unmount()); globalThis.IS_REACT_ACT_ENVIRONMENT = previous; });
  const change = async (type, value) => act(() => renderer.root.findByType(type).props.onChange({ target: { value } }));
  return { renderer, calls, change, submit: () => act(() => renderer.root.findByType('form').props.onSubmit({ preventDefault() {} })) };
}

test('dialog stages edits, validates and dispatches one atomic settings command', async t => {
  const ui = await mount(t);
  await ui.change('input', ''); await ui.submit(); assert.equal(ui.calls.length, 0); assert.match(ui.renderer.root.findByProps({ role: 'alert' }).props.children, /analysis name/);
  await ui.change('input', 'Revenue analysis'); await ui.change('textarea', 'Notes'); await ui.change('select', 'dark');
  assert.equal(ui.calls.length, 0);
  await ui.submit(); assert.deepEqual(ui.calls, [{ type: 'analysis-settings', title: 'Revenue analysis', description: 'Notes', theme: DARK_THEME }, 'close']);
});

test('cancel/Escape discard edits; disabled sub-items explain themselves and never dispatch', async t => {
  const ui = await mount(t, { ...emptyDraft(), theme: { ...DARK_THEME, fontFamily: 'Georgia, serif' } });
  await ui.change('input', 'Discarded');
  for (const button of ui.renderer.root.findAllByType('button').filter(b => b.props['aria-disabled'])) {
    assert.equal(button.props.disabled, undefined); assert.ok(button.props.title);
    assert.equal(ui.renderer.root.findByProps({ id: button.props['aria-describedby'] }).props.children, button.props.title);
    await act(() => button.props.onClick());
  }
  assert.deepEqual(ui.calls, []);
  await act(() => ui.renderer.root.findAllByType('button').find(b => b.props.children === 'Cancel').props.onClick());
  let prevented = false; await act(() => ui.renderer.root.findByType('dialog').props.onCancel({ preventDefault() { prevented = true; } }));
  assert.equal(prevented, true); assert.deepEqual(ui.calls, ['close', 'close']);
});

test('unchanged settings preserve custom themes and do not create history; descriptions render as text', async t => {
  const draft = { ...emptyDraft(), description: '<img src=x onerror=alert(1)>', theme: { ...DARK_THEME, fontFamily: 'Georgia, serif' } };
  const ui = await mount(t, draft); await ui.submit();
  const history = authorHistoryReducer(createAuthorHistory(draft), ui.calls[0]); assert.equal(history.undo.length, 0); assert.deepEqual(history.draft, draft);
  const html = renderToStaticMarkup(createElement(AnalysisSettings, { draft, dispatch() {}, onClose() {} }));
  assert.doesNotMatch(html, /<img/); assert.match(html, /&lt;img/);
});
