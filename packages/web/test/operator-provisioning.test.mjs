import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { create } from 'react-test-renderer';
import { readFileSync } from 'node:fs';
import { OperatorTenants } from '../build/test/OperatorTenants.js';
import { OperatorTenant } from '../build/test/OperatorTenant.js';
import { deriveTenantSlug } from '../build/test/operator-provisioning.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const summary = { tenantId: 'tenant-one', displayName: 'Northwind', slug: 'northwind', state: 'active', tier: 'free', memberCount: 1, createdAt: '2026-11-01T00:00:00Z' };
const detail = { ...summary, namespaceId: 'namespace-one', version: 2, createdOperationId: 'operation-one', tombstone: null };
const usage = { day: '2026-11-05', period: '2026-11', apiCalls: 8, queries: 2, storageBytes: 512, nlq: 3, quotas: { apiCalls: 100, queries: 10, storageBytes: 1024, nlq: 20 } };
const response = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
const failure = (code, status = 400, field) => response({ errorCode: code, ...(field ? { field } : {}) }, status);
async function mount(t, Component, handler, props = {}) {
  const calls = []; let ui;
  const fetcher = async (url, init) => { const call = { path: url.replace(/^\/api\/api\/host\//, ''), ...init, input: init.body ? JSON.parse(init.body) : undefined }; calls.push(call); return handler(call); };
  await act(async () => { ui = create(createElement(Component, { fetcher, ...props })); });
  t.after(() => act(() => ui.unmount()));
  return { get root() { return ui.root; }, text: () => JSON.stringify(ui.toJSON()), calls };
}
const button = (ui, text) => ui.root.findAllByType('button').find(node => node.children.join('') === text);
const field = (ui, label) => ui.root.findAllByType('label').find(node => node.children[0] === label).find(node => ['input', 'select'].includes(node.type));
const change = (node, value) => act(() => node.props.onChange({ target: { value } }));
const click = node => act(async () => node.props.onClick());
const submit = (ui, name) => act(async () => { ui.root.findByProps({ 'aria-label': name }).props.onSubmit({ preventDefault() {} }); });
const connect = async ui => { await change(field(ui, 'Operator credential'), 'synthetic-key'); await submit(ui, 'Operator connection'); };
const formValues = async ui => {
  await change(field(ui, 'Workspace display name'), 'Sales & Ops'); await change(field(ui, 'Administrator name'), 'Admin'); await change(field(ui, 'Administrator email'), 'admin@example.test');
};
function detailHandler({ state = detail, billing = { tier: 'regular', subscriptionStatus: 'active', accessState: 'active' }, extra } = {}) {
  return call => {
    const result = extra?.(call); if (result) return result;
    if (call.path === 'tenants/tenant-one') return response(state);
    if (call.path.endsWith('/billing')) return billing === null ? failure('RESOURCE_NOT_FOUND', 404) : response({ billing });
    if (call.path.endsWith('/users')) return response([{ id: 'admin', name: 'Workspace Admin', role: 'administrator', status: 'active' }]);
    if (call.path.startsWith('usage/')) return response({ overview: usage });
    throw Error(`Unexpected request ${call.method} ${call.path}`);
  };
}

test('192 C: list is credential-gated, filters name/slug, shows deleted and legacy labels, disconnect clears', async t => {
  let permitted = false;
  const ui = await mount(t, OperatorTenants, () => permitted ? response({ tenants: [summary, { ...summary, tenantId: 'deleted', displayName: 'Old Mill', slug: 'old-mill', state: 'deleted' }, { ...summary, tenantId: 'legacy', displayName: null, slug: null, createdAt: null }] }) : failure('OPERATOR_REQUIRED', 403));
  assert.equal(ui.calls.length, 0); assert.equal(button(ui, 'New tenant'), undefined);
  await connect(ui); assert.match(ui.text(), /OPERATOR_REQUIRED/); assert.equal(button(ui, 'New tenant'), undefined);
  permitted = true; await connect(ui);
  assert.match(ui.text(), /Old Mill/); assert.match(ui.text(), /Deleted/); assert.match(ui.text(), /legacy/); assert.match(ui.text(), /Unknown/);
  assert.equal(ui.root.findAllByType('input').some(n => n.props.type === 'password'), false);
  await change(field(ui, 'Filter tenants'), 'OLD-MILL'); assert.doesNotMatch(ui.text(), /Northwind/); assert.match(ui.text(), /Old Mill/);
  await click(button(ui, 'Disconnect')); assert.doesNotMatch(ui.text(), /Old Mill/); assert.equal(field(ui, 'Operator credential').props.value, '');
  for (const call of ui.calls) { assert.equal(call.credentials, 'omit'); assert.equal(call.headers.Authorization, 'Operator synthetic-key'); assert.equal(call.headers.Cookie, undefined); }
});

test('192 C: create derives labels until edited, paid selection is a second request, success links to detail', async t => {
  const ui = await mount(t, OperatorTenants, call => {
    if (call.method === 'GET') return response({ tenants: [] });
    if (call.path === 'tenants') return response({ tenantId: 'new-tenant' }, 201);
    return response({ url: 'https://billing.example.test/pay' }, 201);
  });
  await connect(ui); assert.match(ui.text(), /No tenants yet. Create the first tenant./);
  await formValues(ui); assert.equal(field(ui, 'Tenant name').props.value, 'Sales & Ops'); assert.equal(field(ui, 'Slug').props.value, 'sales-ops');
  await change(field(ui, 'Tenant name'), 'Internal'); await change(field(ui, 'Slug'), 'custom'); await change(field(ui, 'Workspace display name'), 'Public');
  assert.equal(field(ui, 'Tenant name').props.value, 'Internal'); assert.equal(field(ui, 'Slug').props.value, 'custom');
  await change(ui.root.findByProps({ type: 'radio', value: 'regular' }), 'regular'); await submit(ui, 'Create tenant');
  const posts = ui.calls.filter(call => call.method === 'POST'); assert.equal(posts.length, 2);
  assert.deepEqual(posts[0].input, { displayName: 'Public', name: 'Internal', slug: 'custom', administrator: { name: 'Admin', email: 'admin@example.test' } });
  assert.deepEqual(posts[1].input, { tier: 'regular' }); assert.ok(posts[0].headers['Idempotency-Key']);
  assert.match(ui.text(), /Tenant created on the Free plan/); assert.match(ui.text(), /Regular plan starts when they pay/); assert.ok(button(ui, 'Copy link'));
  assert.ok(ui.root.findByProps({ href: '#operator-tenant/new-tenant' }));
});

test('192 C: creation errors preserve values, name fields, and reuse the same idempotency key', async t => {
  let error = failure('TENANT_SLUG_CONFLICT', 409);
  const ui = await mount(t, OperatorTenants, call => call.method === 'GET' ? response({ tenants: [] }) : error);
  await connect(ui); await formValues(ui); await submit(ui, 'Create tenant');
  assert.match(ui.text(), /sales-ops is already in use/); assert.equal(field(ui, 'Workspace display name').props.value, 'Sales & Ops');
  error = failure('METADATA_INVALID', 400, 'displayName'); await submit(ui, 'Create tenant'); assert.equal(field(ui, 'Workspace display name').props['aria-invalid'], true);
  error = failure('METADATA_INVALID'); await submit(ui, 'Create tenant'); assert.match(ui.text(), /METADATA_INVALID/);
  error = failure('SMTP_NOT_CONFIGURED', 503); await submit(ui, 'Create tenant'); assert.match(ui.text(), /No tenant was created/);
  const keys = ui.calls.filter(call => call.method === 'POST').map(call => call.headers['Idempotency-Key']); assert.equal(new Set(keys).size, 1);
});

test('192 C: cancelling first-tenant creation returns to the empty list and ends the form session', async t => {
  const ui = await mount(t, OperatorTenants, call => call.method === 'GET' ? response({ tenants: [] }) : failure('SMTP_NOT_CONFIGURED', 503));
  await connect(ui); await formValues(ui); await submit(ui, 'Create tenant');
  const previousKey = ui.calls.find(call => call.method === 'POST').headers['Idempotency-Key'];
  await click(button(ui, 'Cancel'));
  assert.equal(ui.root.findAllByProps({ 'aria-label': 'Create tenant' }).length, 0);
  assert.match(ui.text(), /No tenants yet\. Create the first tenant\./);
  await click(button(ui, 'New tenant'));
  assert.equal(field(ui, 'Workspace display name').props.value, '');
  await formValues(ui); await submit(ui, 'Create tenant');
  assert.notEqual(ui.calls.filter(call => call.method === 'POST').at(-1).headers['Idempotency-Key'], previousKey);
});

test('192 C: in-flight submits cannot create twice; unconfigured billing preserves successful creation', async t => {
  let finish;
  const ui = await mount(t, OperatorTenants, call => call.method === 'GET' ? response({ tenants: [] }) : call.path === 'tenants' ? new Promise(resolve => { finish = resolve; }) : failure('RESOURCE_NOT_FOUND', 404));
  await connect(ui); await formValues(ui); await change(ui.root.findByProps({ type: 'radio', value: 'heavy' }), 'heavy');
  await submit(ui, 'Create tenant'); await submit(ui, 'Create tenant');
  assert.equal(ui.calls.filter(c => c.method === 'POST').length, 1); assert.equal(button(ui, 'Create tenant').props.disabled, true);
  await act(async () => finish(response({ tenantId: 'new' }, 201)));
  assert.match(ui.text(), /Billing is not configured/); assert.match(ui.text(), /no link generated/); assert.equal(button(ui, 'Create tenant'), undefined);
});

test('192 C: Free creation makes no billing call and slug derivation matches D-83 boundaries', async t => {
  const ui = await mount(t, OperatorTenants, call => response(call.method === 'GET' ? { tenants: [] } : { tenantId: 'new' }));
  await connect(ui); await formValues(ui); await submit(ui, 'Create tenant'); assert.match(ui.text(), /Tenant created on the Free plan/); assert.equal(ui.calls.some(call => call.path.includes('billing')), false);
  for (const [name, slug] of [[' Sales & Ops! ', 'sales-ops'], ['東京', ''], ['A'.repeat(63) + ' !tail', 'a'.repeat(63)], ['A'.repeat(70), 'a'.repeat(64)]]) assert.equal(deriveTenantSlug(name), slug);
});

test('192 C: detail shows inline usage and billing, link generation keeps tier, invitations never display tokens', async t => {
  const ui = await mount(t, OperatorTenant, detailHandler({ extra: call => {
    if (call.path.endsWith('/payment-link')) return response({ url: 'https://billing.example.test/new' });
    if (call.path.endsWith('/invitations')) return response({ operationId: 'invite-one', tenantId: 'tenant-one' });
  } }), { tenantId: 'tenant-one' });
  await connect(ui); assert.match(ui.text(), /Workspace Admin/); assert.match(ui.text(), /operation-one/); assert.match(ui.text(), /Tenant usage/);
  assert.equal(ui.root.findAllByType('progress').length, 4);
  let copied; Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { async writeText(value) { copied = value; } } });
  t.after(() => { delete navigator.clipboard; });
  await change(field(ui, 'Payment link for tier'), 'heavy'); await submit(ui, 'Generate payment link');
  assert.match(ui.text(), /Regular · \$99\/mo/); assert.match(ui.text(), /Heavy plan starts when they pay/);
  await click(button(ui, 'Copy link')); assert.equal(copied, 'https://billing.example.test/new'); assert.match(ui.text(), /Payment link copied/);
  await change(field(ui, 'Invite member — email'), 'reader@example.test'); await change(field(ui, 'Name'), 'Reader'); await change(field(ui, 'Role'), 'reader_ai'); await submit(ui, 'Invite member');
  assert.deepEqual(ui.calls.find(c => c.path.endsWith('/invitations')).input, { email: 'reader@example.test', name: 'Reader', role: 'reader_ai' }); assert.match(ui.text(), /Invitation emailed/);
  assert.equal(ui.root.findAllByType('input').some(n => /token/i.test(n.props.type ?? '')), false);
  await click(button(ui, 'Disconnect')); assert.equal(ui.root.findAllByType('progress').length, 0); assert.doesNotMatch(ui.text(), /Workspace Admin/);
});

test('197: billing 404 removes controls; paused resolutions exclude drop-to-Free', async t => {
  const missing = await mount(t, OperatorTenant, detailHandler({ billing: null }), { tenantId: 'tenant-one' }); await connect(missing);
  assert.equal(missing.root.findAllByType('button').some(b => b.children.join('').includes('Generate payment link')), false);
  const paused = await mount(t, OperatorTenant, detailHandler({ billing: { tier: 'regular', accessState: 'paused', subscriptionStatus: 'unpaid' } }), { tenantId: 'tenant-one' }); await connect(paused);
  assert.match(paused.text(), /paying in Stripe, exporting data, or closing the workspace/);
  assert.doesNotMatch(paused.text(), /Drop to Free/);
});

test('192 C: lifecycle uses freshly read version; conflict refetches; restore-review refusal is explicit', async t => {
  let version = 2, state = 'active', conflict = true;
  const ui = await mount(t, OperatorTenant, detailHandler({ extra: call => {
    if (call.path === 'tenants/tenant-one') return response({ ...detail, version, state });
    if (call.path.endsWith('/suspend')) { assert.equal(call.input.expectedVersion, 9); state = 'suspended'; return failure('METADATA_CONFLICT', 409); }
    if (call.path.endsWith('/resume')) { if (conflict) return failure('RESTORE_REVIEW_REQUIRED', 409); state = 'active'; return response({}); }
  } }), { tenantId: 'tenant-one' }); await connect(ui); version = 9;
  await click(button(ui, 'Suspend')); assert.match(ui.text(), /This tenant changed since you loaded it/); assert.ok(button(ui, 'Resume')); assert.match(ui.text(), /Tenant suspended/);
  const transition = ui.calls.findIndex(c => c.path.endsWith('/suspend')); assert.equal(ui.calls[transition - 1].path, 'tenants/tenant-one'); assert.equal(ui.calls[transition + 1].path, 'tenants/tenant-one');
  await click(button(ui, 'Resume')); assert.match(ui.text(), /RESTORE_REVIEW_REQUIRED/);
  conflict = false; await click(button(ui, 'Resume')); assert.match(ui.text(), /Tenant resumed/);
});

test('192 C: typed-slug deletion, deleting and deleted views are read-only and retain erasure facts', async t => {
  let deleted = false;
  const ui = await mount(t, OperatorTenant, detailHandler({ extra: call => {
    if (call.path === 'tenants/tenant-one') { if (call.method === 'DELETE') { deleted = true; return response({}); } return response({ ...detail, state: deleted ? 'deleting' : 'active' }); }
  } }), { tenantId: 'tenant-one' }); await connect(ui); await click(button(ui, 'Delete…'));
  assert.equal(button(ui, 'Delete tenant').props.disabled, true); const input = ui.root.findByProps({ role: 'dialog' }).findByType('input');
  await change(input, 'wrong'); assert.equal(button(ui, 'Delete tenant').props.disabled, true); assert.equal(deleted, false);
  await change(input, 'northwind'); await click(button(ui, 'Delete tenant')); assert.equal(deleted, true); assert.equal(button(ui, 'Suspend'), undefined); assert.equal(button(ui, 'Delete…'), undefined);
  const tombstone = await mount(t, OperatorTenant, detailHandler({ state: { ...detail, state: 'deleted', tombstone: '2026-11-05T00:00:00Z' } }), { tenantId: 'tenant-one' }); await connect(tombstone);
  assert.equal(tombstone.calls.length, 1); assert.equal(button(tombstone, 'Send invitation'), undefined); assert.equal(button(tombstone, 'Generate payment link'), undefined);
  assert.match(tombstone.text(), /Audit entries are retained/); assert.match(tombstone.text(), /unsupported and fails closed/); assert.match(tombstone.text(), /read-only/);
});

test('192 C: route guards exclude offline app; operator navigation contains all three surfaces', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(app, /!offline && operator === '#operator-tenants'/); assert.match(app, /!offline && operatorTenant/); assert.match(app, /key=\{operatorTenant\[1\]\}/);
  for (const page of ['OperatorUsers', 'OperatorIdeas']) assert.match(readFileSync(new URL(`../src/${page}.tsx`, import.meta.url), 'utf8'), /OperatorNav current=/);
  for (const page of ['OperatorTenants', 'OperatorTenant', 'operator-provisioning']) assert.doesNotMatch(readFileSync(new URL(`../src/${page}.tsx`, import.meta.url), 'utf8'), /localStorage|sessionStorage|document\.cookie/);
});
