import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { create } from 'react-test-renderer';
import { ToastProvider } from '../build/test/Toasts.js';
import { ConnectorDetails } from '../build/test/DataSources.js';
import { DatasetRefresh } from '../build/test/DatasetRefresh.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mount = async (t, element) => {
  let renderer;
  await act(() => { renderer = create(createElement(ToastProvider, {}, element)); });
  t.after(async () => { await act(() => renderer.unmount()); });
  return renderer;
};
const messages = renderer => renderer.root.findByProps({ className: 'toast-host' }).findAllByType('span').map(n => n.props.children);
const button = (renderer, label) => renderer.root.findAllByType('button').find(n => n.children[0] === label);

const uploadClient = (rowCount = 32133) => ({
  uploadFile: async () => ({ id: 'up-1', rowCount, columns: [{ name: 'a', type: 'string' }, { name: 'b', type: 'number' }] }),
});

test('upload staging fires a one-time completion toast with exact row and column counts', async t => {
  const renderer = await mount(t, createElement(ConnectorDetails, { id: 'file', client: uploadClient(), local: true, onPrep: () => {} }));
  assert.deepEqual(messages(renderer), []);
  await act(() => { renderer.root.findByProps({ type: 'file' }).props.onChange({ target: { files: [new File(['a\n1\n'], 'sample.csv')] } }); });
  await act(async () => { renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }); });
  assert.deepEqual(messages(renderer), ['Upload staged: 32,133 rows · 2 columns']);
  // A second staged upload with the same id does not fire again.
  await act(async () => { renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }); });
  assert.deepEqual(messages(renderer), ['Upload staged: 32,133 rows · 2 columns']);
});

test('failed upload staging never fires the completion toast', async t => {
  const renderer = await mount(t, createElement(ConnectorDetails, { id: 'file', client: { uploadFile: async () => { throw new Error('boom'); } }, local: true, onPrep: () => {} }));
  await act(() => { renderer.root.findByProps({ type: 'file' }).props.onChange({ target: { files: [new File(['a\n1\n'], 'sample.csv')] } }); });
  await act(async () => { renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }); });
  assert.deepEqual(messages(renderer), []);
  assert.match(JSON.stringify(renderer.toJSON()), /boom/);
});

const refreshStatus = (overrides = {}) => ({ mode: 'BLAZE', state: 'ready', rowCount: 100, lastRefreshedAt: '2026-10-12T00:00:00Z', version: 1, ...overrides });
const refreshClient = (after) => ({
  onDemand: true,
  getDatasetExecution: async () => refreshStatus(),
  setDatasetExecution: async () => refreshStatus(),
  refreshBlaze: async () => refreshStatus({ rowCount: 250, lastRefreshedAt: '2026-10-12T20:00:00Z', version: 2, ...after }),
});

test('user-initiated refresh completion fires a one-time toast with the row count', async t => {
  const renderer = await mount(t, createElement(DatasetRefresh, { datasetId: 'ds-1', client: refreshClient() }));
  assert.deepEqual(messages(renderer), []);
  await act(async () => { button(renderer, 'Refresh now').props.onClick(); });
  assert.deepEqual(messages(renderer), ['Refresh complete · 250 dataset rows']);
  // Re-checking status (poll path) does not re-fire the toast.
  await act(async () => { button(renderer, 'Check status').props.onClick(); });
  assert.deepEqual(messages(renderer), ['Refresh complete · 250 dataset rows']);
});

test('refresh completion without a row count fires the bare message; missing timestamp fires nothing', async t => {
  const renderer = await mount(t, createElement(DatasetRefresh, { datasetId: 'ds-1', client: refreshClient({ rowCount: null }) }));
  await act(async () => { button(renderer, 'Refresh now').props.onClick(); });
  assert.deepEqual(messages(renderer), ['Refresh complete']);

  const noStamp = await mount(t, createElement(DatasetRefresh, { datasetId: 'ds-2', client: refreshClient({ lastRefreshedAt: null }) }));
  await act(async () => { button(noStamp, 'Refresh now').props.onClick(); });
  assert.deepEqual(messages(noStamp), []);
});

test('failed refresh never fires the completion toast', async t => {
  const renderer = await mount(t, createElement(DatasetRefresh, { datasetId: 'ds-1', client: { ...refreshClient(), refreshBlaze: async () => { throw new Error('refresh failed'); } } }));
  await act(async () => { button(renderer, 'Refresh now').props.onClick(); });
  assert.deepEqual(messages(renderer), []);
  assert.match(JSON.stringify(renderer.toJSON()), /refresh failed/);
});
