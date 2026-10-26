import test from 'node:test';
import assert from 'node:assert/strict';
import { authorReducer, emptyDraft, parseDraft, saveDraft, loadDraft, serializeDraft, validateDraft, SALES_FIELDS, datasetFields } from '../build/test/authoring.js';
import { authorHistoryReducer, createAuthorHistory } from '../build/test/author-history.js';
import { exportBundle, importBundleFile } from '../build/test/bundle-authoring.js';
import { sampleDataset } from '../build/test/ManageDataDialog.js';

const prepared = { id: 'prepared', name: 'Prepared data', columns: [{ name: 'team', type: 'STRING' }, { name: 'amount', type: 'DECIMAL' }] };
const withVisual = dataset => authorReducer({ ...emptyDraft(), ...(dataset ? { dataset } : {}) }, { type: 'add', kind: 'bar' });
const remove = draft => authorReducer(draft, { type: 'dataset' });

for (const [label, draft] of [['implicit sample', withVisual()], ['selected sample', authorReducer(withVisual(), { type: 'dataset', dataset: sampleDataset() })], ['prepared', withVisual(prepared)]]) {
  test(`issue #129: removing ${label} persists the empty dataset state and retained definition`, () => {
    const removed = remove(draft);
    assert.equal(removed.noDataset, true);
    assert.equal(removed.dataset, undefined);
    assert.deepEqual(removed.sheets, draft.sheets);
    let saved;
    const storage = () => ({ getItem: () => saved ?? null, setItem: (_key, value) => { saved = value; } });
    assert.equal(saveDraft(removed, storage), 'Draft saved on this device.');
    assert.deepEqual(parseDraft(saved), removed);
    assert.deepEqual(loadDraft(storage), { draft: removed });
    assert.throws(() => serializeDraft(removed), /NO_DATASET/);
    assert.throws(() => exportBundle(removed), /NO_DATASET/);
  });

  test(`issue #129: undo/redo restores ${label} and removal exactly`, () => {
    let history = authorHistoryReducer(createAuthorHistory(draft), { type: 'dataset' });
    const removed = history.draft;
    assert.equal(history.undo.length, 1);
    history = authorHistoryReducer(history, { type: 'undo' });
    assert.deepEqual(history.draft, draft);
    history = authorHistoryReducer(history, { type: 'redo' });
    assert.deepEqual(history.draft, removed);
    assert.equal(authorHistoryReducer(history, { type: 'dataset' }), history, 'repeated removal is not another edit');
  });
}

test('issue #129: old drafts parse unchanged and keep implicit sample fields', () => {
  for (const draft of [emptyDraft(), withVisual(), withVisual(prepared)]) {
    assert.deepEqual(parseDraft(JSON.stringify(draft)), draft);
    assert.equal(Object.hasOwn(parseDraft(JSON.stringify(draft)), 'noDataset'), false);
  }
  assert.equal(datasetFields(undefined), SALES_FIELDS);
});

test('issue #129: selecting prepared data or sample and importing a bundle clear removal', async () => {
  const removed = remove(withVisual());
  for (const dataset of [prepared, sampleDataset()]) {
    const selected = authorReducer(removed, { type: 'dataset', dataset });
    assert.equal(Object.hasOwn(selected, 'noDataset'), false);
    assert.deepEqual(selected.dataset, dataset.id === 'sales' ? undefined : dataset);
    assert.deepEqual(parseDraft(JSON.stringify(selected)), selected);
    if (dataset.id === 'sales') assert.deepEqual(serializeDraft(selected), serializeDraft(withVisual()));
  }
  const resource = serializeDraft(withVisual());
  const imported = await importBundleFile(new File([JSON.stringify(resource)], 'analysis.json'));
  const next = authorReducer(removed, { type: 'import', draft: imported });
  assert.equal(next.noDataset, undefined);
  assert.ok(next.bundle);
  assert.doesNotThrow(() => exportBundle(next));
  assert.throws(() => exportBundle(remove(next)), /NO_DATASET/);
});

test('issue #129: removal retains prepared calculations even when their names match sample columns', () => {
  let draft = withVisual(prepared);
  draft = authorReducer(draft, { type: 'calculation-add', field: { name: 'revenue', expression: '{amount} * 2', role: 'measure' } });
  draft = authorReducer(draft, { type: 'calculation-add', field: { name: 'increased', expression: '{revenue} + 1', role: 'measure' } });
  draft = authorReducer(draft, { type: 'assign', field: 'increased', well: 'values' });
  const removed = remove(draft);
  assert.equal(removed.calculatedFields.length, 2);
  assert.deepEqual(parseDraft(JSON.stringify(removed)), removed);
});

test('issue #129: empty dataset validation rejects conflicting flags and malformed retained definitions', () => {
  for (const noDataset of [false, null, 'true', 1, {}]) assert.throws(() => validateDraft({ ...emptyDraft(), noDataset }));
  assert.throws(() => validateDraft({ ...emptyDraft(), dataset: prepared, noDataset: true }));
  assert.throws(() => validateDraft({ ...remove(emptyDraft()), extra: true }));
  const removed = remove(withVisual(prepared));
  for (const dimension of ['', ' team', 'bad\0field']) {
    const malformed = structuredClone(removed); malformed.sheets[0].visuals[0].dimension = dimension;
    assert.throws(() => validateDraft(malformed));
  }
  assert.throws(() => validateDraft({ ...removed, calculatedFields: [{ name: 'bad', role: 'measure', expression: '1 + "text"' }] }));
});
