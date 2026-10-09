import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { create } from 'react-test-renderer';
import { AccessProvider, demoAccess } from '../build/test/access.js';
import { Application } from '../build/test/Application.js';
import { AppNavigation } from '../build/test/AppNavigation.js';
import { AuthorCanvas } from '../build/test/Author.js';
import { LocalDrafts } from '../build/test/LocalDrafts.js';
import { createDraftStore } from '../build/test/local-drafts.js';
import fixtures from '../src/fixtures.generated.json' with { type: 'json' };

async function mount(t, access = { mode: 'local' }) {
  const oldWindow = globalThis.window, oldAct = globalThis.IS_REACT_ACT_ENVIRONMENT;
  const values = new Map(), storage = { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v) };
  const location = { hash: '#/home' }, queries = [];
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.window = { localStorage: storage, location, addEventListener() {}, removeEventListener() {},
    history: { pushState(_s, _t, hash) { location.hash = hash; }, replaceState(_s, _t, hash) { location.hash = hash; } },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  };
  const api = { async listPrepSources() { return []; }, async queryDataset(id, body) { queries.push(id); return { rows: body.measures[0].fieldId === 'row_count' ? [{ row_count: 8 }] : [{ region: 'East', revenue: 900 }] }; } };
  const element = createElement(AccessProvider, { access }, createElement(Application, { api, fixtures }));
  let renderer; await act(() => { renderer = create(element); });
  t.after(async () => { await act(() => renderer.unmount()); globalThis.window = oldWindow; globalThis.IS_REACT_ACT_ENVIRONMENT = oldAct; });
  return { queries, store: createDraftStore(() => storage, access), get root() { return renderer.root; }, text: () => JSON.stringify(renderer.toJSON()),
    navigate: page => act(() => renderer.root.findByType(AppNavigation).props.navigate({ page })),
    async click(label) { const b = renderer.root.findAllByType('button').find(n => n.props.children === label || n.props['aria-label'] === label); assert.ok(b, label); await act(() => b.props.onClick()); },
    async reload() { await act(() => renderer.unmount()); await act(() => { renderer = create(element); }); },
  };
}

test('fresh local Home, Author, Analyses and Dashboards contain no staged content or implicit sales requests', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const ui = await mount(t);
  assert.match(ui.text(), /Start with your data/); assert.match(ui.text(), /Upload or connect data/);
  assert.doesNotMatch(ui.text(), /Pinned synthetic sales|fixed East/);
  await ui.navigate('author');
  assert.match(ui.text(), /Add data to your analysis/);
  assert.equal(ui.root.findAllByType(AuthorCanvas).length, 0);
  assert.doesNotMatch(ui.text(), /Local sales dataset|Assign revenue|Assign region|8 sample rows/);
  await act(() => t.mock.timers.tick(5000));
  assert.deepEqual(ui.store.list(), [], 'Opening an untouched empty canvas must not auto-save an analysis');
  await ui.navigate('analyses'); assert.match(ui.text(), /No saved analyses yet/);
  await ui.navigate('dashboards'); assert.match(ui.text(), /No dashboards yet/);
  assert.match(ui.text(), /Publishing dashboards needs a hosted API/);
  assert.deepEqual(ui.queries, []);
  await ui.navigate('home'); await ui.reload(); assert.match(ui.text(), /Start with your data/);
});

test('sample data is explicit, labeled across routes and drafts, removable, and off after reload', async t => {
  const ui = await mount(t);
  await ui.click('Try sample data'); assert.match(ui.text(), /Pinned sample data/);
  await ui.navigate('author'); assert.match(ui.text(), /Sample sales data/); assert.match(ui.text(), /8.*sample rows/);
  assert.ok(ui.queries.includes('sales'));
  await act(() => ui.root.findByProps({ className: 'add-visual' }).props.onSubmit({ preventDefault() {} }));
  await ui.click('Save draft');
  assert.equal(ui.store.list()[0].sample, true);
  await ui.navigate('analyses'); assert.match(ui.text(), /Sample data/);
  await ui.click('Remove sample data');
  await act(() => ui.root.findByType(LocalDrafts).props.onOpen(ui.store.list()[0].id));
  assert.match(ui.text(), /Add data to your analysis/);
  assert.equal(ui.root.findAllByType(AuthorCanvas).length, 0);
  const count = ui.queries.length;
  await ui.navigate('home'); assert.match(ui.text(), /Start with your data/);
  await ui.navigate('author'); assert.equal(ui.queries.length, count, 'A restored sample draft cannot opt in on its own');
  await ui.click('Try sample data'); assert.equal(ui.root.findAllByType(AuthorCanvas).length, 1);
  await ui.reload(); assert.match(ui.text(), /Add data to your analysis/);
});

test('static demo retains its showcase and sample author dataset without local empty-first actions', async t => {
  const ui = await mount(t, demoAccess);
  assert.match(ui.text(), /Pinned sample data/); assert.doesNotMatch(ui.text(), /Try sample data|Remove sample data|Upload or connect data/);
  await ui.navigate('author'); assert.match(ui.text(), /Local sales dataset/); assert.match(ui.text(), /8 sample rows/);
  assert.equal(ui.root.findAllByType(AuthorCanvas).length, 1);
  assert.deepEqual(ui.queries, []);
});
