import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { act, createElement } from 'react';
import { create } from 'react-test-renderer';
import { renderToStaticMarkup } from 'react-dom/server';
import { AccessProvider, demoAccess } from '../build/test/access.js';
import { DataCatalogSkeleton, DataLanding } from '../build/test/DataLanding.js';
import { chromiumPage } from './chromium.mjs';
import { datasetBadges, filterDatasets } from '../build/test/data-section.js';
import { parseRoute, productSections, routeHash, routeProblem } from '../build/test/app-navigation.js';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const css = (await Promise.all(['style.css', 'data-section.css'].map(name => readFile(new URL(`../src/${name}`, import.meta.url), 'utf8')))).join('\n');
const dataset = { resourceType: 'dataset', dataSetId: 'orders', name: 'Orders', physicalTableMap: {}, importMode: 'DIRECT_QUERY', opensightPrep: { version: 1, input: 'upload-1', steps: [] } };
const source = { id: 'orders', ref: { dataset: 'orders' }, name: 'Orders', connectorId: 'file', available: true, columns: [{ name: 'amount', type: 'DECIMAL' }], execution: { mode: 'BLAZE' } };
const catalog = { datasets: [dataset], sources: [source] };
const client = { listPrepDatasets: async () => ({ datasets: catalog.datasets }), listPrepSources: async () => catalog.sources };
const text = node => JSON.stringify(node.toJSON());
async function mount(t, props = {}, access = demoAccess) {
  let ui;
  const element = next => createElement(AccessProvider, { access }, createElement(DataLanding, { onCreate() {}, onCreateSource() {}, onOpen() {}, onEdit() {}, onPrep() {}, ...next }));
  await act(() => { ui = create(element(props)); });
  t.after(() => act(() => ui.unmount()));
  return { get root() { return ui.root; }, text: () => text(ui), update: props => act(() => ui.update(element(props))) };
}
const button = (ui, label) => ui.root.findAllByType('button').find(node => node.children.join('') === label);
const change = (node, value) => act(() => node.props.onChange({ target: { value } }));
test('Data rail lands on /data while prep remains a separate gated entry', () => {
  assert.equal(productSections.find(section => section.title === 'Data').page, 'data');
  assert.deepEqual(parseRoute('#/data'), { page: 'data' });
  assert.equal(routeHash({ page: 'data-prep' }), '#/data/preparation');
  for (const page of ['data', 'data-prep', 'data-sources']) assert.match(routeProblem({ mode: 'hosted', session: { role: 'reader' } }, page), /SECURITY_BUILD_REQUIRED/);
});
test('empty landing has creation, all tabs, and no staged dataset rows', async t => {
  let created = 0;
  const ui = await mount(t, { onCreate: () => created++ });
  assert.match(ui.text(), /No datasets yet/); assert.doesNotMatch(ui.text(), /Orders|demo-sales/);
  assert.deepEqual(ui.root.findAllByProps({ role: 'tab' }).map(node => node.children[0]), ['Datasets', 'Topics', 'Data sources', 'Metrics']);
  await act(() => button(ui, 'Create dataset').props.onClick()); assert.equal(created, 1);
  await act(() => button(ui, 'Topics').props.onClick()); assert.match(ui.text(), /No topics available/);
  await act(() => button(ui, 'Data sources').props.onClick()); assert.match(ui.text(), /No data sources yet/);
  await act(() => button(ui, 'Datasets').props.onKeyDown({ key: 'ArrowRight', preventDefault() {}, currentTarget: {} }));
  assert.equal(button(ui, 'Topics').props['aria-selected'], true);
});
test('landing searches and filters real datasets, shows badges and opens exact row/menu targets', async t => {
  const opened = [], edited = [];
  const ui = await mount(t, { client, onOpen: row => opened.push(row.dataSetId), onEdit: row => edited.push(row.dataSetId) }, { mode: 'local' });
  assert.match(ui.text(), /BLAZE · Cached/); assert.match(ui.text(), /Local workspace/);
  await act(() => button(ui, 'Orders').props.onClick()); await act(() => button(ui, 'Edit dataset').props.onClick());
  assert.deepEqual(opened, ['orders']); assert.deepEqual(edited, ['orders']);
  assert.equal(ui.root.findByProps({ 'aria-label': 'Actions for Orders' }).type, 'summary');
  await change(ui.root.findByProps({ type: 'search' }), 'wrong'); assert.match(ui.text(), /No datasets match/);
  await change(ui.root.findByProps({ type: 'search' }), 'ORD'); assert.ok(button(ui, 'Orders'));
  await change(ui.root.findByProps({ 'aria-label': 'Filter datasets' }), 'direct'); assert.match(ui.text(), /No datasets match/);
  await change(ui.root.findByProps({ 'aria-label': 'Filter datasets' }), 'cached'); assert.ok(button(ui, 'Orders'));
});
test('badges and owner/type filters reflect metadata without inventing cache or security', () => {
  const protectedData = { ...dataset, rowLevelPermissionDataSet: { status: 'ENABLED' }, useAs: 'RLS_RULES' };
  assert.deepEqual(datasetBadges(dataset), []);
  assert.deepEqual(datasetBadges(protectedData, source), ['BLAZE · Cached', 'RLS enabled', 'Rules dataset']);
  assert.deepEqual(datasetBadges({ ...protectedData, rowLevelPermissionDataSet: { status: 'DISABLED' } }), ['Rules dataset']);
  for (const filter of ['rls', 'rules']) assert.equal(filterDatasets({ ...catalog, datasets: [protectedData] }, '', filter, false).length, 1);
  assert.equal(filterDatasets(catalog, '', 'mine', false).length, 0);
  assert.equal(filterDatasets(catalog, '', 'mine', true).length, 1);
});
test('failed or late catalog requests cannot reveal stale datasets and reload retries', async t => {
  let finish;
  const slow = { ...client, listPrepDatasets: () => new Promise(resolve => { finish = resolve; }) };
  const ui = await mount(t, { client: slow }); assert.match(ui.text(), /Loading data/);
  const failed = { ...client, listPrepDatasets: async () => { throw new Error('DATASET_DENIED'); } };
  await ui.update({ client: failed }); await act(() => finish({ datasets: [dataset] }));
  assert.match(ui.text(), /DATASET_DENIED/); assert.equal(button(ui, 'Orders'), undefined);
  await ui.update({ client }); assert.ok(button(ui, 'Orders'));
  await ui.update({}); assert.equal(button(ui, 'Orders'), undefined);
});
test('sources tab lists only real raw sources and refuses unavailable sources', async t => {
  const raw = { id: 'upload-1', connectorId: 'file', available: false, columns: [] };
  const ui = await mount(t, { client: { ...client, listPrepSources: async () => [source, raw] }, initialTab: 'Data sources' });
  assert.match(ui.text(), /SOURCE_UNAVAILABLE/);
  const rows = ui.root.findByType('tbody').findAllByType('tr'); assert.equal(rows.length, 1);
  assert.equal(rows[0].findByType('button').props.disabled, true);
});

test('landing icons are font-independent vector graphics', async t => {
  const ui = await mount(t, {});
  assert.doesNotMatch(ui.text(), /[◈⌄▤☰›]/);
  const disclosure = ui.root.findByProps({ 'aria-label': 'More create options' });
  assert.ok(disclosure.findAllByType('svg').length >= 1, 'create-options disclosure must render an SVG chevron');
  assert.ok(ui.root.findAllByType('svg').length >= 2, 'empty state and disclosure must both render SVG icons');
});


describe('issue #108 polish: data landing loading skeleton', () => {
  let page;
  before(async () => { page = await chromiumPage(); });
  after(async () => { await page?.close(); });

  test('loading renders a height-reserving skeleton, not a bare paragraph', async t => {
    const pending = { ...client, listPrepDatasets: () => new Promise(() => {}) };
    const ui = await mount(t, { client: pending });
    const skeleton = ui.root.findByProps({ className: 'data-skeleton' });
    assert.equal(skeleton.props.role, 'status');
    assert.equal(skeleton.props['aria-label'], 'Loading datasets');
    const shapes = skeleton.findAll(node => node.props && typeof node.props.className === 'string' && node.props.className.includes('skeleton-shape'));
    assert.equal(shapes.length, 11, 'skeleton renders one head row and ten shimmer rows');
    assert.doesNotMatch(ui.text(), /Loading data…/, 'the bare loading paragraph is gone');
  });

  test('skeleton css reserves content height', () => {
    assert.match(css, /\.data-skeleton\s*\{[^}]*min-height:\s*320px/);
    assert.match(css, /\.data-skeleton\s+\.skeleton-rows\s*\{[^}]*min-height:\s*272px/);
  });

  test('skeleton height matches the loaded empty state (no layout shift)', async () => {
    const card = inner => renderToStaticMarkup(createElement('div', { className: 'data-page' },
      createElement('div', { className: 'data-card' },
        createElement('section', { role: 'tabpanel', 'aria-label': 'Datasets' }, inner))));
    // Deterministic empty-state markup mirroring DataLanding's loaded branch.
    const empty = createElement('div', { className: 'data-empty' },
      createElement('span', { 'aria-hidden': 'true' },
        createElement('svg', { width: 36, height: 36, viewBox: '0 0 24 24', focusable: 'false' },
          createElement('rect', { x: 4, y: 5, width: 16, height: 14, rx: 1, fill: 'none', stroke: 'currentColor', strokeWidth: 1.5 }),
          createElement('path', { d: 'M4 9.5h16M4 14h16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5 }))),
      createElement('h2', {}, 'No datasets yet'),
      createElement('p', {}, 'Create a dataset to prepare data for your analyses.'),
      createElement('button', {}, 'Create dataset'));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.setContent(`<style>${css}</style>${card(createElement(DataCatalogSkeleton, {}))}`);
    const skeletonHeight = await page.evaluate(() => document.querySelector('.data-skeleton').getBoundingClientRect().height);
    await page.setContent(`<style>${css}</style>${card(empty)}`);
    const emptyHeight = await page.evaluate(() => document.querySelector('.data-empty').getBoundingClientRect().height);
    assert.ok(skeletonHeight >= 300, `skeleton reserves content height, got ${skeletonHeight}`);
    assert.ok(Math.abs(skeletonHeight - emptyHeight) < 60,
      `skeleton (${skeletonHeight}px) matches loaded empty state (${emptyHeight}px): no layout shift on load`);
  });
});
