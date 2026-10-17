import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { act, createElement as h } from 'react';
import { create } from 'react-test-renderer';
import { LocalDrafts } from '../build/test/LocalDrafts.js';
import { CollectionPage } from '../build/test/CollectionPage.js';
import { chromiumPage } from './chromium.mjs';

const css = await readFile(new URL('../src/style.css', import.meta.url), 'utf8');

async function mount(t, Component, props, options) {
  const previous = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let renderer; await act(() => { renderer = create(h(Component, props), options); });
  t.after(async () => { await act(() => renderer.unmount()); globalThis.IS_REACT_ACT_ENVIRONMENT = previous; });
  return { get root() { return renderer.root; }, async update(props) { await act(() => renderer.update(h(Component, props))); } };
}
const entries = Array.from({ length: 26 }, (_, i) => ({ id: `draft-${i}`, name: `Analysis ${String(i).padStart(2, '0')}`, updatedAt: '2026-01-01T12:00:00.000Z', sample: true }));
test('collection banner dismissal keeps focus on the page heading and retains content', async t => {
  let focused = false;
  const ui = await mount(t, CollectionPage, { title: 'My analyses', introduction: 'Explore data', description: 'Device-local drafts', children: h('p', {}, 'Collection') }, { createNodeMock: node => node.type === 'h1' ? { focus() { focused = true; } } : null });
  await act(() => ui.root.findByType('button').props.onClick());
  assert.equal(ui.root.findAllByType('aside').length, 0);
  assert.equal(focused, true); assert.equal(ui.root.findByType('p').props.children, 'Collection');
});
test('analysis table searches, paginates, clamps after deletion and dispatches exact row actions', async t => {
  const calls = [];
  const props = { entries, expanded: true, onOpen: id => calls.push(['open', id]), onRename: (id, name) => calls.push(['rename', id, name]), onDelete: id => calls.push(['delete', id]), onRefresh: () => calls.push(['refresh']) };
  const ui = await mount(t, LocalDrafts, props);
  const rows = () => ui.root.findByType('tbody').findAllByType('tr');
  const button = label => ui.root.findAllByType('button').find(b => b.props.children === label || b.props['aria-label'] === label);
  assert.equal(rows().length, 25);
  assert.equal(button('Previous page').props.disabled, true);
  await act(() => button('Next page').props.onClick());
  assert.equal(rows().length, 1);
  await act(() => button('Open').props.onClick());
  await act(() => button('Open Analysis 25').props.onClick());
  await act(() => button('Rename').props.onClick());
  await act(() => ui.root.findByProps({ autoFocus: true }).props.onChange({ target: { value: 'Renamed' } }));
  await act(() => ui.root.findByType('form').props.onSubmit({ preventDefault() {} }));
  await act(() => button('Delete').props.onClick());
  assert.deepEqual(calls, [['open', 'draft-25'], ['open', 'draft-25'], ['rename', 'draft-25', 'Renamed'], ['delete', 'draft-25']]);
  await ui.update({ ...props, entries: entries.slice(0, 25) });
  assert.equal(rows().length, 25); assert.equal(button('Next page').props.disabled, true);
  await act(() => ui.root.findByProps({ type: 'search' }).props.onChange({ target: { value: '  ANALYSIS 04  ' } }));
  assert.equal(rows().length, 1); assert.equal(rows()[0].findByType('strong').props.children, 'Analysis 04');
  await act(() => ui.root.findByProps({ type: 'search' }).props.onChange({ target: { value: 'missing' } }));
  assert.equal(rows().length, 0); assert.ok(ui.root.findAllByProps({ role: 'status' }).some(n => n.props.children === 'No analyses match your search.'));
  await act(() => ui.root.findByProps({ type: 'search' }).props.onChange({ target: { value: '' } }));
  await ui.update(props);
  await act(() => ui.root.findByType('select').props.onChange({ target: { value: '50' } }));
  assert.equal(rows().length, 26);
  await act(() => button('Refresh drafts').props.onClick());
  assert.deepEqual(calls.at(-1), ['refresh']);
});
test('corrupt draft table rows cannot be opened or renamed, but can be deleted', async t => {
  const ui = await mount(t, LocalDrafts, { expanded: true, entries: [{ ...entries[0], problem: 'Corrupt draft' }], onOpen() { assert.fail('opened corrupt draft'); }, onRename() {}, onDelete() {}, onRefresh() {} });
  const row = ui.root.findByType('tbody');
  assert.equal(row.findByProps({ role: 'alert' }).props.children, 'Corrupt draft');
  const buttons = row.findAllByType('button');
  for (const label of ['Open Analysis 00', 'Open', 'Rename']) assert.equal(buttons.find(b => b.props['aria-label'] === label || b.props.children === label).props.disabled, true);
  assert.equal(Boolean(buttons.find(b => b.props.children === 'Delete').props.disabled), false);
});

test('Dashboards retains its empty collection and publishing explanation after banner dismissal', async t => {
  const { Dashboards } = await import('../build/test/Dashboards.js');
  const routes = [];
  const ui = await mount(t, Dashboards, { navigate: route => routes.push(route) });
  assert.equal(ui.root.findAllByType('table').length, 0, 'No placeholder dashboards are invented');
  await act(() => ui.root.findByType('button').props.onClick());
  assert.ok(ui.root.findAllByType('p').some(p => p.props.children === 'Publishing dashboards needs a hosted API.'));
  await act(() => ui.root.findByType('a').props.onClick({ button: 0, preventDefault() {} }));
  assert.deepEqual(routes, [{ page: 'analyses' }]);
});

test('issue #108 slice 10: empty drafts collection is illustrated, not a bare paragraph', async t => {
  assert.match(css, /\.local-drafts\s+\.empty-page-state\s*\{[^}]*min-height:\s*0/);
  // Expanded collection with no entries at all: illustrated empty state, role=status, no bare paragraph.
  const empty = await mount(t, LocalDrafts, { expanded: true, entries: [], onOpen() {}, onRename() {}, onDelete() {}, onRefresh() {} });
  const status = empty.root.findByProps({ role: 'status' });
  assert.equal(status.props.className, 'drafts-empty');
  assert.equal(status.findByType('p').props.children, 'No saved analyses yet. Use Save draft to keep your work.');
  assert.ok(status.findByProps({ 'aria-hidden': 'true' }), 'shared empty-page illustration is rendered');
  assert.equal(empty.root.findAllByProps({ className: 'collection-no-results' }).length, 0, 'no bare paragraph');
  // Collapsed details variant (author sidebar) uses the same illustrated state.
  const details = await mount(t, LocalDrafts, { entries: [], onOpen() {}, onRename() {}, onDelete() {}, onRefresh() {} });
  assert.equal(details.root.findByProps({ className: 'drafts-empty' }).findByType('p').props.children, 'No saved analyses yet. Use Save draft to keep your work.');
});

test('issue #108 slice 10: search and favorites-filter no-matches keep their text status', async t => {
  const props = { expanded: true, entries, onOpen() {}, onRename() {}, onDelete() {}, onRefresh() {} };
  const ui = await mount(t, LocalDrafts, props);
  await act(() => ui.root.findByProps({ type: 'search' }).props.onChange({ target: { value: 'missing' } }));
  const statuses = ui.root.findAllByProps({ role: 'status' });
  assert.ok(statuses.some(n => n.props.children === 'No analyses match your search.'), 'text status for search no-match');
  assert.equal(ui.root.findAllByProps({ className: 'drafts-empty' }).length, 0, 'illustration only for a truly empty collection');
  await act(() => ui.root.findByProps({ type: 'search' }).props.onChange({ target: { value: '' } }));
  await act(() => ui.root.findByProps({ type: 'checkbox' }).props.onChange({ target: { checked: true } }));
  assert.ok(ui.root.findAllByProps({ role: 'status' }).some(n => n.props.children === 'No favorite analyses match.'), 'text status for favorites no-match');
  assert.equal(ui.root.findAllByProps({ className: 'drafts-empty' }).length, 0);
});

test('issue #108 slice 10: illustrated drafts empty state is height-compact in Chromium', async t => {
  const { renderToStaticMarkup } = await import('react-dom/server');
  const page = await chromiumPage(); t.after(async () => page.close());
  await page.setViewportSize({ width: 1440, height: 900 });
  const html = renderToStaticMarkup(h('div', { className: 'app-shell' },
    h('main', { style: { width: '900px' } }, h(LocalDrafts, { expanded: true, entries: [], onOpen() {}, onRename() {}, onDelete() {}, onRefresh() {} }))));
  await page.setContent(`<style>${css}</style>${html}`);
  const actual = await page.evaluate(() => {
    const empty = document.querySelector('.drafts-empty');
    return { height: empty.getBoundingClientRect().height, minHeight: getComputedStyle(empty.querySelector('.empty-page-state')).minHeight };
  });
  assert.equal(actual.minHeight, '0px', 'compacted empty state reserves no 360px page minimum');
  assert.ok(actual.height < 260, `illustrated empty state is compact (got ${actual.height}px)`);
});
