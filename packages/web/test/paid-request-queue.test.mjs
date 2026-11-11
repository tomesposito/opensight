import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { create } from 'react-test-renderer';
import { OperatorSignups } from '../build/test/OperatorSignups.js';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const text = node => typeof node === 'string' ? node : (node.children ?? []).map(text).join('');
test('241 operator queue renders server order, count, workspace links and resolves with operator credentials', async t => {
  const calls = [];
  let status = { enabled: false, paused: false, volumeCap: 25, trialsToday: 3, trialsLast24h: 3, convertedToday: 1, expiredToday: 2, queued: 0, paidRequestsOpen: 2, billingMode: 'waitlist', retentionDue: [], paidRequests: [
    { id: 'older', tenantId: 'tenant-old', displayName: 'Older workspace', tier: 'light', requestedByEmail: 'old@example.test', createdAt: '2026-11-18T00:00:00Z', state: 'pending' },
    { id: 'newer', tenantId: 'tenant-new', displayName: 'Newer workspace', tier: 'regular', requestedByEmail: 'new@example.test', createdAt: '2026-11-19T00:00:00Z', state: 'pending' },
  ] };
  const fetcher = async (url, init) => { calls.push({ url, ...init }); if (init.method === 'POST') { assert.deepEqual(JSON.parse(init.body), { requestId: 'older' }); status = { ...status, paidRequestsOpen: 1, paidRequests: status.paidRequests.slice(1) }; } return { ok: true, status: 200, json: async () => status }; };
  let ui; await act(() => { ui = create(createElement(OperatorSignups, { fetcher })); }); t.after(() => act(() => ui.unmount()));
  assert.equal(calls.length, 0);
  await act(() => ui.root.findByProps({ type: 'password' }).props.onChange({ target: { value: 'fixture-key' } }));
  await act(async () => ui.root.findByProps({ 'aria-label': 'Operator connection' }).props.onSubmit({ preventDefault() {} }));
  let rendered = text(ui.toJSON()); assert.match(rendered, /waiting list/); assert.match(rendered, /Paid requests open2/);
  assert.ok(rendered.indexOf('Older workspace') < rendered.indexOf('Newer workspace'));
  assert.ok(ui.root.findByProps({ href: '#operator-tenant/tenant-old' }));
  await act(async () => ui.root.findAllByType('button').find(b => text(b) === 'Grant Light (manual)').props.onClick());
  assert.match(calls.find(c => c.method === 'POST').url, /tenants\/tenant-old\/billing\/paid-request\/grant$/);
  assert.doesNotMatch(text(ui.toJSON()), /Older workspace/);
  for (const call of calls) { assert.equal(call.headers.Authorization, 'Operator fixture-key'); assert.equal(call.credentials, 'omit'); }
});
