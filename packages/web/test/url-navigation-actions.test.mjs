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

import { navigationActionProblem, resolveNavigationAction, validNavigationActions } from '../build/test/interactions.js';
import { buildAuthorQuery } from '../build/test/author-query.js';
import { executeFixtureQuery } from '../build/test/fixture-query.js';
import { sheetParameters } from '../build/test/authoring.js';
const navigation = { id: 'nav-1', name: 'See details', sourceField: 'region', targetSheetId: 'sheet-2', parameterMappings: { region: 'Region' } };
function navigationDraft() {
  let d = sourceDraft();
  d = authorReducer(d, { type: 'parameter-add', parameter: { name: 'Region', type: 'string', multiple: false, values: ['East'], defaultValues: ['East'] } });
  d = authorReducer(d, { type: 'navigation-actions', actions: [navigation] });
  d = authorReducer(d, { type: 'sheet-add' });
  d = authorReducer(d, { type: 'add', kind: 'table' });
  d = authorReducer(d, { type: 'filter-parameter', columnName: 'region', parameterName: 'Region' });
  return authorReducer(d, { type: 'sheet-select', id: 'sheet-1' });
}
test('navigation applies parameters through the existing reducer path and filters destination fixture rows', () => {
  const draft = navigationDraft(), source = activeSheet(draft).visuals[0];
  assert.equal(validNavigationActions([navigation], draft, source), true);
  const next = authorReducer(draft, { type: 'navigate', sourceId: source.id, actionId: navigation.id, selection: { values: { region: 'West' } } });
  validateDraft(next);
  assert.equal(next.activeSheetId, 'sheet-2');
  assert.deepEqual(next.parameters[0].values, ['West']);
  assert.deepEqual(next.parameters[0].defaultValues, ['East']);
  assert.deepEqual(executeFixtureQuery(buildAuthorQuery(activeSheet(next).visuals[0], [], sheetParameters(next))).rows, [{ region: 'West', revenue: 400 }]);
  assert.equal(draft.activeSheetId, 'sheet-1');
  assert.deepEqual(draft.parameters[0].values, ['East']);
});
test('navigation fails closed atomically for stale sheets, unknown fields/parameters, incompatible types and missing values', () => {
  const draft = navigationDraft(), source = activeSheet(draft).visuals[0];
  const cases = [
    [{ ...navigation, targetSheetId: 'absent' }, { region: 'West' }, /NAVIGATION_TARGET_UNKNOWN/],
    [{ ...navigation, sourceField: 'absent' }, { region: 'West' }, /NAVIGATION_SOURCE_UNKNOWN/],
    [{ ...navigation, parameterMappings: { absent: 'Region' } }, { region: 'West' }, /NAVIGATION_FIELD_UNKNOWN/],
    [{ ...navigation, parameterMappings: { region: '' } }, { region: 'West' }, /NAVIGATION_PARAMETER_UNKNOWN/],
    [{ ...navigation, parameterMappings: { region: 'Missing' } }, { region: 'West' }, /NAVIGATION_PARAMETER_UNKNOWN/],
    [navigation, {}, /NAVIGATION_SELECTION_MISSING/],
    [navigation, { region: 42 }, /NAVIGATION_VALUE_INVALID/],
    [navigation, { region: null }, /NAVIGATION_SELECTION_MISSING/],
  ];
  for (const [action, values, problem] of cases) {
    const d = authorReducer(draft, { type: 'navigation-actions', actions: [action] });
    assert.match(resolveNavigationAction(d, source, action, { values }).problem, problem);
    assert.equal(authorReducer(d, { type: 'navigate', sourceId: source.id, actionId: action.id, selection: { values } }), d);
  }
  const numberDraft = structuredClone(draft); numberDraft.parameters[0].type = 'number';
  assert.match(navigationActionProblem(numberDraft, source, navigation), /NAVIGATION_TYPE_MISMATCH/);
  const missing = authorReducer(draft, { type: 'sheet-delete', id: 'sheet-2' });
  validateDraft(missing);
  assert.match(navigationActionProblem(missing, source, navigation), /NAVIGATION_TARGET_UNKNOWN/);
  assert.equal(validNavigationActions([{ ...navigation, extra: true }], draft, source), false);
  const copy = structuredClone(draft); copy.sheets[0].visuals[0].navigationActions[0].parameterMappings = [];
  assert.throws(() => validateDraft(copy));
});
test('navigation validates every mapping before changing any values; duplicate targets and foreign resource sheets are rejected', () => {
  const draft = navigationDraft(), source = activeSheet(draft).visuals[0];
  source.rows.push('category');
  const duplicate = { ...navigation, parameterMappings: { region: 'Region', category: 'Region' } };
  assert.match(navigationActionProblem(draft, source, duplicate), /NAVIGATION_PARAMETER_DUPLICATE/);
  draft.parameters.push({ id: 'parameter-2', name: 'Category', type: 'string', multiple: true, values: ['Hardware'], defaultValues: ['Hardware'] });
  source.navigationActions = [{ ...navigation, parameterMappings: { region: 'Region', category: 'Category' } }];
  assert.equal(authorReducer(draft, { type: 'navigate', sourceId: source.id, actionId: navigation.id, selection: { values: { region: 'West' } } }), draft);
  draft.sheets[1].imported = { memberPath: 'analysis/another.json', sheetId: 'foreign' };
  assert.match(navigationActionProblem(draft, source, navigation), /NAVIGATION_TARGET_UNKNOWN/);
});
test('navigation supports optional mappings and typed numeric/date parameters without coercing strings to numbers', () => {
  let d = navigationDraft(), source = activeSheet(d).visuals[0];
  assert.deepEqual(resolveNavigationAction(d, source, { ...navigation, parameterMappings: {} }, { values: { region: 'West' } }).value.parameters, []);
  source.rows = ['order_date']; source.dimension = 'order_date';
  d.parameters = [{ id: 'parameter-1', name: 'Date', type: 'datetime', multiple: false, values: [], defaultValues: [] }];
  const dateAction = { ...navigation, sourceField: 'order_date', parameterMappings: { order_date: 'Date' } };
  assert.deepEqual(resolveNavigationAction(d, source, dateAction, { values: { order_date: '2025-Q2' } }).value.parameters[0].values, ['2025-04-01']);
  assert.match(resolveNavigationAction(d, source, dateAction, { values: { order_date: '2025-99' } }).problem, /NAVIGATION_VALUE_INVALID/);
  d.dataset = { id: 'local', name: 'Numbers', columns: [{ name: 'group', type: 'INTEGER' }] };
  source.rows = ['group']; source.dimension = 'group';
  d.parameters = [{ id: 'parameter-1', name: 'Count', type: 'number', integer: true, multiple: true, values: [], defaultValues: [] }];
  const numericAction = { ...navigation, sourceField: 'group', parameterMappings: { group: 'Count' } };
  assert.deepEqual(resolveNavigationAction(d, source, numericAction, { values: { group: 4 } }).value.parameters[0].values, [4]);
  for (const group of ['4', 1.5, Infinity]) assert.ok(resolveNavigationAction(d, source, numericAction, { values: { group } }).problem);
});
test('navigation authoring provides sheet and mapping controls, and real row clicks update destination parameters', async t => {
  let d = navigationDraft();
  d = authorReducer(d, { type: 'navigation-actions', actions: [] });
  const ui = await mount(t, d);
  await ui.click('Interaction');
  await act(async () => (await ui.select('Action type')).props.onChange({ target: { value: 'Navigation' } }));
  await ui.click('Add navigation action');
  assert.equal((await ui.select('Target sheet')).props.value, 'sheet-2');
  await ui.click('Add parameter mapping');
  assert.ok(ui.renderer.root.findAllByType('p').some(p => p.children.join('').includes('NAVIGATION_PARAMETER_UNKNOWN')));
  await act(async () => (await ui.select('Target parameter')).props.onChange({ target: { value: 'Region' } }));
  validateDraft(ui.draft());
  await act(() => ui.cards()[0].props.interaction.onSelect({ values: {} }));
  assert.equal(ui.draft().activeSheetId, 'sheet-1');
  assert.match(ui.renderer.root.findByType(ActionEditor).props.runtimeProblems['action-1'], /NAVIGATION_SELECTION_MISSING/);
  const row = ui.cards()[0].findAllByType('tr').find(r => r.props.onClick && r.findAllByType('button').some(b => b.props.children === 'West'));
  assert.ok(row); await act(() => row.props.onClick());
  assert.equal(ui.draft().activeSheetId, 'sheet-2');
  assert.deepEqual(ui.draft().parameters[0].values, ['West']);
  assert.deepEqual(ui.cards()[0].props.visual.rows, [{ region: 'West', revenue: 400 }]);
  assert.equal(ui.opened.length, 0);
});
