import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, request, prepared, input } from './embed-full-app-helpers.mjs';
import { adaptGatewayRequest } from '../dist/runtime-ingress.js';
import { event, runtimeEnv } from './runtime-helpers.mjs';
test('full-app HTTP navigates with one redeem and rejects routes, foreign assets and credentials', async t => {
  const f = await fixture(t);
  const active = await f.open();
  for (const path of ['/data', '/analyses/author', '/data/preparation', '/dashboards/dashboard', '/home', '/analyses/new']) {
    const result = await active.app('/route', 'POST', { path }); assert.equal(result.status, 200, JSON.stringify(result.body));
  }
  assert.equal((await active.app('/session')).body.id, f.identity.userId);
  assert.equal((await active.app('/api/prep-datasets')).status, 200);
  for (const path of ['/admin/users', '/account/connections', '/notebooks', '/data?tenant=other', '/analyses/author/missing']) {
    const result = await active.app('/route', 'POST', { path }); assert.ok(result.status >= 400, JSON.stringify(result.body));
  }
  for (const path of ['/api/users', '/api/admin/ai', '/api/embedding/config', '/api/session', '/api/namespaces/foreign/datasets', '/api/v1/dashboards/dashboard/shares/user/foreign']) {
    assert.equal((await active.app(path)).body.errorCode, 'EMBED_SCOPE_DENIED');
  }
  assert.equal((await active.app('/api/v1/analyses/missing')).body.errorCode, 'RESOURCE_NOT_FOUND');
  assert.equal((await active.app('/api/datasets/foreign/prep')).body.errorCode, 'RESOURCE_NOT_FOUND');
  assert.equal((await f.call(`${active.root}/app/session`, 'GET', undefined, 'Embed ' + 'x'.repeat(43))).body.errorCode, 'INVALID_EMBED_TOKEN');
  const other = await f.open();
  assert.equal((await f.call(`${active.root}/app/session`, 'GET', undefined, other.auth)).body.errorCode, 'INVALID_EMBED_TOKEN');
  assert.equal((await f.call('/api/session', 'GET', undefined, active.auth)).status, 401);
  assert.equal((await f.call(`${active.root}/content`, 'GET', undefined, active.auth)).body.errorCode, 'EMBED_SCOPE_DENIED');
});

test('full-app HTTP rechecks feature and role authority on navigation and direct operation bypasses', async t => {
  const f = await fixture(t), reader = await f.open('/data', { UserArn: f.arn('user', f.reader.identity.userId) });
  assert.equal((await reader.app('/route', 'POST', { path: '/analyses/author' })).body.errorCode, 'EMBED_AUTHOR_REQUIRED');
  assert.equal((await reader.app('/api/v1/analyses', 'POST', {})).body.errorCode, 'EMBED_AUTHOR_REQUIRED');
  const config = await f.embedding.get(await f.context());
  await f.embedding.put(await f.context(), { ...config.config, features: { ...config.config.features, authoring: false, registeredDashboards: false } }, config.revision);
  const limited = await f.open();
  for (const path of ['/analyses/author', '/data/preparation', '/dashboards/dashboard']) assert.equal((await limited.app('/route', 'POST', { path })).body.errorCode, 'EMBED_FEATURE_UNSUPPORTED');
  assert.equal((await limited.app('/api/v1/analyses', 'POST', {})).body.errorCode, 'EMBED_FEATURE_UNSUPPORTED');
  assert.equal((await limited.app('/api/v1/dashboards')).body.errorCode, 'EMBED_FEATURE_UNSUPPORTED');
});

test('full-app Ask O fails closed when no provider is configured at issuance or navigation', async t => {
  const f = await fixture(t), active = await f.open();
  const issued = await f.call('/api/embedding/sessions', 'POST', request('/ask-o'), `Bearer ${(await f.login()).token}`);
  assert.equal(issued.body.errorCode, 'AI_NOT_CONFIGURED');
  assert.equal((await active.app('/route', 'POST', { path: '/ask-o' })).body.errorCode, 'AI_NOT_CONFIGURED');
  assert.equal((await active.app('/api/o/generate', 'POST', { question: 'total amount' })).body.errorCode, 'AI_NOT_CONFIGURED');
});

test('full-app runtime ingress permits only the bridge method allowlist', () => {
  const base = `/api/embed/sessions/${'s'.repeat(32)}/app`;
  for (const [path, method] of [['/route', 'POST'], ['/session', 'GET'], ['/analysis/id', 'GET'], ['/api/v1/analyses/id', 'PUT'], ['/api/datasets/id/query', 'POST']]) {
    const input = event(base + path, method, method === 'GET' ? undefined : {}); input.headers.authorization = 'Embed synthetic';
    assert.equal(adaptGatewayRequest(input, runtimeEnv()).path, base + path);
  }
  for (const [path, method] of [['/session', 'POST'], ['/route', 'GET'], ['/api/users', 'GET'], ['/api/auth/login', 'POST'], ['/api/v1/analyses/id', 'DELETE'], ['/api/../users', 'GET']]) {
    assert.throws(() => adaptGatewayRequest(event(base + path, method), runtimeEnv()));
  }
});
