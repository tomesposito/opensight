import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { h8Fixture, serveH8 } from './h8-helpers.mjs';
import { organizationApi } from './organization-helpers.mjs';
import { HostedUsage, initializeUsage } from '@opensight/api/metadata';
import { initializeJobs } from '../dist/job-schema.js';
import { HostedDataRoutes } from '../dist/hosted-data-routes.js';
import { HostedData } from '../dist/hosted-data.js';
import { HostedSources } from '../dist/hosted-sources.js';
import { EmbedContent } from '../dist/embed-content.js';
import { JobStore } from '../dist/job-store.js';

const limits = { apiCalls: 1000, computeAttempts: 100, storageBytes: 100000, aiSpendCapCents: 100, aiCostCentsPerMillionTokens: 1_000_000 };
const first = { tenantId: 'tenant-default', namespaceId: 'default' };
const second = { tenantId: 'tenant-extra', namespaceId: 'tenant' };

test('admin test and generative HTTP routes share durable spend admission and authenticated tenant resolution', async t => {
  const f = await h8Fixture(t); await initializeUsage(f.db);
  await f.db.transaction(async c => {
    for (const scope of [first, second]) {
      await c.query("INSERT INTO h1_tenants (tenant_id,state,version,tombstone,placement,limit_policy) VALUES (?,'active',1,NULL,NULL,NULL)", [scope.tenantId]);
      await c.query('INSERT INTO h1_namespaces VALUES (?,?,?)', [scope.namespaceId, scope.tenantId, scope.namespaceId]);
    }
  });
  const config = { defaults: limits, tenants: {} }, usage = new HostedUsage(f.db, config);
  let calls = 0, bypassCalls = 0;
  const ai = { storePath: `${f.path}.ai.json`, encryptionKey: randomBytes(32).toString('base64'),
    // A caller-supplied optional meter cannot override hosted accounting.
    aiMeter: { check: async () => { bypassCalls++; }, record: async () => { bypassCalls++; } },
    fetcher: async (_url, init) => {
      calls++;
      const input = JSON.parse(init.body), text = input.max_output_tokens === 32 ? 'OK' : '{"question":"sum revenue by region"}';
      return Response.json({ output: [{ type: 'message', content: [{ type: 'output_text', text }] }], usage: { input_tokens: 30, output_tokens: 20 } });
    } };
  const { api } = await organizationApi(t, { ai, hostedUsage: usage });
  for (const user of ['default-admin', 'tenant-admin']) {
    assert.equal((await api('/api/admin/ai', 'POST', { provider: 'openai', model: 'test-model' }, user)).status, 200);
    assert.equal((await api('/api/admin/ai/key', 'POST', { key: randomBytes(20).toString('hex') }, user)).status, 200);
  }
  assert.equal((await api('/api/admin/ai/test', 'POST', {}, 'default-alice')).status, 403);
  assert.equal((await api('/api/o/generate', 'POST', { question: 'sum revenue', namespaceId: 'tenant' })).status, 400);
  assert.equal((await api('/api/namespaces/tenant/admin/ai/test', 'POST', {})).status, 404);
  assert.equal(calls, 0);
  assert.equal((await api('/api/admin/ai/test', 'POST', {})).status, 200);
  assert.equal((await api('/api/o/generate', 'POST', { question: 'sum revenue by region' })).status, 200);
  const snapshot = await usage.aiUsage(first);
  assert.equal(snapshot.aiCalls, 2); assert.equal(snapshot.aiTokens, 100);
  // Fresh API and usage instances must still deny both real-spend endpoints.
  const restarted = await organizationApi(t, { ai, hostedUsage: new HostedUsage(f.db, config) });
  for (const [path, body] of [['/api/admin/ai/test', {}], ['/api/o/generate', { question: 'sum revenue' }], ['/api/o/calculation', { question: 'profit margin' }]]) {
    const result = await restarted.api(path, 'POST', body);
    assert.equal(result.status, 429); assert.equal(result.body.errorCode, 'AI_SPEND_CAP_EXCEEDED');
    assert.match(result.body.Message, /tenant-default.*100.*100/);
    assert.match(result.body.Message, /operator.*aiSpendCapCents/);
  }
  assert.equal(calls, 2); assert.equal(bypassCalls, 0);
  assert.equal((await restarted.api('/api/admin/ai/test', 'POST', {}, 'tenant-admin')).status, 200);
  assert.equal(calls, 3); assert.equal((await usage.aiUsage(second)).aiCalls, 1);
});

test('hosted invocation composition receives the durable meter while unsupported AI routes remain closed', async t => {
  const f = await h8Fixture(t); await initializeUsage(f.db); await initializeJobs(f.db);
  const usage = new HostedUsage(f.db, { defaults: limits, tenants: {} });
  let meter;
  const { request } = await serveH8(t, f, { invocation: { usage, signal: new AbortController().signal,
    compose: (metadata, budgets, _auth, aiMeter) => {
      meter = aiMeter;
      const data = new HostedData(new HostedSources(metadata, f.env.OPENSIGHT_AUTH_ENCRYPTION_KEY), undefined, budgets);
      return { data: new HostedDataRoutes(data, new JobStore(f.db, metadata)), embedContent: new EmbedContent(data),
        capabilities: {}, allows: () => false, route: async () => false, finish: async () => {} };
    } } });
  assert.ok(meter);
  await meter.record('one', 100, false);
  await assert.rejects(meter.check('one'), { code: 'AI_SPEND_CAP_EXCEEDED', status: 429 });
  await meter.check('two');
  await assert.rejects(meter.check('unresolved'), { code: 'ENTITLEMENT_UNRESOLVED', status: 503 });
  for (const path of ['/api/admin/ai/test', '/api/o/generate']) {
    const response = await request(path, { method: 'POST', headers: { authorization: 'one' }, body: {} });
    assert.equal(response.status, 503); assert.equal(response.body.errorCode, 'SERVERLESS_STORAGE_REQUIRED');
  }
});
