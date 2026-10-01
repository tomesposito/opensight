import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { create } from 'react-test-renderer';
import { renderToStaticMarkup } from 'react-dom/server';
import { ROLES, hasCapability } from '@opensight/query-engine/browser';
import { AccessProvider, demoAccess } from '../build/test/access.js';
import { Application } from '../build/test/Application.js';
import { AppNavigation } from '../build/test/AppNavigation.js';
import { pages, parseRoute, routeHash } from '../build/test/app-navigation.js';
import { AuthorCanvas } from '../build/test/Author.js';
import { LocalDrafts } from '../build/test/LocalDrafts.js';
import { DataPrep } from '../build/test/DataPrep.js';
import { DataSources } from '../build/test/DataSources.js';
import { AISettings } from '../build/test/AISettings.js';
import { UserManagement } from '../build/test/UserManagement.js';
import { createDraftStore } from '../build/test/local-drafts.js';
import { authorReducer, emptyDraft } from '../build/test/authoring.js';

const hosted = role => ({ mode: 'hosted', session: { id: 'test-user', namespaceId: 'test-workspace', name: 'User', role } });
const accesses = [{ mode: 'local' }, demoAccess, ...ROLES.map(hosted), { mode: 'hosted' }, hosted('admin')];
const shell = (access, page) => renderToStaticMarkup(createElement(AccessProvider, { access }, createElement(AppNavigation, { route: { page }, navigate() {} })));
for (const access of accesses) test(`product and secondary navigation preserve gates: ${access.mode}/${access.session?.role ?? 'none'}`, () => {
  const home = shell(access, 'home');
  const product = home.match(/<nav class="app-nav"[\s\S]*?<\/nav>/)[0];
  const canBuild = access.mode === 'local' || hasCapability(access.session?.role, 'build');
  assert.match(product, />Home<\/a>/); assert.match(product, />Admin<\/a>/);
  for (const label of ['Analyses', 'Data']) assert.equal(product.includes(`>${label}</a>`), canBuild);
  assert.doesNotMatch(product, /Developer|fixtures|definition|AI provider|Users|Mode/);
  assert.equal(shell(access, 'author').includes('aria-label="Analyses"'), canBuild);
  assert.match(home, /href="#\/home" aria-current="page"/);
  const admin = shell(access, 'security');
  for (const page of ['security', 'organization', 'automation']) assert.ok(admin.includes(`#${pages[page].path}`));
  for (const label of ['AI provider settings', 'Users and invitations']) assert.equal(admin.includes(label), access.mode === 'hosted' && hasCapability(access.session?.role, 'admin'));
  assert.equal(admin.includes('Developer fixture preview'), access.mode === 'demo' || canBuild);
  assert.equal(admin.includes('href="#/admin/developer/api"'), access.mode !== 'demo');
  if (access.mode === 'demo') assert.match(admin, /aria-disabled="true">API definition preview · Needs hosted API/);
  for (const page of Object.keys(pages)) assert.doesNotMatch(shell(access, page), /Definition explorer|source-picker/);
});

test('routes round-trip explicit draft URLs and reject malformed or unknown links', () => {
  for (const page of Object.keys(pages)) assert.deepEqual(parseRoute(routeHash({ page })), { page });
  for (const route of [{ page: 'author', draftId: 'saved-123' }, { page: 'author', newAnalysis: true }]) assert.deepEqual(parseRoute(routeHash(route)), route);
  assert.deepEqual(parseRoute(''), { page: 'home' });
  for (const hash of ['#/unknown', '#/analyses/drafts/', '#/analyses/drafts/%2F', '#/analyses/drafts/<script>', '#invite=abc']) assert.equal(parseRoute(hash), undefined);
});

async function mount(t, access = demoAccess, hash = '#/home', seed) {
  const oldWindow = globalThis.window, oldAct = globalThis.IS_REACT_ACT_ENVIRONMENT;
  const storageValues = new Map(), events = new EventTarget();
  const storage = { getItem: k => storageValues.get(k) ?? null, setItem: (k, v) => storageValues.set(k, v) };
  const store = createDraftStore(() => storage, access), seeded = seed?.(store);
  const location = { hash: typeof hash === 'function' ? hash(seeded) : hash };
  const history = [location.hash]; let position = 0;
  const historyChange = (value, replace) => { location.hash = value; if (replace) history[position] = value; else { history.splice(++position); history.push(value); } };
  globalThis.window = {
    location, localStorage: storage,
    history: { pushState: (_s, _t, value) => historyChange(value, false), replaceState: (_s, _t, value) => historyChange(value, true) },
    addEventListener: (...args) => events.addEventListener(...args), removeEventListener: (...args) => events.removeEventListener(...args),
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  };
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const api = new Proxy({}, { get() { return () => { assert.fail('Navigation must not bypass access gates and request data'); }; } });
  const element = createElement(AccessProvider, { access }, createElement(Application, { api, fixtures: [] }));
  let renderer; await act(() => { renderer = create(element); });
  t.after(async () => { await act(() => renderer.unmount()); globalThis.window = oldWindow; globalThis.IS_REACT_ACT_ENVIRONMENT = oldAct; });
  return { store, seeded, storage, location, get root() { return renderer.root; }, text: () => JSON.stringify(renderer.toJSON()),
    navigate: route => act(() => renderer.root.findByType(AppNavigation).props.navigate(route)),
    link: async label => { const a = renderer.root.findAllByType('a').find(a => a.props.children === label); assert.ok(a, label); await act(() => a.props.onClick({ button: 0, preventDefault() {} })); },
    back: () => act(() => { location.hash = history[--position]; events.dispatchEvent(new Event('hashchange')); }),
    forward: () => act(() => { location.hash = history[++position]; events.dispatchEvent(new Event('hashchange')); }),
    reload: async () => { await act(() => renderer.unmount()); await act(() => { renderer = create(element); }); },
  };
}
const authored = title => authorReducer({ ...emptyDraft(), title }, { type: 'add', kind: 'bar' });

test('Analyses lists the #32 collection, renames/deletes it, and opens its exact saved chart', async t => {
  const ui = await mount(t, demoAccess, '#/analyses', store => [store.save(authored('First chart')), store.save(authored('Second chart'))]);
  const list = () => ui.root.findByType(LocalDrafts);
  assert.equal(list().props.expanded, true);
  assert.equal(list().props.entries.length, 2);
  assert.equal(list().findAllByType('time').length, 2);
  await act(() => list().props.onRename(ui.seeded[0], 'Renamed chart'));
  assert.equal(ui.store.list().find(e => e.id === ui.seeded[0]).name, 'Renamed chart');
  await act(() => list().props.onDelete(ui.seeded[1]));
  assert.equal(list().props.entries.length, 1);
  await act(() => list().props.onOpen(ui.seeded[0]));
  assert.equal(ui.location.hash, `#/analyses/drafts/${ui.seeded[0]}`);
  assert.equal(ui.root.findByType(AuthorCanvas).props.draft.title, 'Renamed chart');
  assert.equal(ui.root.findByType(AuthorCanvas).props.draft.sheets[0].visuals.length, 1);
  await ui.reload();
  assert.equal(ui.root.findByType(AuthorCanvas).props.draft.title, 'Renamed chart');
  await ui.back(); assert.equal(ui.location.hash, '#/analyses');
  assert.equal(ui.root.findByType(LocalDrafts).props.entries[0].name, 'Renamed chart');
  await ui.forward(); assert.equal(ui.root.findByType(AuthorCanvas).props.draft.title, 'Renamed chart');
});

test('New analysis starts blank, saves a new entry and updates its reloadable URL without remounting the editor', async t => {
  const ui = await mount(t, demoAccess, '#/analyses', store => store.save(authored('Existing chart')));
  await ui.link('New analysis');
  const canvas = ui.root.findByType(AuthorCanvas);
  assert.equal(canvas.props.draft.title, 'Untitled analysis');
  assert.equal(canvas.props.draft.sheets[0].visuals.length, 0);
  await act(() => ui.root.findAllByType('button').find(b => b.props.children === 'Save draft').props.onClick());
  assert.match(ui.location.hash, /^#\/analyses\/drafts\//);
  assert.equal(ui.root.findByType(AuthorCanvas), canvas);
  assert.equal(ui.store.list().length, 2);
  await ui.reload(); assert.equal(ui.root.findByType(AuthorCanvas).props.draft.title, 'Untitled analysis');
});

test('direct missing/deleted draft links never open the active draft or start a sample chart', async t => {
  const ui = await mount(t, demoAccess, '#/analyses/drafts/missing', store => store.save(authored('Do not open me')));
  assert.match(ui.text(), /This local draft no longer exists/);
  assert.equal(ui.root.findAllByType(AuthorCanvas).length, 0);
  assert.equal(ui.store.restore().draft.title, 'Do not open me');
  await ui.link('My analyses'); assert.equal(ui.root.findByType(LocalDrafts).props.entries.length, 1);
});

test('Analyses reads only its mode/identity collection and reports corrupt storage', async t => {
  const ui = await mount(t, demoAccess, '#/analyses');
  createDraftStore(() => ui.storage, { mode: 'local' }).save(authored('Local only'));
  createDraftStore(() => ui.storage, hosted('author')).save(authored('Hosted only'));
  await act(() => ui.root.findByType(LocalDrafts).props.onRefresh());
  assert.equal(ui.root.findByType(LocalDrafts).props.entries.length, 0);
  ui.storage.setItem('opensight.author.drafts.v1.demo', '{broken');
  await act(() => ui.root.findByType(LocalDrafts).props.onRefresh());
  assert.match(ui.text(), /Saved drafts are corrupt or unsupported/);
  assert.equal(ui.storage.getItem('opensight.author.drafts.v1.demo'), '{broken');
});

for (const role of ['reader', 'reader_ai', undefined]) test(`direct URLs cannot bypass hosted role gates: ${role}`, async t => {
  const ui = await mount(t, role ? hosted(role) : { mode: 'hosted' });
  for (const page of ['analyses', 'author', 'data-prep', 'data-sources', 'fixtures', 'ai-settings', 'users']) {
    await ui.navigate({ page });
    assert.match(ui.text(), /SECURITY_(BUILD|ADMIN)_REQUIRED/);
    for (const Component of [AuthorCanvas, LocalDrafts, DataPrep, DataSources, AISettings, UserManagement]) assert.equal(ui.root.findAllByType(Component).length, 0);
  }
  await ui.link('Home'); assert.doesNotMatch(ui.text(), /SECURITY_(BUILD|ADMIN)_REQUIRED/);
});

test('unknown URLs have recovery links and product navigation works through browser history', async t => {
  const ui = await mount(t, demoAccess, '#/unknown');
  assert.match(ui.text(), /Page not found/);
  await ui.link('Home'); await ui.link('Analyses'); await ui.link('Data'); await ui.link('Admin');
  assert.match(ui.text(), /Security & namespaces/);
  await ui.back(); assert.equal(ui.location.hash, '#/data/preparation');
  await ui.back(); assert.equal(ui.location.hash, '#/analyses');
  await ui.forward(); assert.equal(ui.location.hash, '#/data/preparation');
});

test('Issue #35: the product header names OpenSight and the current page after #31', () => {
  for (const access of [{ mode: 'local' }, demoAccess, hosted('author')]) {
    for (const page of ['home', 'author', 'fixtures']) {
      const html = shell(access, page);
      assert.match(html, /class="brand"[^>]*>[\s\S]*?OpenSight<\/a>/);
      assert.ok(html.includes(`<span class="header-caption">${pages[page].title}</span>`));
      for (const label of ['Home', 'Analyses', 'Data', 'Admin']) assert.ok(html.includes(`>${label}</a>`));
      assert.doesNotMatch(html, /Definition explorer/);
    }
  }
});
