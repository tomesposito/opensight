import test from 'node:test';
import assert from 'node:assert/strict';
import { authorReducer, emptyDraft, validateDraft, saveDraft, parseDraft, loadDraft, DRAFT_KEY } from '../build/test/authoring.js';

const datasetA = { id: 'schema-a', name: 'Original', columns: [
  { name: 'region', type: 'STRING' }, { name: 'category', type: 'STRING' },
  { name: 'revenue', type: 'DECIMAL' }, { name: 'profit', type: 'DECIMAL' },
] };
const datasetB = { id: 'schema-b', name: 'Replacement', columns: [{ name: 'renamed', type: 'STRING' }] };
const replace = (draft, dataset = datasetB) => authorReducer(draft, { type: 'dataset', dataset });
function original() {
  let draft = replace(emptyDraft(), datasetA);
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
  assert.equal(JSON.stringify(restored.sheets), JSON.stringify(before.sheets));
  assert.equal(JSON.stringify(restored.calculatedFields), JSON.stringify(before.calculatedFields));
});
