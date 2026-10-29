import test from 'node:test';
import assert from 'node:assert/strict';
import { createFieldSearchDraft, resolveFieldSearch, closestFields, fieldToken } from '../build/test/field-search.js';
import { datasetFields, validateDraft, serializeDraft } from '../build/test/authoring.js';
import { buildAuthorPreview } from '../build/test/author-preview.js';
import { compileVisual } from '../build/test/compiler.js';

test('field search resolves plain/bracketed measures and measure-by-dimension against defined fields', () => {
  for (const text of ['revenue', '[revenue]', ' REVENUE ']) {
    const result = resolveFieldSearch(text);
    assert.equal(result.ok, true); assert.equal(result.value.measure.name, 'revenue'); assert.equal(result.value.dimension, undefined);
  }
  for (const text of ['revenue by region', '[revenue] by [region]', 'revenue BY [region]', '[REVENUE] by REGION']) {
    const result = resolveFieldSearch(text);
    assert.equal(result.ok, true); assert.equal(result.value.measure.name, 'revenue'); assert.equal(result.value.dimension.name, 'region');
  }
});

test('field search supports spaces and bracket escaping without treating field contents as grammar', () => {
  const dataset = { id: 'custom', name: 'Custom', columns: [{ name: 'total revenue', type: 'DECIMAL' }, { name: 'item type', type: 'STRING' }, { name: 'sold by team]', type: 'STRING' }] };
  for (const query of ['total revenue by item type', '[total revenue] by [item type]', `total revenue by ${fieldToken('sold by team]')}`]) assert.equal(resolveFieldSearch(query, dataset).ok, true);
  assert.equal(resolveFieldSearch('revenue by region', dataset).ok, false, 'sample fields cannot leak into prepared datasets');
});

test('unknown, ambiguous, wrong-role and malformed tokens fail closed without creating an analysis', () => {
  const miss = createFieldSearchDraft('revenu by region');
  assert.equal(miss.ok, false); assert.equal(miss.token, 'revenu'); assert.equal(miss.matches[0], 'revenue'); assert.match(miss.message, /Unknown field.*revenu/);
  assert.equal('value' in miss, false);
  const ambiguous = { id: 'ambiguous', name: 'Ambiguous', columns: [{ name: 'Revenue', type: 'INTEGER' }, { name: 'revenue', type: 'INTEGER' }] };
  const result = createFieldSearchDraft('revenue', ambiguous);
  assert.equal(result.ok, false); assert.deepEqual(result.matches, ['Revenue', 'revenue']); assert.match(result.message, /Ambiguous field/);
  for (const query of ['', '[revenue', 'revenue]', '[]', 'revenue by ', 'revenue by region by category', 'region', 'revenue by profit', 'sum(revenue)', 'revenue; DROP TABLE sales']) assert.equal(createFieldSearchDraft(query).ok, false, query);
  const bool = { id: 'boolean', name: 'Boolean', columns: [{ name: 'revenue', type: 'INTEGER' }, { name: 'flag', type: 'BOOLEAN' }] };
  assert.equal(createFieldSearchDraft('revenue by flag', bool).ok, false);
});

test('closest field matches are deterministic suggestions, never silent fuzzy substitutions', () => {
  const fields = datasetFields();
  assert.equal(closestFields('revenu', fields)[0].name, 'revenue');
  assert.equal(closestFields('reg', fields)[0].name, 'region');
  assert.equal(closestFields('ORDER_D', fields)[0].name, 'order_date');
  assert.equal(createFieldSearchDraft('revenu').ok, false);
  assert.equal(createFieldSearchDraft(fieldToken(closestFields('revenu', fields)[0].name)).ok, true);
});

test('search creates one normal KPI or bar, serializable and rendered by the existing compiler', () => {
  for (const [query, kind] of [['revenue', 'kpi'], ['revenue by region', 'bar']]) {
    const result = createFieldSearchDraft(query); assert.equal(result.ok, true);
    const draft = result.value; validateDraft(draft);
    assert.equal(draft.sheets.length, 1); assert.equal(draft.sheets[0].visuals.length, 1);
    const visual = draft.sheets[0].visuals[0]; assert.equal(visual.kind, kind);
    assert.deepEqual(visual.measures, ['revenue']);
    assert.equal(serializeDraft(draft).definition.sheets[0].visuals.length, 1);
    const compiled = compileVisual(buildAuthorPreview(visual));
    assert.notEqual(compiled.state, 'unavailable'); assert.equal(compiled.model.kind, kind);
  }
});
