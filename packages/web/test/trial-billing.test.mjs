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

const paidRequest = { tier: 'regular', state: 'pending', createdAt: '2026-11-19T00:00:00Z', requestedByEmail: 'requester@example.test' };
const waitlistBilling = { ...session.billing, billingMode: 'waitlist', paidRequest: null };
const waitlistSession = { ...session, billing: waitlistBilling };
const clickButton = (ui, label) => act(async () => { ui.root.findAllByType('button').find(b => text(b) === label).props.onClick(); });
const selectTier = (ui, tier) => act(() => ui.root.findByProps({ type: 'radio', value: tier }).props.onChange());

test('241 request, tier change and withdrawal render authoritative server state and exact copy', async t => {
  const calls = [], client = {
    requestPaidPlan: async tier => { calls.push(tier); return { billing: { ...waitlistBilling, retentionDueAt: null, paidRequest: { ...paidRequest, tier } } }; },
    withdrawPaidRequest: async () => ({ billing: { ...waitlistBilling, paidRequest: { ...paidRequest, state: 'withdrawn' } } }),
  };
  const ui = await mount(t, BillingPanel, { session: waitlistSession, client, paused: true });
  assert.match(text(ui.toJSON()), /Paid plans are opening in batches\. Request your plan and we'll email you when it's switched on\. Requesting charges nothing\./);
  await selectTier(ui, 'regular'); await clickButton(ui, 'Request Regular — $99/mo');
  assert.match(text(ui.toJSON()), /You're on the waiting list for Regular\./);
  assert.match(text(ui.toJSON()), /You requested it on November 19\. We'll email requester@example\.test when your plan is switched on\. Your workspace and everything in it stays exactly as it is while you wait\./);
  assert.doesNotMatch(text(ui.toJSON()), /We'll keep everything until/);
  assert.ok(ui.root.findAllByType('button').some(b => text(b) === 'Export my data'));
  await selectTier(ui, 'heavy'); await clickButton(ui, 'Change to Heavy — $399/mo');
  assert.deepEqual(calls, ['regular', 'heavy']); assert.match(text(ui.toJSON()), /waiting list for Heavy/);
  await clickButton(ui, 'Withdraw request'); assert.match(text(ui.toJSON()), /We'll keep everything until/);
  assert.ok(ui.root.findAllByType('button').some(b => text(b).startsWith('Request Heavy')));
});

test('241 trial pending, declined, non-admin and manual-grant states do not offer misleading actions', async t => {
  const trial = await mount(t, BillingPanel, { session: { ...waitlistSession, billing: { ...waitlistBilling, paidRequest } }, client: {} });
  assert.match(text(trial.toJSON()), /Request received for Regular\. We'll email you when your plan is switched on\. Nothing is charged\./);
  assert.doesNotMatch(text(trial.toJSON()), /You're on the waiting list/);
  const declined = await mount(t, BillingPanel, { session: { ...waitlistSession, billing: { ...waitlistBilling, paidRequest: { ...paidRequest, state: 'declined' } } }, client: {}, paused: true });
  assert.match(text(declined.toJSON()), /Your request for Regular was declined\. You can export your data or close the workspace below, or write to us at support@getopensight\.org\./);
  assert.ok(declined.root.findAllByType('button').some(b => text(b) === 'Request Regular — $99/mo'));
  const reader = await mount(t, BillingPanel, { session: { ...waitlistSession, role: 'reader' }, client: {}, paused: true });
  assert.equal(reader.root.findAllByType('button').length, 0); assert.equal(reader.root.findAllByType('input').length, 0);
  const manual = await mount(t, BillingPanel, { session: { ...waitlistSession, trial: null, billing: { ...waitlistBilling, tier: 'heavy', entitlementSource: 'manual', paidRequest: { ...paidRequest, state: 'granted' } } }, client: {} });
  assert.match(text(manual.toJSON()), /No payment was taken/); assert.equal(manual.root.findAllByType('button').length, 0);
});

test('241 failed requests preserve the picker and show an error; refresh replaces declined/pending state', async t => {
  const ui = await mount(t, BillingPanel, { session: waitlistSession, client: { requestPaidPlan: async () => { throw new Error('Request unavailable'); } }, paused: true });
  await selectTier(ui, 'heavy'); await clickButton(ui, 'Request Heavy — $399/mo');
  assert.match(text(ui.toJSON()), /Request unavailable/); assert.equal(ui.root.findByProps({ type: 'radio', value: 'heavy' }).props.checked, true);
  await act(() => ui.update(createElement(BillingPanel, { session: { ...waitlistSession, billing: { ...waitlistBilling, paidRequest } }, client: {}, paused: true })));
  assert.match(text(ui.toJSON()), /waiting list for Regular/); assert.equal(ui.root.findByProps({ type: 'radio', value: 'regular' }).props.checked, true);
});

test('241 billing client sends only tier and uses DELETE for withdrawal; session retains server mode and request', async () => {
  const calls = [], value = { ...waitlistSession, billing: { ...waitlistBilling, paidRequest } };
  const api = createApiClient('https://example.test', async (url, init) => { calls.push({ url, init }); return { ok: true, json: async () => url.endsWith('/session') ? value : { billing: value.billing } }; });
  assert.deepEqual((await api.getSession()).billing, value.billing);
  await api.requestPaidPlan('regular'); await api.withdrawPaidRequest();
  assert.equal(calls[1].url, 'https://example.test/api/billing/paid-request'); assert.deepEqual(JSON.parse(calls[1].init.body), { tier: 'regular' });
  assert.equal(calls[2].init.method, 'DELETE'); assert.equal(calls[2].init.body, undefined);
});
