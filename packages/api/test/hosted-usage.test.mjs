import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { h8Fixture, serveH8 } from './h8-helpers.mjs';
import { HostedUsage, initializeUsage, entitlementConfig, resourceBytes } from '../dist/hosted-usage.js';
import { TenantMetadata } from '../dist/metadata.js';
import { HostedSources } from '../dist/hosted-sources.js';
import { HostedData } from '../dist/hosted-data.js';
import { TenantBudgets } from '../dist/budgets.js';
import { budgetConfig } from './budget-helpers.mjs';
import { endpoints, registration, upload } from './source-helpers.mjs';
import { JobStore } from '../dist/job-store.js';
import { JobRunner } from '../dist/job-runner.js';
import { executor, report, refresh } from './job-helpers.mjs';
import { StubMailTransport } from '../dist/mail.js';
import { drainHostedServer } from '../dist/hosted-server.js';
const limits = { apiCalls: 5, storageBytes: 100000, computeAttempts: 2 };
export const usageEnvironment = { OPENSIGHT_REFERENCE: 'single-node', OPENSIGHT_REFERENCE_LOCATION: 'local', OPENSIGHT_ENTITLEMENTS: JSON.stringify({ defaults: limits, tenants: {} }) };
async function setup(t, overrides = {}) {
  const f = await h8Fixture(t); await initializeUsage(f.db);
  const config = { defaults: { ...limits, ...overrides }, tenants: {} };
  let now = Date.UTC(2026, 9, 3);
  const usage = new HostedUsage(f.db, config, () => now), metadata = new TenantMetadata(f.db, f.db, usage);
  const login = (ns = 'one') => metadata.authenticate(null, async () => ({ namespaceId: ns, userId: 'admin' }));
  return { ...f, config, usage, metadata, login, advance: () => { now += 86400000; } };
}

test('H8 competing tenants have atomic durable daily limits, exact events, restart and UTC reset', async t => {
  const f = await setup(t), one = await f.login(), two = await f.login('two'), started = performance.now();
  const run = c => f.usage.consume(f.metadata, c, 'apiCalls');
  const results = await Promise.allSettled(Array.from({ length: 40 }, (_, i) => run(i % 2 ? one : two)));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 10);
  assert.equal(results.filter(r => r.status === 'rejected' && r.reason.code === 'USAGE_LIMIT_EXCEEDED').length, 30);
  const events = await f.db.transaction(c => c.query('SELECT * FROM h8_usage_events'));
  assert.equal(events.length, 40); assert.ok(events.every(e => e.amount === 1 && e.unit === 'call'));
  assert.equal(new Set(events.map(e => e.event_id)).size, 40);
  await assert.rejects(run({ ...one, tenantId: two.tenantId }), { code: 'TENANT_CONTEXT_REQUIRED' });
  await assert.rejects(new HostedUsage(f.db, f.config, f.usage.clock).consume(f.metadata, one, 'apiCalls'), { code: 'USAGE_LIMIT_EXCEEDED' });
  f.advance(); await run(one);
  t.diagnostic(`H8 load: 40 concurrent submissions, 10 admitted, 30 denied; elapsed ${Math.round(performance.now() - started)} ms`);
});

test('H8 storage gates encrypted sources/uploads and embedded metadata transactionally', async t => {
  const f = await setup(t, { storageBytes: 500 }), context = await f.login();
  const sources = new HostedSources(f.metadata, f.env.OPENSIGHT_AUTH_ENCRYPTION_KEY, endpoints);
  const before = await f.db.transaction(c => resourceBytes(c, context));
  await assert.rejects(sources.create(context, 'oversize', registration()), { code: 'USAGE_LIMIT_EXCEEDED' });
  await assert.rejects(sources.upload(context, upload()), { code: 'USAGE_LIMIT_EXCEEDED' });
  assert.equal(await f.db.transaction(c => resourceBytes(c, context)), before);
  assert.equal((await f.metadata.list(context, 'secret')).length, 0);
  await f.metadata.put(context, { kind: 'group', id: 'small' }, { name: 'small', userIds: [] });
  const stored = await f.db.transaction(c => c.query("SELECT event_type FROM h1_outbox WHERE event_type LIKE 'usage.storage.bytes:%'"));
  assert.equal(stored.length, 1);
  assert.equal(Number(stored[0].event_type.split(':')[1]), await f.db.transaction(c => resourceBytes(c, context)));
  // Tightening a policy still permits shrinking/removal; growth rolls back.
  const tighter = new HostedUsage(f.db, { defaults: { ...limits, storageBytes: 0 }, tenants: {} });
  const metadata = new TenantMetadata(f.db, f.db, tighter), fresh = await metadata.authenticate(null, async () => ({ namespaceId: 'one', userId: 'admin' }));
  await metadata.remove(fresh, { kind: 'group', id: 'small' }, 1);
});

test('H8 compute denies scheduled refresh/report and manual refresh before executor or source I/O', async t => {
  const f = await setup(t, { computeAttempts: 0 }), context = await f.login();
  const e = executor(); let executions = 0; e.execute = async () => { executions++; return {}; };
  const store = new JobStore(f.db, f.metadata, () => new Date(f.usage.clock())), runner = new JobRunner(store, e, new StubMailTransport());
  for (const [id, spec] of [['refresh', refresh], ['report', { ...report, recipients: ['admin'] }]]) {
    await store.put(context, id, spec, 0, async () => {}); await store.enqueue(context, id, async () => {});
  }
  await runner.tick();
  assert.equal(executions, 0);
  const rows = await f.db.transaction(c => c.query('SELECT state,error_code FROM h7_occurrences'));
  assert.equal(rows.length, 2); assert.ok(rows.every(r => r.state === 'failed' && r.error_code === 'USAGE_LIMIT_EXCEEDED'));
  const sources = new HostedSources(f.metadata, f.env.OPENSIGHT_AUTH_ENCRYPTION_KEY, endpoints);
  await sources.create(context, 'source', registration());
  const fresh = await f.login(), budgets = new TenantBudgets(budgetConfig, c => f.metadata.assertContext(c));
  t.after(() => budgets.close());
  const data = new HostedData(sources, async () => { executions++; throw Error('must not open'); }, budgets);
  await assert.rejects(data.refresh(fresh, 'source'), { code: 'USAGE_LIMIT_EXCEEDED' });
  assert.equal(executions, 0);
  const events = await f.db.transaction(c => c.query("SELECT * FROM h8_usage_events WHERE metric = 'computeAttempts'"));
  assert.equal(events.length, 3); assert.ok(events.every(e => e.outcome === 'denied' && e.unit === 'attempt'));
});

test('H8 absent/malformed entitlements fail closed, with no foreign context or HTTP bypass', async t => {
  for (const raw of [undefined, '{}', '{"defaults":null}', JSON.stringify({ defaults: { ...limits, apiCalls: -1 }, tenants: {} })]) assert.throws(() => entitlementConfig(raw), { code: 'ENTITLEMENT_UNRESOLVED' });
  const f = await setup(t), context = await f.login();
  await assert.rejects(new HostedUsage(f.db, { defaults: null, tenants: {} }).consume(f.metadata, context, 'apiCalls'), { code: 'ENTITLEMENT_UNRESOLVED' });
  Object.assign(f.env, usageEnvironment, { OPENSIGHT_ENTITLEMENTS: JSON.stringify({ defaults: { ...limits, apiCalls: 1 }, tenants: {} }) });
  const { request, operator, server } = await serveH8(t, f);
  assert.equal((await request('/api/session', { headers: { authorization: 'one' } })).status, 200);
  assert.equal((await request('/api/session', { headers: { authorization: 'one' } })).body.errorCode, 'USAGE_LIMIT_EXCEEDED');
  assert.equal((await request('/api/session', { headers: { authorization: 'two' } })).status, 200);
  assert.equal((await request('/api/namespaces/two/session', { headers: { authorization: 'one' } })).body.errorCode, 'RESOURCE_NOT_FOUND');
  assert.equal((await request('/metrics', { headers: { authorization: 'one' } })).body.errorCode, 'OPERATOR_REQUIRED');
  const metrics = await request('/metrics', { headers: operator });
  assert.match(metrics.body, /opensight_usage_admitted.*tenant-one.* 1/); assert.match(metrics.body, /opensight_usage_denied.*tenant-one.* 1/);
  await drainHostedServer(server);
});


test('H8 admitted scheduled refresh is charged once, manual refresh is charged, corrupt accounting fails closed', async t => {
  const f = await setup(t), sources = new HostedSources(f.metadata, f.env.OPENSIGHT_AUTH_ENCRYPTION_KEY, endpoints);
  const c = await f.login(), source = await sources.upload(c, upload());
  const budgets = new TenantBudgets(budgetConfig, context => f.metadata.assertContext(context)); t.after(() => budgets.close());
  const data = new HostedData(sources, undefined, budgets);
  const { EmbedContent } = await import('../dist/embed-content.js');
  const { JobRenderer } = await import('../dist/job-renderer.js');
  const renderer = new JobRenderer(data, new EmbedContent(data));
  const store = new JobStore(f.db, f.metadata, () => new Date(f.usage.clock())), runner = new JobRunner(store, renderer, new StubMailTransport());
  const spec = { ...refresh, target: { kind: 'source', id: source.id } };
  await store.put(c, 'refresh-once', spec, 0, (context, job) => renderer.authorize(context, job));
  await store.enqueue(c, 'refresh-once'); await runner.tick();
  assert.equal((await store.history(c, 'refresh-once'))[0].state, 'succeeded');
  assert.equal((await f.db.transaction(c => c.query('SELECT admitted FROM h8_usage')))[0].admitted, 1);
  await data.refresh(await f.login(), source.id);
  await assert.rejects(data.refresh(await f.login(), source.id), { code: 'USAGE_LIMIT_EXCEEDED' });
  await f.db.transaction(c => c.query('UPDATE h8_usage SET admitted = -1'));
  await assert.rejects(f.usage.consume(f.metadata, await f.login(), 'computeAttempts'), { code: 'ENTITLEMENT_UNRESOLVED' });
  await f.db.transaction(c => c.query('DROP TABLE h8_usage'));
  await assert.rejects(f.usage.consume(f.metadata, await f.login(), 'apiCalls'), { code: 'ENTITLEMENT_UNRESOLVED' });
});

test('H8 verified embed requests share the tenant API limit; frame credentials cannot bypass it', async t => {
  const { sessionFixture } = await import('./embed-session-helpers.mjs');
  const { seedEmbedContent } = await import('./embed-content-helpers.mjs');
  const { serverEnvironment } = await import('./embed-http-helpers.mjs');
  const f = await sessionFixture(t); await seedEmbedContent(f); await initializeUsage(f.db);
  const issued = await f.issue(), redeemed = await f.redeem(issued);
  const h = { ...f, env: serverEnvironment(f, { ...usageEnvironment, OPENSIGHT_ENTITLEMENTS: JSON.stringify({ defaults: { ...limits, apiCalls: 0 }, tenants: {} }) }) };
  const { server, request } = await serveH8(t, h, { security: { authenticate: f.auth.authenticate } });
  assert.equal((await request(`/api/embed/sessions/${issued.sessionId}/status`, { headers: { authorization: `Embed ${redeemed.credential}` } })).body.errorCode, 'USAGE_LIMIT_EXCEEDED');
  assert.equal((await request(`/api/embed/sessions/${issued.sessionId}/content`, { headers: { authorization: `Embed ${redeemed.credential}` } })).body.errorCode, 'USAGE_LIMIT_EXCEEDED');
  const events = await f.db.transaction(c => c.query('SELECT tenant_id, metric, outcome FROM h8_usage_events'));
  assert.equal(events.length, 2); assert.ok(events.every(e => e.tenant_id === f.tenant.tenantId && e.metric === 'apiCalls' && e.outcome === 'denied'));
  await drainHostedServer(server);
});
