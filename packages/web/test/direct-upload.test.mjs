import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { create } from 'react-test-renderer';
import { DirectUpload } from '../build/test/DirectUpload.js';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
async function fixture(t) {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1800000000000 });
  const previous = globalThis.document, document = new EventTarget(); document.visibilityState = 'visible'; globalThis.document = document;
  const calls = [], uploaded = [], op = { id: 'synthetic-operation', kind: 'ingest', state: 'queued', revision: 1, resultAvailable: false, expiresAt: new Date(Date.now() + 3600000).toISOString() };
  const client = {
    uploadDirectFile: async (_file, _config, expiry, progress) => { calls.push(['upload', expiry]); progress({ stage: 'accepted', operation: op }); return op; },
    getOperation: async id => { calls.push(['status', id]); return op; },
    getUploadReservation: async () => assert.fail('unexpected reservation read'),
    cancelOperation: async (id, revision) => { calls.push(['cancel', id, revision]); return { ...op, state: 'cancelled', revision: revision + 1 }; },
    cancelUploadReservation: async () => assert.fail('unexpected reservation cancellation'),
  };
  let renderer, unmounted = false;
  await act(() => { renderer = create(createElement(DirectUpload, { client, file: new File(['a\n1\n'], 'sample.csv'), config: { format: 'csv' }, onUploaded: id => uploaded.push(id) })); });
  const unmount = async () => { if (!unmounted) { unmounted = true; await act(() => renderer.unmount()); } };
  t.after(async () => { await unmount(); globalThis.document = previous; });
  const button = name => renderer.root.findAllByType('button').find(n => n.children[0] === name);
  const click = async name => act(async () => button(name).props.onClick());
  const expiry = async () => act(() => renderer.root.findByProps({ type: 'datetime-local' }).props.onChange({ target: { value: '2030-01-01T12:00' } }));
  const tick = async ms => act(async () => t.mock.timers.tick(ms));
  return { calls, uploaded, op, client, document, renderer, button, click, expiry, tick, unmount };
}
test('SR2d upload needs explicit expiry, bounds polling and restarts it only on Check status', async t => {
  const f = await fixture(t);
  assert.equal(f.button('Upload file').props.disabled, true); await f.tick(300000); assert.deepEqual(f.calls, []);
  await f.expiry(); await f.click('Upload file'); assert.equal(f.calls.length, 1);
  await f.tick(2000); assert.equal(f.calls.filter(c => c[0] === 'status').length, 1);
  await f.tick(120000); const stopped = f.calls.length; await f.tick(3600000); assert.equal(f.calls.length, stopped);
  assert.match(JSON.stringify(f.renderer.toJSON()), /status checks are paused/);
  await f.click('Check status'); assert.equal(f.calls.length, stopped + 1); await f.tick(2000); assert.equal(f.calls.length, stopped + 2);
});
test('SR2d hidden page and unmount stop checks without cancelling accepted ingestion or accepting a late status', async t => {
  const f = await fixture(t); await f.expiry(); await f.click('Upload file');
  let resolve; f.client.getOperation = () => new Promise(done => { resolve = done; });
  await f.tick(2000);
  await act(() => { f.document.visibilityState = 'hidden'; f.document.dispatchEvent(new Event('visibilitychange')); });
  await act(() => resolve({ ...f.op, state: 'completed', sourceId: 'late-source' })); assert.deepEqual(f.uploaded, []);
  await act(() => { f.document.visibilityState = 'visible'; f.document.dispatchEvent(new Event('visibilitychange')); });
  await f.tick(3600000); assert.deepEqual(f.calls.map(c => c[0]), ['upload']);
  await f.unmount(); await f.tick(3600000); assert.ok(!f.calls.some(c => c[0] === 'cancel'));
});
test('SR2d explicit cancellation uses the latest revision; terminal completion ends polling and notifies once', async t => {
  const f = await fixture(t); await f.expiry(); await f.click('Upload file');
  f.op.revision = 4; await f.tick(2000); await f.click('Cancel upload');
  assert.deepEqual(f.calls.at(-1), ['cancel', f.op.id, 4]); const cancelled = f.calls.length;
  await f.tick(3600000); assert.equal(f.calls.length, cancelled);
  f.op.state = 'completed'; f.op.sourceId = 'durable-source'; await f.click('Upload another file');
  assert.deepEqual(f.uploaded, ['durable-source']); const complete = f.calls.length;
  await f.tick(3600000); assert.equal(f.calls.length, complete); assert.match(JSON.stringify(f.renderer.toJSON()), /Survives API restarts/);
});
