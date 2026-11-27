import test from 'node:test';
import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
import { fixture, request } from './embed-full-app-helpers.mjs';
import { HostedAISettings } from '../dist/hosted-ai-settings.js';
import { dispatchRuntimeRequest } from '../dist/runtime-http-bridge.js';
import { adaptGatewayRequest } from '../dist/runtime-ingress.js';
import { event, runtimeEnv } from './runtime-helpers.mjs';

test('full-app denied assets stay denied to authors through route and direct definition bypasses', async t => {
  const f = await fixture(t), c = await f.context();
  const reader = await f.metadata.get(c, { kind: 'user', id: f.reader.identity.userId });
  await f.metadata.put(c, { kind: 'user', id: reader.id }, { ...reader.body, role: 'author' }, reader.version);
  const asset = await f.metadata.get(await f.context(), { kind: 'analysis', id: 'analysis' });
  await f.metadata.put(await f.context(), { kind: 'analysis', id: asset.id }, { ...asset.body, grants: [{ principal: { type: 'user', id: f.identity.userId }, role: 'co-owner' }] }, asset.version);
  const author = await f.open('/data', { UserArn: f.arn('user', reader.id) });
  for (const path of ['/analysis/analysis', '/api/v1/analyses/analysis']) assert.equal((await author.app(path)).body.errorCode, 'RESOURCE_NOT_FOUND');
  assert.equal((await author.app('/route', 'POST', { path: '/analyses/author/analysis' })).body.errorCode, 'RESOURCE_NOT_FOUND');
  assert.equal((await author.app('/api/v1/analyses/analysis', 'PUT', {}, { 'if-match': '"2"' })).body.errorCode, 'RESOURCE_NOT_FOUND');
  const fixed = await f.issue({ ExperienceConfiguration: { QuickSightConsole: {} } }), credential = await f.redeem(fixed);
  assert.equal((await f.call(`/api/embed/sessions/${fixed.sessionId}/app/session`, 'GET', undefined, `Embed ${credential.credential}`)).body.errorCode, 'EMBED_SCOPE_DENIED');
});

test('full-app published queries preserve source and dataset RLS intersection and CLS denial', async t => {
  const f = await fixture(t);
  await f.metadata.put(await f.context(), { kind: 'policy', id: 'dataset-policy' }, { datasetId: 'dataset', dataSetArn: 'urn:opensight:dataset', rowLevel: true,
    rowRules: [{ id: 'east', principals: [{ type: 'user', id: f.identity.userId }], predicate: { column: 'region', operator: 'eq', value: 'east' } }], protectedColumns: ['private'], columnGrants: [] });
  const published = await f.call('/api/v1/analyses/analysis/publish', 'POST', {}, `Bearer ${(await f.login()).token}`);
  assert.equal(published.status, 201, JSON.stringify(published.body));
  const id = published.body.DashboardId, active = await f.open(`/dashboards/${id}`);
  const rows = await active.app(`/api/v1/dashboards/${id}/versions/1/visuals/total/query`, 'POST', { controlValues: {} });
  assert.equal(rows.status, 200, JSON.stringify(rows.body)); assert.deepEqual(rows.body.rows, [{ amount: 40 }]);
  const analysis = await active.app('/analysis/analysis');
  assert.equal(analysis.status, 200, JSON.stringify(analysis.body));
  assert.equal(analysis.body.schemas.data.columns.some(c => c.name === 'private'), false);
  const definition = structuredClone(analysis.body.definition);
  definition.sheets[0].visuals[0].kpiVisual.chartConfiguration.fieldWells.values[0].numericalMeasureField.column.columnName = 'private';
  const denied = await active.app('/api/v1/analyses/analysis', 'PUT', { name: 'Denied column', definition, datasetBindings: analysis.body.datasetBindings }, { 'if-match': `"${analysis.body.version}"` });
  assert.equal(denied.body.errorCode, 'COLUMN_ACCESS_DENIED');
});

test('full-app Ask O configured landing rechecks configuration without any provider calls', async t => {
  const f = await fixture(t);
  const settings = new HostedAISettings(f.metadata, f.hostedConfig.encryptionKey.toString('base64'), {});
  await settings.save(await f.context(), { provider: 'openai', model: 'synthetic-model' });
  await settings.saveKey(await f.context(), { key: 'synthetic-test-only-not-a-credential' });
  const active = await f.open('/ask-o');
  assert.equal((await active.app('/route', 'POST', { path: '/ask-o' })).status, 200);
  assert.equal((await active.app('/api/o/status')).body.configured, true);
  await settings.save(await f.context(), { mode: 'off' });
  assert.equal((await active.app('/route', 'POST', { path: '/ask-o' })).body.errorCode, 'EMBED_SESSION_REVOKED');
});

test('full-app shell loads the real app with nonce CSP and fits the gateway envelope using gzip', async t => {
  const f = await fixture(t), issued = await f.issue(request('/data'));
  const response = await dispatchRuntimeRequest(f.server, { method: 'GET', path: new URL(issued.EmbedUrl).pathname,
    headers: { host: new URL(f.hostedConfig.origin).host, 'accept-encoding': 'gzip, deflate, br' }, body: Buffer.alloc(0), peer: '127.0.0.1', requestTime: Date.now() }, new AbortController().signal);
  assert.equal(response.statusCode, 200); assert.equal(response.headers['content-encoding'], 'gzip');
  assert.ok(Buffer.byteLength(JSON.stringify(response)) < 2 * 1024 * 1024);
  const html = gunzipSync(Buffer.from(response.body, 'base64')).toString();
  assert.match(html, /Save analysis/); assert.match(html, /fullApp/); assert.match(html, /"landingRoute":"\/data"/);
  assert.match(response.headers['content-security-policy'], /frame-ancestors https:\/\/product.example/);
  assert.ok(!html.includes(new URL(issued.EmbedUrl).hash.slice(11))); assert.equal(response.cookies, undefined);
  const input = event(new URL(issued.EmbedUrl).pathname, 'GET'); input.headers['accept-encoding'] = 'gzip, br';
  assert.equal(adaptGatewayRequest(input, runtimeEnv()).headers['accept-encoding'], 'gzip, br');
});
