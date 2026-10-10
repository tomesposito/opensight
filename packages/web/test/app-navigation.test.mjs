import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { create } from 'react-test-renderer';
import { renderToStaticMarkup } from 'react-dom/server';
import { ROLES, hasCapability } from '@opensight/query-engine/browser';
import { AccessProvider, demoAccess } from '../build/test/access.js';
import { Application } from '../build/test/Application.js';
import { AppNavigation } from '../build/test/AppNavigation.js';
import { pages, parseRoute, recordRecentPage, routeHash } from '../build/test/app-navigation.js';
import { AuthorCanvas } from '../build/test/Author.js';
import { LocalDrafts } from '../build/test/LocalDrafts.js';
import { DataPrep } from '../build/test/DataPrep.js';
import { DataSources } from '../build/test/DataSources.js';
import { AISettings } from '../build/test/AISettings.js';
import { UserManagement } from '../build/test/UserManagement.js';
import { createDraftStore } from '../build/test/local-drafts.js';
import { authorReducer, emptyDraft } from '../build/test/authoring.js';
import { MyStuff, FolderEmptyState } from '../build/test/NavigationPages.js';

const hosted = role => ({ mode: 'hosted', session: { id: 'test-user', namespaceId: 'test-workspace', name: 'User', role } });
const accesses = [{ mode: 'local' }, demoAccess, ...ROLES.map(hosted), { mode: 'hosted' }, hosted('admin')];
const shell = (access, page) => renderToStaticMarkup(createElement(AccessProvider, { access }, createElement(AppNavigation, { route: { page }, navigate() {} })));
for (const access of accesses) test(`product and secondary navigation preserve gates: ${access.mode}/${access.session?.role ?? 'none'}`, () => {
  const home = shell(access, 'home');
  const product = home.match(/<nav class="app-nav"[\s\S]*?<\/nav>/)[0];
  const canBuild = access.mode === 'local' || hasCapability(access.session?.role, 'build');
  assert.match(product, />My stuff<\/a>/); assert.doesNotMatch(product, />Home<\/a>|>Admin<\/a>/);
  assert.match(home, /aria-controls="more-navigation"/);
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

test('session recents deduplicate, cap history, and exclude editor state and denied pages', () => {
  const access = { mode: 'local' };
  let history = [];
  for (const page of ['home', 'my-stuff', 'analyses', 'data-prep', 'data-sources', 'my-folders', 'shared-folders']) history = recordRecentPage(history, page, access);
  assert.deepEqual(history, ['shared-folders', 'my-folders', 'data-sources', 'data-prep', 'analyses', 'my-stuff']);
  history = recordRecentPage(history, 'analyses', access);
  assert.equal(history[0], 'analyses'); assert.equal(history.filter(page => page === 'analyses').length, 1);
  assert.deepEqual(recordRecentPage(history, 'author', access), history);
  assert.deepEqual(recordRecentPage(history, undefined, access), history);
  assert.deepEqual(recordRecentPage(history, 'analyses', hosted('reader')), ['shared-folders', 'my-folders', 'my-stuff']);
  assert.deepEqual(recordRecentPage([], 'api', demoAccess), []);
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
    link: async label => { const a = renderer.root.findAllByType('a').find(a => a.children.includes(label)); assert.ok(a, label); await act(() => a.props.onClick({ button: 0, preventDefault() {} })); },
    back: () => act(() => { location.hash = history[--position]; events.dispatchEvent(new Event('hashchange')); }),
    forward: () => act(() => { location.hash = history[++position]; events.dispatchEvent(new Event('hashchange')); }),
    reload: async () => { await act(() => renderer.unmount()); await act(() => { renderer = create(element); }); },
  };
}
const authored = title => authorReducer({ ...emptyDraft(), title }, { type: 'add', kind: 'bar' });

for (const access of [{ mode: 'local' }, demoAccess, hosted('reader'), hosted('admin')]) test(`folder entry routes are honest and do not request data in ${access.mode}/${access.session?.role}`, async t => {
  const ui = await mount(t, access, '#/folders/mine');
  assert.equal(ui.root.findByType(FolderEmptyState).props.shared, false);
  assert.match(ui.text(), /Folder browsing is not available here yet/);
  assert.match(ui.text(), access.mode === 'hosted' ? /Your hosted folders have not been loaded/ : /need a hosted API/);
  await ui.navigate({ page: 'shared-folders' });
  assert.equal(ui.location.hash, '#/folders/shared');
  assert.equal(ui.root.findByType(FolderEmptyState).props.shared, true);
  await ui.reload(); assert.equal(ui.root.findByType(FolderEmptyState).props.shared, true);
  await ui.link('About folders and sharing'); assert.equal(ui.location.hash, '#/admin/organization');
  await ui.back(); assert.equal(ui.location.hash, '#/folders/shared');
});

test('My stuff starts empty and shows only real session visits with gated collection links', async t => {
  const ui = await mount(t, { mode: 'local' }, '#/my-stuff');
  const recent = () => ui.root.findByType(MyStuff).props.recentPages;
  assert.deepEqual(recent(), []);
  assert.match(ui.text(), /No recent pages yet/);
  await ui.navigate({ page: 'my-folders' });
  await ui.navigate({ page: 'shared-folders' });
  await ui.navigate({ page: 'my-stuff' });
  assert.deepEqual(recent(), ['shared-folders', 'my-folders']);
  await ui.reload(); assert.deepEqual(recent(), []);
  for (const access of [demoAccess, hosted('reader')]) {
    const html = renderToStaticMarkup(createElement(AccessProvider, { access }, createElement(MyStuff, { recentPages: [], navigate() {} })));
    assert.equal(html.includes('href="#/analyses"'), access.mode === 'demo');
    assert.doesNotMatch(html, /href="#\/dashboards"/);
  }
});

test('rail preserves reference order, groups Admin under More, and puts Recents last', async t => {
  const ui = await mount(t, { mode: 'local' }, '#/my-stuff');
  const navigation = () => ui.root.findByType(AppNavigation);
  const rail = () => navigation().findByProps({ id: 'product-navigation' });
  const product = rail().findByProps({ 'aria-label': 'Product' });
  assert.deepEqual(product.findAllByType('a').map(link => link.children.at(-1)), ['My stuff', 'Analyses', 'Dashboards', 'Data', 'My folders', 'Shared folders']);
  assert.equal(product.findAllByType('button')[0].props['aria-label'], 'Search navigation and commands');
  assert.equal(rail().children.at(-1).props['aria-label'], 'Recents');
  assert.equal(rail().findByProps({ id: 'more-navigation' }).props.hidden, true);
  await act(() => rail().findByProps({ className: 'rail-more' }).props.onClick());
  assert.equal(rail().findByProps({ id: 'more-navigation' }).props.hidden, false);
  await ui.link('Security & namespaces');
  assert.equal(ui.location.hash, '#/admin/security');
  assert.equal(rail().findByProps({ id: 'more-navigation' }).props.hidden, false);
  assert.deepEqual(navigation().props.recentPages, ['my-stuff']);
  const breadcrumb = navigation().findByProps({ 'aria-label': 'Breadcrumb' });
  assert.deepEqual(breadcrumb.findAllByType('a').map(link => link.children[0]), ['Home', 'Admin']);
  assert.equal(breadcrumb.findByProps({ className: 'header-caption' }).props.children, 'Security & namespaces');
  await ui.reload(); assert.equal(rail().findByProps({ id: 'more-navigation' }).props.hidden, false);
});

test('account disclosure presents the real hosted identity and invokes existing sign out', async t => {
  let signOuts = 0;
  const ui = await mount(t, { ...hosted('author'), signOut: async () => { signOuts++; } }, '#/my-stuff');
  const account = ui.root.findByType(AppNavigation).findByType('details');
  assert.equal(account.findByType('summary').props['aria-label'], 'Account');
  assert.equal(account.findByType('strong').props.children, 'User');
  await act(() => account.findByType('button').props.onClick());
  assert.equal(signOuts, 1);
  let focused = false;
  const node = { open: true, querySelector: () => ({ focus() { focused = true; } }) };
  account.props.onKeyDown({ key: 'Escape', currentTarget: node });
  assert.equal(node.open, false); assert.equal(focused, true);
});

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
  assert.equal(ui.root.findAllByType(AuthorCanvas).length, 0, 'The dataset dialog precedes the Author');
  await act(() => ui.root.findByProps({ type: 'radio' }).props.onChange());
  await act(() => ui.root.findByType('dialog').findByType('form').props.onSubmit({ preventDefault() {} }));
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
  const refresh = () => act(() => ui.root.findAllByType('button').find(button => button.props.children === 'Refresh drafts').props.onClick());
  await refresh();
  assert.match(ui.text(), /Create your first analysis and find it here/);
  assert.doesNotMatch(ui.text(), /Local only|Hosted only/);
  ui.storage.setItem('opensight.author.drafts.v1.demo', '{broken');
  await refresh();
  assert.match(ui.text(), /Saved analyses on this device could not be read/);
  assert.match(ui.text(), /Reload to retry, or import an exported/);
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
  await ui.link('Home'); await ui.link('Analyses'); await ui.link('Data'); await ui.link('Security & namespaces');
  assert.match(ui.text(), /Security & namespaces/);
  await ui.back(); assert.equal(ui.location.hash, '#/data');
  await ui.back(); assert.equal(ui.location.hash, '#/analyses');
  await ui.forward(); assert.equal(ui.location.hash, '#/data');
});

test('Issue #35: the product header names OpenSight and the current page after #31', () => {
  for (const access of [{ mode: 'local' }, demoAccess, hosted('author')]) {
    for (const page of ['home', 'author', 'fixtures']) {
      const html = shell(access, page);
      assert.match(html, /class="brand"[^>]*>[\s\S]*?OpenSight<\/a>/);
      assert.match(html, /aria-label="Breadcrumb"/);
      if (page !== 'home') assert.ok(html.includes(`<span class="header-caption" aria-current="page">${pages[page].title}</span>`));
      for (const label of ['Home', 'My stuff', 'Analyses', 'Data']) assert.ok(html.includes(`>${label}</a>`));
      assert.doesNotMatch(html, /Definition explorer/);
    }
  }
});

test('Author puts its editable title in the product band and keeps Rename and draft identity intact', async t => {
  const ui = await mount(t, demoAccess, '#/analyses/author');
  const navigation = ui.root.findByType(AppNavigation);
  const header = navigation.findByProps({ className: 'app-header product-header' });
  const title = header.findByProps({ className: 'analysis-title' }).findByType('input');
  assert.equal(ui.root.findAllByProps({ className: 'author-topbar app-header' }).length, 0);
  const canvas = ui.root.findByType(AuthorCanvas);
  await act(() => title.props.onChange({ target: { value: 'Integrated title' } }));
  assert.equal(ui.root.findByType(AuthorCanvas), canvas, 'Title editing must not remount the workspace');
  assert.equal(canvas.props.draft.title, 'Integrated title');
  await act(() => ui.root.findAllByType('button').find(b => b.props.children === 'Save draft').props.onClick());
  assert.equal(ui.root.findByType(AuthorCanvas), canvas, 'Saving the new URL must retain the editor');
  await ui.reload();
  assert.equal(ui.root.findByProps({ className: 'analysis-title' }).findByType('input').props.value, 'Integrated title');
});
