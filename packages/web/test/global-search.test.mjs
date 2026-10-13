import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement, StrictMode } from 'react';
import { create } from 'react-test-renderer';
import { relativeTime, searchAssets } from '../build/test/GlobalSearch.js';
import { createDraftStore } from '../build/test/local-drafts.js';
import { emptyDraft, authorReducer } from '../build/test/authoring.js';
import { Application } from '../build/test/Application.js';
import { AccessProvider, demoAccess } from '../build/test/access.js';

const NOW = Date.UTC(2026, 9, 13, 12, 0, 0);
const iso = minutesAgo => new Date(NOW - minutesAgo * 60_000).toISOString();

test('relativeTime labels minutes, hours, days, months and years like the reference', () => {
  assert.equal(relativeTime(new Date(NOW - 30_000).toISOString(), NOW), 'just now');
  assert.equal(relativeTime(iso(1), NOW), '1 minute ago');
  assert.equal(relativeTime(iso(59), NOW), '59 minutes ago');
  assert.equal(relativeTime(iso(60), NOW), '1 hour ago');
  assert.equal(relativeTime(iso(60 * 25), NOW), '1 day ago');
  assert.equal(relativeTime(iso(60 * 24 * 32), NOW), '1 month ago');
  assert.equal(relativeTime(iso(60 * 24 * 150), NOW), '5 months ago');
  assert.equal(relativeTime(iso(60 * 24 * 400), NOW), '1 year ago');
  assert.equal(relativeTime('not-a-date', NOW), 'date unknown');
  assert.equal(relativeTime(iso(-5), NOW), 'just now');
});

test('searchAssets filters by name and chip, newest first', () => {
  const assets = [
    { id: 'a', name: 'Revenue Q3', kind: 'analysis', updatedAt: iso(10) },
    { id: 'b', name: 'Costs', kind: 'analysis', updatedAt: iso(5000), favorite: true },
    { id: 'c', name: 'Revenue Q4', kind: 'analysis', updatedAt: iso(5) },
  ];
  assert.deepEqual(searchAssets(assets, '', 'all').map(a => a.id), ['c', 'a', 'b']);
  assert.deepEqual(searchAssets(assets, 'revenue', 'all').map(a => a.id), ['c', 'a']);
  assert.deepEqual(searchAssets(assets, '  REV ', 'all').map(a => a.id), ['c', 'a']);
  assert.deepEqual(searchAssets(assets, 'zzz', 'all'), []);
  assert.deepEqual(searchAssets(assets, '', 'favorites').map(a => a.id), ['b']);
  assert.deepEqual(searchAssets(assets, 'revenue', 'favorites'), []);
});

// Mounts the full application with a stubbed browser; seeds local drafts into the stubbed storage.
async function mountSearch(t, { drafts = [], corrupt = false } = {}) {
  const old = { window: globalThis.window, document: globalThis.document, act: globalThis.IS_REACT_ACT_ENVIRONMENT };
  const values = new Map(), dialogs = new Map();
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const seed = createDraftStore(() => storage, demoAccess);
  const ids = {};
  for (const [name, minutes, favorite] of drafts) {
    const id = seed.save({ ...authorReducer(emptyDraft(), { type: 'add', kind: 'bar' }), title: name });
    ids[name] = id;
    if (favorite) seed.favorite(seed.open(id), id, true);
  }
  // Backdate updatedAt through the stored JSON so recents order is deterministic.
  const key = [...values.keys()].find(k => k.includes('drafts'));
  if (corrupt) values.set('opensight.author.drafts.v1.demo', 'not-json');
  else if (key && drafts.length) {
    const minutesByName = Object.fromEntries(drafts.map(([name, minutes]) => [name, minutes]));
    const collection = JSON.parse(values.get(key));
    collection.entries.forEach(entry => { entry.updatedAt = iso(minutesByName[entry.draft.title] ?? 0); });
    values.set(key, JSON.stringify(collection));
  }
  const document = new EventTarget();
  document.defaultView = new EventTarget();
  const node = () => ({ nodeType: 1, isConnected: true, closest: () => null, focus() { document.activeElement = this; } });
  const trigger = node(), search = node(), close = node();
  document.activeElement = trigger;
  document.getElementById = () => ({ scrollIntoView() {} });
  document.querySelector = () => null;
  const location = new URL('https://opensight.example/demo.html#/my-stuff');
  globalThis.document = document;
  globalThis.window = { location, localStorage: storage,
    history: { replaceState(_s, _t, hash) { location.hash = hash; }, pushState(_s, _t, hash) { location.hash = hash; } },
    addEventListener() {}, removeEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  };
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let renderer;
  await act(() => { renderer = create(createElement(StrictMode, null,
    createElement(AccessProvider, { access: demoAccess }, createElement(Application, { api: {}, fixtures: [] }))), {
    createNodeMock(element) {
      if (element.props.role === 'combobox') return search;
      if (element.props['aria-label'] === 'Close search') return close;
      if (element.type === 'dialog') {
        const dialog = { ownerDocument: document, open: false, showModal() { this.open = true; }, close() { this.open = false; }, querySelector: () => null };
        dialogs.set(element.props.className, dialog); return dialog;
      }
      return null;
    },
  }); });
  t.after(async () => { await act(() => renderer.unmount()); globalThis.window = old.window; globalThis.document = old.document; globalThis.IS_REACT_ACT_ENVIRONMENT = old.act; });
  const dialog = () => renderer.root.findAllByType('dialog')[0];
  const input = () => renderer.root.findByProps({ role: 'combobox' });
  const options = () => renderer.root.findAllByProps({ role: 'option' });
  const click = label => act(() => {
    const button = renderer.root.findAllByType('button').find(b => b.props.children === label || b.props['aria-label'] === label);
    assert.ok(button, label); button.props.onClick();
  });
  return {
    renderer, ids, dialog, input, options, click,
    open: () => click('Search'),
    filter: value => act(() => input().props.onChange({ target: { value } })),
    press: (key, flags = {}) => act(() => input().props.onKeyDown({ key, nativeEvent: {}, preventDefault() {}, ...flags })),
    names: () => options().map(o => o.findByProps({ className: 'search-name' }).props.children[0]),
    times: () => options().map(o => o.findByType('time').props.children),
  };
}

test('rail Search opens the find-anything modal with recents, newest first', async t => {
  const ui = await mountSearch(t, { drafts: [['Revenue', 60 * 24 * 32], ['Costs', 5]] });
  await ui.open();
  const dialog = ui.dialog();
  assert.equal(dialog.props.className, 'global-search');
  assert.equal(ui.input().props.placeholder, 'Find anything');
  assert.equal(dialog.findByProps({ id: dialog.props['aria-labelledby'] }).props.children, 'Search');
  assert.deepEqual(ui.names(), ['Costs', 'Revenue']);
  assert.ok(ui.times()[0] !== 'date unknown');
});

test('typing filters by name; the favorites chip narrows to favorites', async t => {
  const ui = await mountSearch(t, { drafts: [['Revenue', 60], ['Costs', 5, true], ['Headcount', 10]] });
  await ui.open();
  await ui.filter('rev');
  assert.deepEqual(ui.names(), ['Revenue']);
  await ui.filter('');
  assert.equal(ui.names().length, 3);
  await ui.click('☆ Favorites');
  assert.deepEqual(ui.names(), ['Costs']);
  await ui.click('☆ Favorites');
  assert.equal(ui.names().length, 3);
});

test('keyboard moves and Enter opens the draft in the author', async t => {
  const ui = await mountSearch(t, { drafts: [['Revenue', 60], ['Costs', 5]] });
  await ui.open();
  await ui.press('ArrowDown');
  const selected = ui.options().find(o => o.props['aria-selected']);
  assert.equal(selected.findByProps({ className: 'search-name' }).props.children[0], 'Revenue');
  await ui.press('Enter');
  assert.equal(globalThis.window.location.hash, `#/analyses/drafts/${ui.ids['Revenue']}`);
  assert.equal(ui.renderer.root.findAllByType('dialog').length, 0);
});

test('empty state guides to the first analysis when no drafts exist', async t => {
  const ui = await mountSearch(t);
  await ui.open();
  const texts = ui.dialog().findAllByType('p').map(p => p.props.children);
  assert.ok(texts.includes('No analyses yet.'));
  assert.ok(texts.includes('Create your first analysis and find it here.'));
});

test('unreadable storage shows the honest storage error instead of results', async t => {
  const ui = await mountSearch(t, { corrupt: true });
  await ui.open();
  const alert = ui.dialog().findByProps({ role: 'alert' });
  assert.match(String(alert.props.children), /could not be read/i);
});
