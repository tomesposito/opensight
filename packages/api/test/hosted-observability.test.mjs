import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { sourceFixture } from './source-helpers.mjs';
import { HostedObservability, initializeObservability, authorizeAuditOperator } from '../dist/hosted-observability.js';
import { TenantBudgets } from '../dist/budgets.js';
import { budgetConfig } from './budget-helpers.mjs';
import { eventContext, requestOperation } from '../dist/hosted-events.js';

test('H8 audit scope refuses copied context, other namespaces, revoked authority and provisioning credentials', async t => {
  const f = await sourceFixture(t); await initializeObservability(f.db);
  const audit = new HostedObservability(f.db, f.metadata), a = await f.login(), b = await f.login('two');
  for (const context of [a, b]) await audit.write({ operation: 'request', ...context, requestId: 'synthetic', outcome: 'succeeded' });
  assert.equal((await audit.tenantAudit(a)).length, 1); assert.equal((await audit.tenantAudit(b))[0].tenantId, b.tenantId);
  await assert.rejects(audit.tenantAudit({ ...a, tenantId: b.tenantId }), { code: 'TENANT_CONTEXT_REQUIRED' });
  await f.db.transaction(c => c.query('UPDATE h1_revisions SET "authorization" = 2 WHERE tenant_id = ?', [a.tenantId]));
  await assert.rejects(audit.tenantAudit(a), { code: 'AUTHORIZATION_REVISED' });
  const key = randomBytes(32), env = { OPENSIGHT_AUDIT_OPERATOR_KEY: key.toString('base64') };
  for (const token of [undefined, `Operator ${key.toString('base64url')}`, `Bearer ${key.toString('base64url')}`]) assert.throws(() => authorizeAuditOperator(token, env), { code: 'AUDIT_OPERATOR_REQUIRED' });
  authorizeAuditOperator(`AuditOperator ${key.toString('base64url')}`, env);
  assert.equal(JSON.stringify(audit.metrics()).includes(a.tenantId), false);
});
test('H8 usage and entitlement hooks are durable and idempotent, with conflicting replay denied', async t => {
  const f = await sourceFixture(t); await initializeObservability(f.db); let audit = new HostedObservability(f.db, f.metadata); const a = await f.login();
  const hook = { eventId: 'synthetic-event', type: 'usage.recorded', schemaRevision: 1, interval: { start: '2026-10-02T00:00:00.000Z', end: '2026-10-02T00:01:00.000Z' }, resource: 'synthetic-request', units: { executionMs: 12, sourceRows: 3 } };
  await Promise.all([audit.hook(a, hook), audit.hook(a, { ...hook, units: { sourceRows: 3, executionMs: 12 } })]);
  await assert.rejects(audit.hook(a, { ...hook, units: { sourceRows: 4 } }), { code: 'USAGE_EVENT_ID_REUSED' });
  await audit.hook(a, { ...hook, eventId: 'synthetic-entitlement', type: 'entitlement.changed', units: { queued: 2 } });
  await f.restart(); audit = new HostedObservability(f.db, f.metadata);
  assert.equal((await audit.pendingHooks()).length, 2); await audit.acknowledgeHook(hook.eventId); await audit.acknowledgeHook(hook.eventId);
  assert.equal((await audit.pendingHooks()).length, 1);
  assert.equal((await f.db.transaction(c => c.query('SELECT state FROM h1_tenants WHERE tenant_id = ?', [a.tenantId])))[0].state, 'active');
});
test('H8 budgets attribute accounted usage to the originating request even when another request dequeues it', async t => {
  const f = await sourceFixture(t), a = await f.login(), budgets = new TenantBudgets(budgetConfig, c => f.metadata.assertContext(c));
  const first = { requestId: 'one', usage: { executionMs: 0, sourceRows: 0, workingBytes: 0 } }, second = { requestId: 'two', usage: { executionMs: 0, sourceRows: 0, workingBytes: 0 } };
  let release;
  const p1 = eventContext.run(first, () => budgets.run(a, false, async () => {}, async () => { budgets.current(a).rows(2); await new Promise(resolve => { release = resolve; }); }));
  while (!release) await new Promise(resolve => setImmediate(resolve));
  const p2 = eventContext.run(second, () => budgets.run(a, false, async () => {}, async () => { budgets.current(a).rows(7); }));
  release(); await Promise.all([p1, p2]); assert.equal(first.usage.sourceRows, 2); assert.equal(second.usage.sourceRows, 7);
  assert.equal(budgets.aggregate().sourceRows, 9); assert.equal(Object.keys(budgets.aggregate()).includes(a.tenantId), false);
});
test('H8 request operation names never include route parameters or bootstrap URLs', () => {
  assert.equal(requestOperation('/api/auth/login', 'POST'), 'auth.login');
  assert.equal(requestOperation('/api/embedding/sessions/private-id', 'DELETE'), 'embed.revoke');
  assert.equal(requestOperation('/private-connection-string', 'GET'), 'request');
});
