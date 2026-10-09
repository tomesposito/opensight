import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { create } from 'react-test-renderer';
import { AccessProvider } from '../build/test/access.js';
import { Application } from '../build/test/Application.js';
import { AppNavigation } from '../build/test/AppNavigation.js';
import { AuthorCanvas } from '../build/test/Author.js';
import { CreateAnalysisDialog } from '../build/test/CreateAnalysisDialog.js';
import { createDraftStore } from '../build/test/local-drafts.js';
import { emptyDraft } from '../build/test/authoring.js';

const dataset = { id: 'prepared-upload', name: 'Uploaded revenue', columns: [{ name: 'team', type: 'STRING' }, { name: 'amount', type: 'INTEGER' }] };
const prepared = { ...dataset, ref: { dataset: dataset.id }, connectorId: 'file', available: true };
async function mount(t, { sources = [prepared], hash = '#/analyses', access = { mode: 'local' } } = {}) {
  const oldWindow = globalThis.window, oldAct = globalThis.IS_REACT_ACT_ENVIRONMENT;
  const values = new Map(), storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const location = { hash }, requests = [], events = new EventTarget();
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.window = { localStorage: storage, location, addEventListener: (...args) => events.addEventListener(...args), removeEventListener: (...args) => events.removeEventListener(...args),
    history: { pushState(_s, _t, value) { location.hash = value; }, replaceState(_s, _t, value) { location.hash = value; } },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  };
  const api = { listPrepSources: async () => { requests.push('catalog'); return sources; }, listPrepDatasets: async () => ({ datasets: [] }), queryDataset: async id => { requests.push(id); return { rows: [{ row_count: 8 }] }; } };
  const element = createElement(AccessProvider, { access }, createElement(Application, { api, fixtures: [] }));
  let renderer; await act(() => { renderer = create(element); });
  t.after(async () => { await act(() => renderer.unmount()); globalThis.window = oldWindow; globalThis.IS_REACT_ACT_ENVIRONMENT = oldAct; });
  return { location, requests, store: createDraftStore(() => storage, access), get root() { return renderer.root; }, text: () => JSON.stringify(renderer.toJSON()),
    navigate: route => act(() => renderer.root.findByType(AppNavigation).props.navigate(route)),
    link: label => act(() => renderer.root.findAllByType('a').find(a => a.props.children === label).props.onClick({ button: 0, preventDefault() {} })),
    click: label => act(() => renderer.root.findAllByType('button').find(b => b.props.children === label).props.onClick()),
    select: async () => {
      const dialog = renderer.root.findByType(CreateAnalysisDialog);
      await act(() => dialog.findByProps({ type: 'radio' }).props.onChange());
      await act(() => dialog.findByType('form').props.onSubmit({ preventDefault() {} }));
    },
    reload: async () => { await act(() => renderer.unmount()); await act(() => { renderer = create(element); }); },
  };
}

test('New analysis binds an uploaded prepared dataset, bypasses old draft restoration and saves a reloadable draft', async t => {
  const ui = await mount(t);
  const old = ui.store.save({ ...emptyDraft(), title: 'Existing work' });
  await ui.link('New analysis');
  assert.equal(ui.root.findAllByType(AuthorCanvas).length, 0);
  assert.equal(ui.store.list().length, 1);
  await ui.select();
  const canvas = ui.root.findByType(AuthorCanvas);
  assert.deepEqual(canvas.props.draft.dataset, dataset);
  assert.equal(canvas.props.draft.title, 'Untitled analysis');
  assert.equal(canvas.props.draft.sheets[0].visuals.length, 0);
  await ui.click('Save draft');
  assert.equal(ui.store.list().length, 2); assert.equal(ui.store.open(old).title, 'Existing work');
  await ui.reload(); assert.deepEqual(ui.root.findByType(AuthorCanvas).props.draft.dataset, dataset);
  assert.equal(ui.requests.includes('sales'), false);
});

test('Author New analysis preserves current work on Cancel and starts a separate bound draft on Select', async t => {
  const ui = await mount(t);
  await ui.link('New analysis'); await ui.select();
  await act(() => ui.root.findByProps({ className: 'analysis-title' }).findByType('input').props.onChange({ target: { value: 'Keep this title' } }));
  await ui.click('New analysis');
  assert.equal(ui.store.list()[0].name, 'Keep this title');
  await ui.click('Cancel');
  assert.equal(ui.root.findByType(AuthorCanvas).props.draft.title, 'Keep this title');
  await ui.click('New analysis'); await ui.select();
  assert.equal(ui.root.findByType(AuthorCanvas).props.draft.title, 'Untitled analysis');
  await ui.click('Save draft'); assert.equal(ui.store.list().length, 2);
  const picker = ui.root.findAllByType('select').find(n => n.props.children?.[0]?.props?.children === 'Choose prepared data…');
  assert.ok(picker, 'Existing inline dataset picker remains available');
  await act(() => picker.props.onChange({ target: { value: dataset.id } }));
  assert.deepEqual(ui.root.findByType(AuthorCanvas).props.draft.dataset, dataset);
});

test('empty direct new-analysis route has no staged sample, phantom draft or Author until selected', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const ui = await mount(t, { sources: [], hash: '#/analyses/new' });
  assert.match(ui.text(), /No datasets yet/); assert.doesNotMatch(ui.text(), /Sample sales data/);
  await act(() => t.mock.timers.tick(5000)); assert.deepEqual(ui.store.list(), []);
  await ui.click('Cancel'); assert.equal(ui.location.hash, '#/analyses');
  await ui.navigate({ page: 'author' }); await ui.click('New analysis');
  assert.match(ui.text(), /No datasets yet/);
  await act(() => t.mock.timers.tick(5000)); assert.deepEqual(ui.store.list(), []);
  await ui.click('Cancel'); await ui.navigate({ page: 'analyses' });
  await ui.link('New analysis'); await ui.click('Create dataset');
  assert.equal(ui.location.hash, '#/data/preparation'); assert.equal(ui.requests.includes('sales'), false);
});

test('explicit local sample opt-in enables Select and keeps the sales query binding', async t => {
  const ui = await mount(t, { sources: [], hash: '#/home' });
  await ui.click('Try sample data'); await ui.navigate({ page: 'analyses' }); await ui.link('New analysis');
  assert.match(ui.text(), /Sample sales data/); await ui.select();
  assert.equal(ui.root.findByType(AuthorCanvas).props.draft.dataset, undefined);
  assert.ok(ui.requests.includes('sales'));
});

test('a new route entry always reopens the picker, including after a prior selection', async t => {
  const ui = await mount(t);
  await ui.link('New analysis'); await ui.select();
  await ui.navigate({ page: 'analyses' }); await ui.link('New analysis');
  assert.equal(ui.root.findAllByType(CreateAnalysisDialog).length, 1);
  assert.equal(ui.root.findAllByType(AuthorCanvas).length, 0);
  await ui.reload(); assert.equal(ui.root.findAllByType(CreateAnalysisDialog).length, 1);
});

test('direct new-analysis URLs retain the hosted build gate without catalog requests', async t => {
  const ui = await mount(t, { hash: '#/analyses/new', access: { mode: 'hosted', session: { id: 'reader', namespaceId: 'workspace', name: 'Reader', role: 'reader' } } });
  assert.match(ui.text(), /SECURITY_BUILD_REQUIRED/); assert.deepEqual(ui.requests, []);
  assert.equal(ui.root.findAllByType(CreateAnalysisDialog).length, 0);
});
