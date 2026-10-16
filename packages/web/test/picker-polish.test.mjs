import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement as h } from 'react';
import { create } from 'react-test-renderer';
import { LocalDrafts } from '../build/test/LocalDrafts.js';
import { CreateAnalysisDialog } from '../build/test/CreateAnalysisDialog.js';

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
