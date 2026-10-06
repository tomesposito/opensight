import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement, useReducer } from 'react';
import { create } from 'react-test-renderer';
import { activeSheet, authorReducer, emptyDraft, validateDraft } from '../build/test/authoring.js';
import { resolveUrlAction, urlActionProblem, validUrlActions } from '../build/test/interactions.js';
import { AuthorCanvas } from '../build/test/Author.js';
import { VisualCard } from '../build/test/VisualCard.js';
import { ActionEditor } from '../build/test/ActionEditor.js';

const url = { id: 'url-1', name: 'Details', sourceField: 'region', urlTemplate: 'https://example.com/{region}?category={category}' };
const sourceDraft = (kind = 'table') => authorReducer(emptyDraft(), { type: 'add', kind });
const sourceVisual = () => ({ ...activeSheet(sourceDraft()).visuals[0], rows: ['region', 'category'] });
async function mount(t, initial) {
  const oldWindow = globalThis.window, oldAct = globalThis.IS_REACT_ACT_ENVIRONMENT, opened = [];
  globalThis.window = { open: (...args) => opened.push(args), matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) };
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let renderer, draft;
  function Harness() {
    const [state, dispatch] = useReducer(authorReducer, initial); draft = state;
    return createElement(AuthorCanvas, { draft: state, dispatch });
  }
  await act(() => { renderer = create(createElement(Harness)); });
  t.after(async () => { await act(() => renderer.unmount()); globalThis.window = oldWindow; globalThis.IS_REACT_ACT_ENVIRONMENT = oldAct; });
  return { renderer, opened, draft: () => draft, cards: () => renderer.root.findAllByType(VisualCard),
    click: async text => { const b = renderer.root.findAllByType('button').find(b => b.children.join('') === text); assert.ok(b, text); await act(() => b.props.onClick({ stopPropagation() {} })); },
    select: async label => renderer.root.findAllByType('label').find(l => l.children[0] === label).findByType('select'),
  };
}
test('URL interpolation encodes all grouped values, repeated placeholders, Unicode, and numeric values', () => {
  const action = { ...url, urlTemplate: 'https://example.com/{region}?c={category}&again={region}' };
  assert.equal(resolveUrlAction(sourceVisual(), action, { values: { region: 'East / 西', category: 'A&B#?' } }).value,
    'https://example.com/East%20%2F%20%E8%A5%BF?c=A%26B%23%3F&again=East%20%2F%20%E8%A5%BF');
  assert.equal(resolveUrlAction(sourceVisual(), url, { values: { region: 0, category: '' } }).value, 'https://example.com/0?category=');
  assert.equal(validUrlActions([url], sourceVisual()), true);
});
test('URL actions fail closed for missing fields, malformed placeholders and unsafe or invalid URLs', () => {
  const visual = sourceVisual();
  assert.match(resolveUrlAction(visual, url, { values: { region: 'East' } }).problem, /URL_SELECTION_MISSING.*category/);
  assert.match(resolveUrlAction(visual, url, { values: Object.create({ region: 'East', category: 'Hardware' }) }).problem, /URL_SELECTION_MISSING/);
  assert.match(urlActionProblem(visual, { ...url, urlTemplate: 'https://example.com/{revenue}' }), /URL_FIELD_UNKNOWN/);
  assert.match(urlActionProblem(visual, { ...url, sourceField: 'missing' }), /URL_SOURCE_UNKNOWN/);
  assert.match(urlActionProblem({ ...visual, kind: 'kpi' }, url), /URL_ORIGIN_INVALID.*KPI/);
  for (const template of ['', 'javascript:alert(1)', 'data:text/html,hi', '//example.com', '/relative', 'https://', 'https://[bad]', 'https://example.com/{region', 'https://example.com/{}', 'https://example.com/\nhi', 'https:\\example.com']) {
    const action = { ...url, urlTemplate: template };
    assert.equal(validUrlActions([action], visual), false, template);
    assert.ok(resolveUrlAction(visual, action, { values: { region: 'East', category: 'Hardware' } }).problem, template);
  }
  assert.equal(validUrlActions([{ ...url, target: 'popup' }]), false);
  assert.equal(validUrlActions([{ ...url, extra: true }]), false);
  assert.equal(validUrlActions([url, url]), false);
});
test('URL draft editing retains invalid templates for diagnostics and validates structural tampering', () => {
  const draft = authorReducer(sourceDraft(), { type: 'url-actions', actions: [{ ...url, urlTemplate: '' }] });
  validateDraft(draft);
  assert.match(urlActionProblem(activeSheet(draft).visuals[0], activeSheet(draft).visuals[0].urlActions[0]), /URL_TEMPLATE_EMPTY/);
  const copy = structuredClone(draft); copy.sheets[0].visuals[0].urlActions[0].target = 'untrusted';
  assert.throws(() => validateDraft(copy));
});
test('URL author picker and editor save invalid input visibly, then click opens safely in a real browser path', async t => {
  const ui = await mount(t, sourceDraft());
  await ui.click('Interaction');
  const picker = await ui.select('Action type');
  await act(() => picker.props.onChange({ target: { value: 'URL' } }));
  await ui.click('Add url action');
  const template = ui.renderer.root.findAllByType('input').find(i => i.props.placeholder === 'https://example.com/{region}');
  assert.ok(ui.renderer.root.findAllByType('p').some(p => p.children.join('').includes('URL_TEMPLATE_EMPTY')));
  await act(() => template.props.onChange({ target: { value: 'https://example.com/{region}' } }));
  validateDraft(ui.draft());
  const select = selection => act(() => ui.cards()[0].props.interaction.onSelect(selection));
  await select({ values: { region: 'West & East' } });
  assert.deepEqual(ui.opened, [['https://example.com/West%20%26%20East', '_blank', 'noopener,noreferrer']]);
  await select({ values: {} });
  assert.equal(ui.opened.length, 1);
  assert.match(ui.renderer.root.findByType(ActionEditor).props.runtimeProblems['action-1'], /URL_SELECTION_MISSING/);
  await select({ values: { region: 'East' }, range: ['a', 'b'] });
  assert.equal(ui.opened.length, 1);
  const target = await ui.select('Open in');
  await act(() => target.props.onChange({ target: { value: '_self' } }));
  await select({ values: { region: 'West' } });
  assert.deepEqual(ui.opened[1], ['https://example.com/West', '_self', 'noopener,noreferrer']);
  await act(() => template.props.onChange({ target: { value: 'javascript:alert(1)' } }));
  await select({ values: { region: 'West' } });
  assert.equal(ui.opened.length, 2);
});
