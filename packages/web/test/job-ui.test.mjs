import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { create } from 'react-test-renderer';
import { RemovalPrompt, OperatorUsers } from '../build/test/OperatorUsers.js';
import { JobManagement } from '../build/test/JobManagement.js';
import { AccessProvider } from '../build/test/access.js';

test('H7 deletion prompt requires an explicit choice and transfer target, and sends the reviewed fingerprint', async t => {
  const prior = globalThis.IS_REACT_ACT_ENVIRONMENT; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const preview = { userId: 'owner', preview: 'a'.repeat(64), status: 'active', jobs: [{ id: 'weekly', kind: 'report', enabled: true }], candidates: [{ id: 'next', name: 'Next owner' }] };
  let renderer, sent; await act(() => { renderer = create(createElement(RemovalPrompt, { preview, busy: false, onCancel() {}, onRemove(value) { sent = value; } })); });
  t.after(async () => { await act(() => renderer.unmount()); globalThis.IS_REACT_ACT_ENVIRONMENT = prior; });
  const submit = () => renderer.root.findAllByType('button')[0]; assert.equal(submit().props.disabled, true); assert.equal(sent, undefined);
  await act(() => renderer.root.findAllByType('input')[0].props.onChange()); assert.equal(submit().props.disabled, true);
  await act(() => renderer.root.findByType('select').props.onChange({ target: { value: 'next' } }));
  await act(() => submit().props.onClick()); assert.deepEqual(sent, { action: 'transfer', transferTo: 'next', preview: preview.preview });
  await act(() => renderer.root.findAllByType('input')[1].props.onChange()); await act(() => submit().props.onClick());
  assert.deepEqual(sent, { action: 'stop', preview: preview.preview });
});
test('H7 operator UI loads server inventory and does not treat tenant errors as successful removal', async t => {
  const prior = globalThis.IS_REACT_ACT_ENVIRONMENT; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let renderer; const calls = [];
  const fetcher = async (url, options) => { calls.push({ url, options }); return { ok: false, json: async () => ({ errorCode: 'OPERATOR_REQUIRED' }) }; };
  await act(() => { renderer = create(createElement(OperatorUsers, { fetcher })); });
  t.after(async () => { await act(() => renderer.unmount()); globalThis.IS_REACT_ACT_ENVIRONMENT = prior; });
  const inputs = renderer.root.findAllByType('input');
  await act(() => inputs[0].props.onChange({ target: { value: 'tenant' } })); await act(() => inputs[1].props.onChange({ target: { value: 'synthetic' } }));
  await act(() => renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }));
  assert.equal(calls[0].options.headers.Authorization, 'Operator synthetic'); assert.equal(calls[0].options.credentials, 'omit');
  assert.doesNotMatch(calls[0].url, /synthetic/); assert.match(JSON.stringify(renderer.toJSON()), /OPERATOR_REQUIRED/);
  assert.equal(renderer.root.findAllByProps({ role: 'dialog' }).length, 0);
});
test('H7 hosted jobs UI displays the API recipient list and durable run/delivery histories', async t => {
  const prior = globalThis.IS_REACT_ACT_ENVIRONMENT; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let renderer, requested;
  const client = { listJobs: async () => [{ id: 'weekly', ownerId: 'owner', spec: { kind: 'report', enabled: true }, stopped: false, nextRun: null }], jobRecipients: async () => [{ id: 'reader', name: 'Tenant reader', email: 'reader@example.test' }],
    jobHistory: async id => { requested = id; return [{ id: 'occurrence', state: 'succeeded', createdAt: '2026-10-02', finishedAt: '2026-10-02', errorCode: null }]; }, jobDeliveries: async () => [{ delivery_id: 'key', recipient_id: 'reader', state: 'sent', attempts: 2, error_code: null }], runJob: async () => {} };
  await act(() => { renderer = create(createElement(AccessProvider, { access: { mode: 'hosted', session: { id: 'owner', role: 'author' } } }, createElement(JobManagement, { client }))); });
  t.after(async () => { await act(() => renderer.unmount()); globalThis.IS_REACT_ACT_ENVIRONMENT = prior; });
  await act(() => renderer.root.findAllByType('button').find(b => JSON.stringify(b.props.children).includes('History')).props.onClick());
  assert.equal(requested, 'weekly'); assert.match(JSON.stringify(renderer.toJSON()), /succeeded/); assert.match(JSON.stringify(renderer.toJSON()), /reader@example.test/); assert.match(JSON.stringify(renderer.toJSON()), /sent/);
});
