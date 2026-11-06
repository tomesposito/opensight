import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { create } from 'react-test-renderer';
import { TrialBanner, BillingPanel, tierLabel } from '../build/test/TrialBilling.js';
import { createApiClient } from '../build/test/api-client.js';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const session = { id: 'admin', namespaceId: 'one', tenantId: 'tenant-one', name: 'Admin', role: 'administrator', workspaceName: 'Example reports', trial: { endsAt: '2099-11-19T00:00:00Z', daysRemaining: 6 }, billing: { trialEndsAt: '2099-11-19T00:00:00Z', retentionDueAt: '2099-12-19T00:00:00Z' } };
async function mount(t, Component, props) { let ui; await act(() => { ui = create(createElement(Component, props)); }); t.after(() => act(() => ui.unmount())); return ui; }
const text = node => typeof node === 'string' ? node : (node.children ?? []).map(text).join('');
test('197 trial banner uses server day-count despite client date, dismisses only for this mount, admin action only', async t => {
  const ui = await mount(t, TrialBanner, { session });
  assert.match(text(ui.toJSON()), /Day 9 of 14/); assert.equal(ui.root.findAllByType('a').length, 1);
  await act(() => ui.root.findByType('button').props.onClick()); assert.equal(ui.toJSON(), null);
  const fresh = await mount(t, TrialBanner, { session: { ...session, role: 'reader' } });
  assert.match(text(fresh.toJSON()), /Day 9 of 14/); assert.equal(fresh.root.findAllByType('a').length, 0);
});
test('197 expired screen offers exactly checkout/export/close; non-admins receive no action controls', async t => {
  const ui = await mount(t, BillingPanel, { session, client: {}, paused: true });
  assert.deepEqual(ui.root.findAllByType('button').map(text), ['Continue with Light — $29/mo', 'Export my data', 'Close workspace']);
  assert.match(text(ui.toJSON()), /Trial ended/); assert.doesNotMatch(text(ui.toJSON()), /Free plan|drop.to.Free/i);
  const reader = await mount(t, BillingPanel, { session: { ...session, role: 'reader' }, client: {}, paused: true });
  assert.equal(reader.root.findAllByType('button').length, 0); assert.equal(reader.root.findAllByType('input').length, 0);
  assert.equal(tierLabel('free'), 'Self-hosted');
});
test('197 session client retains the server trial payload', async () => {
  const api = createApiClient('https://example.test', async () => ({ ok: true, json: async () => session }));
  assert.deepEqual((await api.getSession()).trial, session.trial);
});
