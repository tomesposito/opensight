import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { create } from 'react-test-renderer';
import { AccessProvider, demoAccess } from '../build/test/access.js';
import { Application } from '../build/test/Application.js';
import { AppNavigation } from '../build/test/AppNavigation.js';
import { Author, AuthorCanvas } from '../build/test/Author.js';
import { AuthorToolbar } from '../build/test/AuthorToolbar.js';
import { ManageDataDialog } from '../build/test/ManageDataDialog.js';
import { CreateAnalysisDialog } from '../build/test/CreateAnalysisDialog.js';
import { LiveAuthorVisual } from '../build/test/LiveAuthorVisual.js';
import { authorReducer, emptyDraft, serializeDraft } from '../build/test/authoring.js';
import { createDraftStore } from '../build/test/local-drafts.js';

const prepared = { id: 'prepared', name: 'Team data', columns: [{ name: 'team', type: 'STRING' }, { name: 'amount', type: 'DECIMAL' }] };
const authored = dataset => authorReducer({ ...emptyDraft(), ...(dataset ? { dataset } : {}) }, { type: 'add', kind: 'bar' });

async function mount(t, { access = demoAccess, seed, sample = false } = {}) {
  const oldWindow = globalThis.window, oldAct = globalThis.IS_REACT_ACT_ENVIRONMENT;
  const values = new Map(), events = new EventTarget();
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const store = createDraftStore(() => storage, access);
  const id = seed ? store.save(seed) : undefined;
  const location = { hash: '#/home' };
  globalThis.window = {
    location, localStorage: storage,
    history: { pushState: (_s, _t, hash) => { location.hash = hash; }, replaceState: (_s, _t, hash) => { location.hash = hash; } },
    addEventListener: (...args) => events.addEventListener(...args), removeEventListener: (...args) => events.removeEventListener(...args),
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  };
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const queries = [];
  const api = {
    listPrepSources: async () => [{ ...prepared, ref: { dataset: prepared.id }, connectorId: 'file', available: true }],
    queryDataset: async id => { queries.push(id); return { rows: id === 'sales' ? [{ region: 'East', revenue: 10 }] : [{ team: 'North', amount: 10 }] }; },
  };
  const element = createElement(AccessProvider, { access }, createElement(Application, { api, fixtures: [] }));
  let renderer;
  await act(async () => { renderer = create(element); });
  t.after(async () => { await act(() => renderer.unmount()); globalThis.window = oldWindow; globalThis.IS_REACT_ACT_ENVIRONMENT = oldAct; });
  const button = (label, root = renderer.root) => root.findAllByType('button').find(b => b.props.children === label || b.props['aria-label'] === label);
  const click = async (label, root) => { const target = button(label, root); assert.ok(target, label); await act(async () => { target.props.onClick(); }); };
  const navigate = route => act(async () => { renderer.root.findByType(AppNavigation).props.navigate(route); });
  if (sample && access.mode === 'local') await click('Try sample data');
  await navigate({ page: 'author', ...(id ? { draftId: id } : {}) });
  const draft = () => renderer.root.findByType(AuthorToolbar).props.draft;
  const empty = () => {
    assert.equal(draft().noDataset, true);
    assert.equal(renderer.root.findAllByType(AuthorCanvas).length, 0, 'no fields, wells or fixture previews are mounted');
    assert.equal(renderer.root.findAllByType(LiveAuthorVisual).length, 0, 'no live sample queries can run');
    const layout = renderer.root.findByProps({ className: 'author-layout author-layout-empty' });
    const text = JSON.stringify(layout.findAllByType('p').map(p => p.children));
    assert.match(text, /No dataset selected/);
    assert.doesNotMatch(text, /region|revenue|order_date|profit/);
    assert.ok(button('Add data', layout));
  };
  const remove = async () => {
    await click('Manage data…');
    await click('Remove dataset', renderer.root.findByType(ManageDataDialog));
    await click('Remove dataset', renderer.root.findByProps({ role: 'alertdialog' }));
    empty();
  };
  return { store, queries, draft, empty, remove, click, navigate, get root() { return renderer.root; },
    text: () => JSON.stringify(renderer.toJSON()),
    reload: async () => { await act(() => renderer.unmount()); await act(async () => { renderer = create(element); }); },
  };
}

for (const [label, options] of [
  ['implicit demo sample', { seed: authored() }],
  ['local sample', { access: { mode: 'local' }, sample: true, seed: authored() }],
  ['prepared data with sample loaded', { access: { mode: 'local' }, sample: true, seed: authored(prepared) }],
  ['hosted sample fallback', { access: { mode: 'hosted', session: { id: 'author', namespaceId: 'test', role: 'author' } }, seed: authored() }],
]) test(`issue #129 application: remove/reopen, undo/redo and re-entry for ${label}`, async t => {
  const ui = await mount(t, options);
  const before = structuredClone(ui.draft());
  assert.equal(ui.root.findAllByType(AuthorCanvas).length, 1);
  await ui.remove();
  const queryCount = ui.queries.length;
  assert.equal(ui.root.findByType(Author).props.dataset, undefined, 'Application has cleared its old selection');
  await ui.click('Manage data…');
  const dialog = ui.root.findByType(ManageDataDialog);
  assert.ok(dialog.props.sampleLoaded, 'sample remains available at the app level');
  assert.equal(dialog.findAllByType('tbody')[0].findAllByType('tr').length, 1, 'only the empty-state row remains');
  assert.match(ui.text(), /No datasets in this analysis yet/);
  assert.equal(dialog.findAllByType('button').some(b => b.props.children === 'Replace'), false);
  assert.equal(dialog.findAllByType('td').some(td => JSON.stringify(td.children.map(c => typeof c === 'string' ? c : c.props.children)).includes('Sample sales data')), false);
  await ui.click('Cancel', dialog);
  assert.equal(ui.queries.length, queryCount, 'removal/reopen never issues a sample fallback query');
  await ui.click('Undo');
  assert.deepEqual(ui.draft(), before);
  assert.equal(ui.root.findAllByType(AuthorCanvas).length, 1);
  await ui.click('Redo'); ui.empty();
  await ui.click('Save draft');
  assert.deepEqual(ui.store.restore().draft, ui.draft());
  await ui.navigate({ page: 'my-stuff' });
  await ui.navigate({ page: 'author' }); ui.empty();
  await ui.reload(); ui.empty();
});

test('issue #129 application: fresh demo uses sample, fresh local stays empty, and workspace sample availability is independent', async t => {
  const ui = await mount(t, { access: { mode: 'local' } });
  assert.equal(ui.draft().noDataset, undefined);
  assert.equal(ui.root.findAllByType(AuthorCanvas).length, 0);
  await ui.click('Try sample data');
  assert.equal(ui.root.findAllByType(AuthorCanvas).length, 1);
  await ui.click('Remove sample data');
  assert.equal(ui.root.findAllByType(AuthorCanvas).length, 0);
  assert.equal(ui.draft().noDataset, undefined, 'workspace removal keeps existing fallback semantics');
  await ui.click('Try sample data');
  await ui.remove();
  await ui.click('Save draft');
  await ui.navigate({ page: 'home' });
  assert.match(ui.text(), /Sample sales data loaded/);
  await ui.click('Remove sample data');
  await ui.click('Try sample data');
  await ui.navigate({ page: 'author' }); ui.empty();
  await ui.click('Try sample data');
  assert.equal(ui.draft().noDataset, undefined);
  assert.equal(ui.root.findAllByType(AuthorCanvas).length, 1);
});

for (const choice of ['sample:sales', 'dataset:prepared']) test(`issue #129 application: Create analysis selection ${choice} checkpoints removal and clears it`, async t => {
  const ui = await mount(t, { access: { mode: 'local' }, sample: true });
  await ui.remove();
  await ui.click('New analysis');
  assert.equal(ui.store.restore().draft.noDataset, true, 'keepCurrent saves removal even with no visuals or prior draft id');
  const dialog = ui.root.findByType(CreateAnalysisDialog);
  await act(async () => { dialog.findAllByProps({ type: 'radio' }).find(r => r.props.id.endsWith(choice)).props.onChange(); });
  await act(async () => { dialog.findByType('form').props.onSubmit({ preventDefault() {} }); });
  assert.equal(ui.draft().noDataset, undefined);
  assert.equal(ui.draft().dataset?.id, choice === 'sample:sales' ? undefined : 'prepared');
  assert.equal(ui.root.findAllByType(AuthorCanvas).length, 1);
});

for (const choice of ['sales', 'prepared']) test(`issue #129 application: dataset picker selection ${choice} clears removal`, async t => {
  const ui = await mount(t, { access: { mode: 'local' }, sample: true, seed: authored() });
  await ui.remove();
  const picker = ui.root.findByProps({ className: 'api-picker' }).findByType('select');
  assert.equal(picker.props.value, '', 'available sample is not shown as selected');
  await act(async () => { picker.props.onChange({ target: { value: choice } }); });
  assert.equal(ui.draft().noDataset, undefined);
  assert.equal(ui.root.findAllByType(AuthorCanvas).length, 1);
  await ui.click('Save draft');
  assert.equal(ui.store.restore().draft.noDataset, undefined);
});

test('issue #129 application: Manage data sample replacement saves, removes and undoes without invalid sales dataset', async t => {
  const ui = await mount(t, { access: { mode: 'local' }, sample: true, seed: { ...emptyDraft(), dataset: prepared } });
  await ui.click('Manage data…'); await ui.click('Replace');
  await act(async () => { ui.root.findByProps({ 'aria-label': 'Replacement dataset' }).props.onChange({ target: { value: 'sales' } }); });
  await ui.click('Replace dataset');
  assert.equal(ui.draft().dataset, undefined);
  assert.equal(ui.draft().noDataset, undefined);
  await ui.click('Save draft');
  assert.deepEqual(ui.store.restore().draft, ui.draft());
  const selectedSample = structuredClone(ui.draft());
  await ui.remove();
  await ui.click('Undo');
  assert.deepEqual(ui.draft(), selectedSample);
  await ui.click('Redo'); ui.empty();
  await ui.click('Try sample data');
  assert.equal(ui.draft().noDataset, undefined);
});

for (const access of [demoAccess, { mode: 'local' }]) test(`issue #129 application: bundle import after removal opens a dataset-backed draft in ${access.mode}`, async t => {
  const ui = await mount(t, { access, seed: authored(prepared) });
  await ui.remove();
  const file = new File([JSON.stringify(serializeDraft(authored()))], 'analysis.json');
  await act(async () => {
    ui.root.findByProps({ accept: '.qs,.json,application/zip,application/json' }).props.onChange({ currentTarget: { files: [file], value: 'analysis.json' } });
    await new Promise(resolve => setImmediate(resolve));
  });
  assert.equal(ui.draft().noDataset, undefined);
  assert.ok(ui.draft().bundle);
  assert.equal(ui.root.findAllByType(AuthorCanvas).length, 1);
  assert.equal(ui.store.list().some(entry => ui.store.open(entry.id).noDataset), true, 'import checkpoints the removed draft');
});

test('issue #129 application: removal and undo drive dirty state and autosave', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const ui = await mount(t, { seed: authored() });
  const before = structuredClone(ui.draft());
  await ui.remove();
  assert.match(ui.text(), /Unsaved changes/);
  await ui.click('Undo');
  assert.doesNotMatch(ui.text(), /Unsaved changes/);
  await ui.click('Redo');
  await act(async () => { t.mock.timers.tick(2000); });
  assert.equal(ui.store.restore().draft.noDataset, true);
  assert.doesNotMatch(ui.text(), /Unsaved changes/);
  await ui.click('Undo');
  await act(async () => { t.mock.timers.tick(2000); });
  assert.deepEqual(ui.store.restore().draft, before);
});
