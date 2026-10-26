import test from 'node:test';
import assert from 'node:assert/strict';
import { authorReducer, emptyDraft, validateDraft, saveDraft, parseDraft, loadDraft, DRAFT_KEY, unresolvedFieldDiagnostics, serializeDraft } from '../build/test/authoring.js';
import { authorHistoryReducer, createAuthorHistory } from '../build/test/author-history.js';
import { createDraftStore } from '../build/test/local-drafts.js';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AuthorCanvas } from '../build/test/Author.js';
import { buildAuthorVisual } from '../build/test/author-preview.js';
import { buildAuthorQuery } from '../build/test/author-query.js';
import { compileVisual } from '../build/test/compiler.js';

const datasetA = { id: 'schema-a', name: 'Original', columns: [
  { name: 'region', type: 'STRING' }, { name: 'category', type: 'STRING' },
  { name: 'revenue', type: 'DECIMAL' }, { name: 'profit', type: 'DECIMAL' },
] };
const datasetB = { id: 'schema-b', name: 'Replacement', columns: [{ name: 'renamed', type: 'STRING' }] };
const replace = (draft, dataset = datasetB) => authorReducer(draft, { type: 'dataset', dataset });
function original() {
  let draft = replace(emptyDraft(), structuredClone(datasetA));
  draft = authorReducer(draft, { type: 'calculation-add', field: { name: 'Margin', expression: '{profit} / {revenue}', role: 'measure' } });
  for (const kind of ['bar', 'pivot', 'waterfall']) draft = authorReducer(draft, { type: 'add', kind });
  const [bar, pivot, waterfall] = draft.sheets[0].visuals;
  Object.assign(bar, {
    dimension: 'region', measures: ['revenue', 'Margin'], smallMultiples: ['category'],
    filters: [{ columnName: 'region', values: ['East'] }],
    hierarchy: { id: 'geo', name: 'Geography', levels: [{ columnName: 'region' }, { columnName: 'category' }] },
    tooltipHiddenFields: ['revenue'], tooltipExtraFields: [{ field: 'profit', aggregation: 'SUM' }],
  });
  Object.assign(pivot, { dimension: 'region', rows: ['region'], columns: ['category'], measures: ['revenue', 'Margin'] });
  Object.assign(waterfall, { dimension: 'region', measures: ['revenue'], breakdowns: ['category'] });
  validateDraft(draft);
  return draft;
}
function roundTrip(draft) {
  const items = new Map();
  const storage = () => ({ getItem: key => items.get(key) ?? null, setItem: (key, value) => items.set(key, value) });
  assert.equal(saveDraft(draft, storage), 'Draft saved on this device.');
  assert.deepEqual(parseDraft(items.get(DRAFT_KEY)), draft);
  assert.deepEqual(loadDraft(storage), { draft });
  return parseDraft(items.get(DRAFT_KEY));
}

test('incompatible dataset replacement retains every field reference and calculation through save/reload (#128)', () => {
  const before = original();
  const replaced = replace(before);
  const restored = roundTrip(replaced);
  assert.deepEqual(restored.sheets, before.sheets);
  assert.equal(JSON.stringify(restored.sheets.map(s => s.visuals)), JSON.stringify(before.sheets.map(s => s.visuals)));
  assert.equal(JSON.stringify(restored.calculatedFields), JSON.stringify(before.calculatedFields));
});

test('diagnostics locate wells, filters, hierarchy, tooltips, and calculation dependencies without mutating drafts', () => {
  const normal = original();
  assert.deepEqual(unresolvedFieldDiagnostics(normal), []);
  assert.deepEqual(unresolvedFieldDiagnostics(emptyDraft()), []);
  const draft = replace(normal), snapshot = JSON.stringify(draft);
  const diagnostics = unresolvedFieldDiagnostics(draft);
  for (const location of ['dimension', 'rows', 'columns', 'measures', 'smallMultiples', 'breakdowns', 'filter', 'hierarchy', 'hidden tooltip field', 'extra tooltip field']) {
    assert.ok(diagnostics.some(d => d.sheetId === 'sheet-1' && d.visualId && d.location === location), location);
  }
  for (const fieldName of ['profit', 'revenue']) assert.ok(diagnostics.some(d => d.calculation === 'Margin' && d.fieldName === fieldName && d.reason === 'calculation references missing field'));
  assert.equal(JSON.stringify(draft), snapshot);
});

test('calculation diagnostics follow transitive references and ignore braces inside strings and parameters', () => {
  const draft = replace(emptyDraft(), datasetA);
  draft.calculatedFields = [
    { name: 'First', role: 'measure', expression: '{profit} * 2' },
    { name: 'Second', role: 'measure', expression: '{First} + 1' },
    { name: 'Literal', role: 'dimension', expression: "concat('{not a field}', ${Parameter})" },
  ];
  const replaced = roundTrip(replace(draft));
  const diagnostics = unresolvedFieldDiagnostics(replaced);
  assert.deepEqual(diagnostics.map(d => [d.calculation, d.fieldName]), [['First', 'profit'], ['Second', 'profit']]);
});

test('role and type changes persist, are diagnosed, and clear when the schema is restored', () => {
  const draft = original();
  const changed = replace(draft, { ...datasetA, columns: datasetA.columns.map(c => ({ ...c, type: c.type === 'STRING' ? 'DECIMAL' : 'STRING' })) });
  roundTrip(changed);
  const diagnostics = unresolvedFieldDiagnostics(changed);
  assert.ok(diagnostics.some(d => d.fieldName === 'region' && d.reason === 'role changed'));
  assert.ok(diagnostics.some(d => d.fieldName === 'revenue' && d.reason === 'role changed'));
  assert.ok(diagnostics.some(d => d.calculation === 'Margin' && d.reason === 'role changed'));
  assert.deepEqual(unresolvedFieldDiagnostics(roundTrip(replace(changed, datasetA))), []);
});

test('dataset type changes propagate through dependent calculations without preventing persistence', () => {
  const draft = replace(emptyDraft(), datasetA);
  draft.calculatedFields = [
    { name: 'First', expression: '{revenue}', role: 'measure' },
    { name: 'Second', expression: '{First} + 1', role: 'measure' },
  ];
  validateDraft(draft);
  const changed = replace(draft, { ...datasetA, columns: datasetA.columns.map(c => c.name === 'revenue' ? { ...c, type: 'DATETIME' } : c) });
  roundTrip(changed);
  const diagnostics = unresolvedFieldDiagnostics(changed);
  for (const calculation of ['First', 'Second']) assert.ok(diagnostics.some(d => d.calculation === calculation && d.reason === 'role changed'));
  assert.throws(() => serializeDraft(changed), /UNRESOLVED_FIELDS:.*revenue/);
  assert.deepEqual(unresolvedFieldDiagnostics(replace(changed, datasetA)), []);
});

test('undo restores the saved dataset and clean snapshot; replace-back repairs and persists', () => {
  const draft = original(), saved = JSON.stringify(draft);
  const replaced = authorHistoryReducer(createAuthorHistory(draft), { type: 'dataset', dataset: datasetB });
  assert.ok(unresolvedFieldDiagnostics(replaced.draft).length);
  const undone = authorHistoryReducer(replaced, { type: 'undo' });
  assert.equal(JSON.stringify(undone.draft), saved, 'same snapshot used by the dirty-state comparison');
  assert.deepEqual(unresolvedFieldDiagnostics(undone.draft), []);
  roundTrip(undone.draft);
  const repaired = replace(replaced.draft, datasetA);
  assert.deepEqual(unresolvedFieldDiagnostics(repaired), []);
  roundTrip(repaired);
});

test('title and sheet edits remain saveable and autosaveable while fields are unresolved', () => {
  const items = new Map(), storage = () => ({ getItem: k => items.get(k) ?? null, setItem: (k, v) => items.set(k, v) });
  const store = createDraftStore(storage, { mode: 'local' });
  const before = original(), id = store.save(before);
  let draft = authorReducer(replace(before), { type: 'analysis-title', title: 'Still editable' });
  draft = authorReducer(draft, { type: 'sheet-duplicate', id: 'sheet-1' });
  draft = authorReducer(draft, { type: 'sheet-add', name: 'More work' });
  draft = authorReducer(draft, { type: 'sheet-rename', id: 'sheet-1', name: 'Retained' });
  roundTrip(draft);
  store.autosave(draft, id, store.list()[0].updatedAt);
  assert.deepEqual(createDraftStore(storage, { mode: 'local' }).restore().draft, draft);
  store.save(draft, id);
  assert.deepEqual(store.open(id), draft);
});

test('bundle export names unresolved fields while local save succeeds, and export works after repair', () => {
  const draft = replace(original());
  assert.throws(() => serializeDraft(draft), error => /UNRESOLVED_FIELDS:/.test(error.message) && ['region', 'category', 'revenue', 'profit'].every(name => error.message.includes(name)));
  roundTrip(draft);
  assert.equal(serializeDraft(replace(draft, datasetA)).resourceType, 'analysis');
  const calculationsOnly = replace(emptyDraft());
  calculationsOnly.calculatedFields = [{ name: 'Orphan', expression: '{gone} + 1', role: 'measure' }];
  roundTrip(calculationsOnly);
  assert.throws(() => serializeDraft(calculationsOnly), /UNRESOLVED_FIELDS:.*gone/);
});

test('parameter filters, control sources/cascades and action mappings survive and are diagnosed', () => {
  const draft = original();
  draft.parameters = [{ id: 'parameter-1', name: 'Region', type: 'string', multiple: false, values: ['East'], defaultValues: ['East'] }];
  draft.sheets[0].controls = [
    { id: 'c1', label: 'Region', kind: 'dropdown', parameterId: 'parameter-1', source: { columnName: 'region', dataSetIdentifier: 'sales_data', local: true } },
    { id: 'c2', label: 'Category', kind: 'dropdown', parameterId: 'parameter-1', source: { columnName: 'category', dataSetIdentifier: 'sales_data', local: true }, cascade: [{ controlId: 'c1', columnName: 'region' }] },
  ];
  const visual = draft.sheets[0].visuals[0];
  visual.filters = [{ columnName: 'region', parameterName: 'Region', values: [] }];
  visual.filterActions = [{ id: 'f1', name: 'Filter', sourceField: 'region', targets: ['visual-2'], mappings: { 'visual-2': 'category' } }];
  visual.urlActions = [{ id: 'u1', name: 'Link', sourceField: 'region', urlTemplate: 'https://example.com/{region}' }];
  visual.navigationActions = [{ id: 'n1', name: 'Go', sourceField: 'region', targetSheetId: 'sheet-1', parameterMappings: { region: 'Region' } }];
  validateDraft(draft);
  assert.deepEqual(unresolvedFieldDiagnostics(draft), []);
  const replaced = roundTrip(replace(draft)), diagnostics = unresolvedFieldDiagnostics(replaced);
  for (const location of ['filter', 'filter action', 'URL action', 'navigation action', 'control binding']) assert.ok(diagnostics.some(d => d.location === location), location);
  assert.ok(diagnostics.some(d => d.controlId === 'c2' && d.fieldName === 'region'));
  const wrongParameter = structuredClone(replaced);
  wrongParameter.sheets[0].visuals[0].filters[0].parameterName = 'Undeclared';
  assert.throws(() => validateDraft(wrongParameter));
  wrongParameter.sheets[0].controls[0].parameterId = 'Undeclared';
  assert.throws(() => validateDraft(wrongParameter));
});

test('date hierarchy and Boolean facet type changes persist without weakening granularity rules', () => {
  const draft = original();
  draft.dataset.columns.push({ name: 'date', type: 'DATETIME' });
  draft.sheets[0].visuals[0].hierarchy = { id: 'dates', name: 'Dates', levels: [{ columnName: 'date', granularity: 'YEAR' }, { columnName: 'date', granularity: 'MONTH' }] };
  const changed = replace(draft, { ...datasetA, columns: [{ name: 'date', type: 'STRING' }, { name: 'category', type: 'BOOLEAN' }] });
  roundTrip(changed);
  assert.ok(unresolvedFieldDiagnostics(changed).some(d => d.location === 'hierarchy' && d.reason === 'role changed'));
  assert.ok(unresolvedFieldDiagnostics(changed).some(d => d.location === 'smallMultiples' && d.reason === 'role changed'));
  changed.sheets[0].visuals[0].hierarchy.levels[1].granularity = 'FOREVER';
  assert.throws(() => validateDraft(changed));
});

test('unresolved names still reject empty, padded, NUL, duplicates and structural garbage', () => {
  const mutations = [
    v => { v.dimension = ''; }, v => { v.dimension = ' padded '; }, v => { v.dimension = 'bad\0name'; },
    v => { v.measures = ['gone', 'gone']; }, v => { v.rows = ['gone']; },
    v => { v.smallMultiples = ['gone', 'other']; }, v => { v.breakdowns = ['']; },
    v => { v.filters[0].columnName = ''; }, v => { v.filters[0].columnName = 'bad\0'; },
    v => { v.hierarchy.levels[0].columnName = 'bad\0'; },
    v => { v.tooltipExtraFields[0].field = ' '; }, v => { v.tooltipHiddenFields = ['bad\0']; },
    v => { v.execute = 'script'; }, v => { v.id = '../invalid'; }, v => { v.kind = 'unknown'; },
  ];
  for (const mutate of mutations) {
    const draft = replace(original()); mutate(draft.sheets[0].visuals[0]);
    assert.throws(() => validateDraft(draft), mutate.toString());
  }
  const sample = authorReducer(emptyDraft(), { type: 'add', kind: 'bar' });
  sample.sheets[0].visuals[0].dimension = 'gone';
  assert.throws(() => validateDraft(sample), 'no explicit dataset retains strict membership');
});

test('syntax errors, banned constructs, invalid names, cycles and literal type errors still fail closed', () => {
  for (const expression of ['', '{gone} +', 'fetch(1)', '{gone}; 1', "'text' + 1", '{Margin} + 1']) {
    const draft = replace(original()); draft.calculatedFields[0].expression = expression;
    assert.throws(() => validateDraft(draft), expression);
  }
  for (const name of ['bad-name', ' padded ', '', 'renamed', 'Margin']) {
    const draft = replace(original()); draft.calculatedFields.push({ name, expression: '1', role: 'measure' });
    assert.throws(() => validateDraft(draft), name);
  }
  const draft = replace(original());
  draft.calculatedFields = [{ name: 'One', expression: '{Two}', role: 'measure' }, { name: 'Two', expression: '{One}', role: 'measure' }];
  assert.throws(() => validateDraft(draft), 'indirect cycle');
  draft.calculatedFields = [{ name: 'Text', expression: "'literal'", role: 'dimension' }, { name: 'Bad', expression: '{Text} + 1', role: 'measure' }];
  assert.throws(() => validateDraft(draft), 'calculation role errors are not dataset membership errors');
});

test('unresolved visuals compile without rows, skip queries, and show field diagnostics in the canvas', () => {
  const draft = replace(original());
  for (const visual of draft.sheets[0].visuals) {
    assert.equal(buildAuthorQuery(visual, draft.calculatedFields, draft.parameters, draft.dataset), null);
    const compiled = compileVisual(buildAuthorVisual(visual, draft.calculatedFields, draft.dataset));
    assert.equal(compiled.state, 'unavailable');
    assert.deepEqual(compiled.table.rows, []);
  }
  const html = renderToStaticMarkup(createElement(AuthorCanvas, {
    draft, dispatch() {}, client: { dataset: draft.dataset, queryDataset() { assert.fail('unresolved fields must not query'); } },
  }));
  assert.match(html, /aria-label="Unavailable fields"/);
  assert.match(html, /Your draft can still save/);
  assert.match(html, /Calculation Margin/);
  for (const name of ['region', 'category', 'revenue', 'profit']) assert.match(html, new RegExp(`${name}.*missing`));
  assert.equal((html.match(/class="bundle-placeholder"/g) ?? []).length, 3);
  assert.doesNotMatch(html, /Loading data|View data/);
  const repaired = replace(draft, datasetA);
  const restored = renderToStaticMarkup(createElement(AuthorCanvas, { draft: repaired, dispatch() {} }));
  assert.doesNotMatch(restored, /aria-label="Unavailable fields"/);
  assert.ok(buildAuthorQuery(repaired.sheets[0].visuals[0], repaired.calculatedFields, repaired.parameters, repaired.dataset));
});

test('a resolved calculation-backed well with missing dependencies and a role-changed well cannot query', () => {
  const draft = original(), visual = draft.sheets[0].visuals[1];
  visual.measures = ['Margin'];
  const dataset = { ...datasetA, columns: datasetA.columns.filter(c => c.name !== 'profit') };
  assert.equal(buildAuthorQuery(visual, draft.calculatedFields, [], dataset), null);
  visual.measures = ['revenue'];
  const changed = { ...datasetA, columns: datasetA.columns.map(c => c.name === 'revenue' ? { ...c, type: 'STRING' } : c) };
  assert.equal(buildAuthorQuery(visual, [], [], changed), null);
});
