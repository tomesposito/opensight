import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { act, createElement as h } from 'react';
import { create } from 'react-test-renderer';
import { renderToStaticMarkup } from 'react-dom/server';
import { LocalDrafts } from '../build/test/LocalDrafts.js';
import { CreateAnalysisDialog, DatasetPickerSkeleton } from '../build/test/CreateAnalysisDialog.js';
import { chromiumPage } from './chromium.mjs';

const css = await readFile(new URL('../src/style.css', import.meta.url), 'utf8');

async function mount(t, Component, props) {
  const previous = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let renderer;
  await act(() => { renderer = create(h(Component, props)); });
  t.after(async () => { await act(() => renderer.unmount()); globalThis.IS_REACT_ACT_ENVIRONMENT = previous; });
  return { get root() { return renderer.root; } };
}

test('favorites filter label carries the inline class (issue #108 polish)', async t => {
  const props = { entries: [], onOpen() {}, onRename() {}, onDelete() {}, onRefresh() {} };
  const ui = await mount(t, LocalDrafts, { ...props, expanded: true });
  const label = ui.root.findByProps({ className: 'favorites-filter' });
  assert.equal(label.type, 'label');
  assert.equal(label.findByType('input').props.type, 'checkbox');
});

test('dataset picker: clicking a row selects it and enables Select (issue #108 polish)', async t => {
  const calls = [];
  const ui = await mount(t, CreateAnalysisDialog, {
    sampleAvailable: true, onSelect: dataset => calls.push(dataset), onClose() {},
  });
  const row = ui.root.findByType('tbody').findByType('tr');
  assert.ok(row.props['data-selectable'], 'sample row is marked selectable');
  const selectBefore = ui.root.findAllByType('button').find(b => b.props.children === 'Select');
  assert.equal(selectBefore.props.disabled, true);
  await act(() => row.props.onClick());
  const selectedRow = ui.root.findByType('tbody').findByType('tr');
  const selectAfter = ui.root.findAllByType('button').find(b => b.props.children === 'Select');
  assert.equal(selectAfter.props.disabled, false);
  assert.equal(selectedRow.props['data-selected'], true);
  await act(() => ui.root.findByType('form').props.onSubmit({ preventDefault() {} }));
  assert.equal(calls.length, 1);
});

test('dataset picker: unavailable rows are not row-click selectable (issue #108 polish)', async t => {
  const client = { listPrepSources: async () => [{ id: 's1', name: 'Broken source', ref: { dataset: 'd1' }, connectorId: 'postgresql', available: false, errorCode: 'CONNECTOR_DOWN' }] };
  const ui = await mount(t, CreateAnalysisDialog, { client, onSelect() {}, onClose() {} });
  await act(async () => {});
  const row = ui.root.findByType('tbody').findByType('tr');
  assert.equal(row.props['data-selectable'], undefined);
  assert.equal(row.props.onClick, undefined);
  const radio = row.findByType('input');
  assert.equal(radio.props.disabled, true);
});


describe('issue #108 polish: dataset picker loading skeleton', () => {
  let page;
  before(async () => { page = await chromiumPage(); });
  after(async () => { await page?.close(); });

  test('loading renders a height-reserving skeleton, not a bare paragraph', async t => {
    const pending = { listPrepSources: () => new Promise(() => {}) };
    const ui = await mount(t, CreateAnalysisDialog, { client: pending, onSelect() {}, onClose() {} });
    const skeleton = ui.root.findByProps({ className: 'dataset-picker-skeleton' });
    assert.equal(skeleton.props.role, 'status');
    assert.equal(skeleton.props['aria-label'], 'Loading datasets');
    const shapes = skeleton.findAll(node => node.props && typeof node.props.className === 'string' && node.props.className.includes('skeleton-shape'));
    assert.equal(shapes.length, 8, 'skeleton renders eight shimmer rows');
    const statuses = ui.root.findAllByProps({ role: 'status' }).filter(node => typeof node.props.children === 'string');
    assert.ok(!statuses.some(node => /Loading datasets…/.test(node.props.children)), 'the bare loading paragraph is gone');
  });

  test('skeleton css reserves dialog content height', () => {
    assert.match(css, /\.dataset-picker-skeleton\s*\{[^}]*min-height:\s*296px/);
    assert.match(css, /\.dataset-picker-skeleton\s+\.skeleton-rows\s*\{[^}]*min-height:\s*272px/);
  });

  test('skeleton height matches the loaded table (no layout shift)', async () => {
    const header = h('thead', {}, h('tr', {}, ['Select dataset', 'Dataset name', 'Type', 'Source', 'Owner', 'Last modified'].map((label, i) => h('th', { scope: 'col', key: i }, label))));
    const rows = Array.from({ length: 8 }, (_, i) => h('tr', { key: i },
      h('td', {}, h('input', { type: 'radio', disabled: true })), h('td', {}, `Dataset ${i + 1}`), h('td', {}, 'Direct query'), h('td', {}, 'File'), h('td', {}, 'Not available'), h('td', {}, 'Not available')));
    const region = body => renderToStaticMarkup(h('div', { className: 'dataset-picker-table', role: 'region', 'aria-label': 'Available datasets' },
      h('table', {}, header, body)));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.setContent(`<style>${css}</style>${region(h('tbody', {}))}${renderToStaticMarkup(h(DatasetPickerSkeleton, {}))}`);
    const skeletonHeight = await page.evaluate(() => document.querySelector('.dataset-picker-skeleton').getBoundingClientRect().height);
    await page.setContent(`<style>${css}</style>${region(h('tbody', {}, rows))}`);
    const tableHeight = await page.evaluate(() => document.querySelector('.dataset-picker-table table').getBoundingClientRect().height);
    assert.ok(skeletonHeight >= 280, `skeleton reserves content height, got ${skeletonHeight}`);
    assert.ok(Math.abs(skeletonHeight - tableHeight) < 60,
      `skeleton (${skeletonHeight}px) matches loaded table (${tableHeight}px): no layout shift on load`);
  });
});
