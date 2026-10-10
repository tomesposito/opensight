import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { once } from 'node:events';
import { createRuntime, runtimeMode } from '../dist/runtime.js';
import { createHostedApiServer, createBuiltinHostedServer } from '../dist/hosted-server.js';
import { h8Fixture } from './h8-helpers.mjs';
import { runtimeEnv, event, startupEvent, context, payload } from './runtime-helpers.mjs';
import { StubMailTransport } from '../dist/mail.js';
import { HostedAuth } from '../dist/hosted-auth.js';
import { hostedConfig } from '../dist/hosted-config.js';
import { drainHostedServer } from '../dist/hosted-server.js';
import { dispatchRuntimeRequest } from '../dist/runtime-http-bridge.js';
import { EmbedSessions } from '../dist/embed-sessions.js';

test('SR1 HTTP and Lambda share hosted routing, with clean per-request teardown and no interval work', async t => {
  const f = await h8Fixture(t), queries = []; let opened = 0, closed = 0;
  const db = { durable: true, close: async () => {}, transaction: work => f.db.transaction(c => work({ query(sql, values) { queries.push(sql); return c.query(sql, values); } })) };
  const deps = {
    databases(scope) { opened++; scope.own({ close: async () => { closed++; }, force() {} }); return { membership: db, tenant: db }; }, readiness: async () => {},
    application: (db, scope, env) => createHostedApiServer({ env, membershipDatabase: db.membership, tenantDatabase: db.tenant, invocation: { signal: scope.signal }, mailTransport: new StubMailTransport(), security: { authenticate: async req => req.headers.authorization === 'one' ? { namespaceId: 'one', userId: 'admin' } : undefined } }),
  };
  const env = { ...f.env, ...runtimeEnv() }, runtime = createRuntime(() => env, deps);
  const first = await runtime.lambda(event(), context);
  assert.equal(first.statusCode, 200); assert.equal(payload(first).tenantId, 'tenant-one'); assert.equal(opened, closed);
  assert.match(first.headers['content-type'], /application\/json/); assert.equal(first.headers['cache-control'], 'no-store');
  const second = event(); second.headers.authorization = 'unverified';
  assert.equal((await runtime.lambda(second, context)).statusCode, 401); assert.equal(opened, closed);
  assert.equal(payload(await runtime.lambda(event('/api/api/sources'), context)).errorCode, 'SERVERLESS_STORAGE_REQUIRED');
  assert.ok(!queries.some(sql => /^CREATE|^ALTER|^INSERT INTO h[26]_keys|UPDATE h7_occurrences SET state = 'queued'/.test(sql)), 'invocation composition must not migrate, activate keys or recover jobs');
  const local = createRuntime(() => ({ ...env, OPENSIGHT_RUNTIME: 'http' }), deps).http();
  local.listen(0, '127.0.0.1'); await once(local, 'listening');
  t.after(() => new Promise(resolve => local.close(resolve)));
  const result = await new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: local.address().port, path: '/api/session', headers: { host: 'opensight.example', authorization: 'one' } }, res => {
      const parts = []; res.on('data', c => parts.push(c)); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(parts)) }));
    }); req.on('error', reject); req.end();
  });
  assert.equal(result.status, first.statusCode); assert.deepEqual(result.body, payload(first)); assert.equal(opened, closed);
});

test('SR1 built-in composition refuses to initialize absent authentication keys', async t => {
  const f = await h8Fixture(t);
  await assert.rejects(createBuiltinHostedServer({ membershipDatabase: f.db, tenantDatabase: f.db, env: f.env, invocation: { signal: new AbortController().signal }, mailTransport: new StubMailTransport() }), { code: 'AUTH_KEY_REVOKED' });
  assert.deepEqual(await f.db.transaction(c => c.query('SELECT * FROM h2_keys')), []);
  // Existing local initialization remains available and explicit.
  await HostedAuth.create(f.db, hostedConfig(f.env));
  assert.equal((await f.db.transaction(c => c.query('SELECT * FROM h2_keys'))).length, 1);
});

test('SR1 mode selection and startup validation reject configuration and bodies before SQL', async () => {
  assert.equal(runtimeMode({}), 'http'); assert.equal(runtimeMode(runtimeEnv()), 'lambda');
  for (const env of [{ OPENSIGHT_RUNTIME: 'other' }, { OPENSIGHT_RUNTIME: 'lambda' }, { ...runtimeEnv(), OPENSIGHT_REFERENCE: 'single-node' }]) assert.throws(() => runtimeMode(env));
  let opened = 0;
  const runtime = createRuntime(runtimeEnv, { databases() { opened++; assert.fail('invalid request touched SQL'); } });
  for (const change of [e => { e.body = '{"tenantId":"one"}'; }, e => { e.body = 'null'; }, e => { e.body = '[]'; }, e => { e.body = ' '.repeat(1025); }, e => { e.headers.authorization = 'Bearer private'; }, e => { e.requestContext.http.method = 'GET'; }]) {
    const e = startupEvent(); change(e); assert.equal((await runtime.lambda(e, context)).statusCode, 400);
  }
  assert.equal(opened, 0);
});

test('SR1 in-memory HTTP response retains embed CSP/nonces and no-store across separate responses', async t => {
  const f = await h8Fixture(t);
  t.mock.method(EmbedSessions.prototype, 'shell', async () => ({ allowedDomains: ['https://parent.example'] }));
  const server = await createHostedApiServer({ membershipDatabase: f.db, tenantDatabase: f.db, env: f.env, security: { authenticate: async () => undefined }, mailTransport: new StubMailTransport() });
  t.after(() => drainHostedServer(server));
  const request = { method: 'GET', path: `/embed/sessions/${'a'.repeat(32)}`, headers: { host: 'opensight.example' }, body: Buffer.alloc(0), peer: '192.0.2.1', requestTime: Date.now() };
  const first = await dispatchRuntimeRequest(server, request, new AbortController().signal), second = await dispatchRuntimeRequest(server, request, new AbortController().signal);
  for (const result of [first, second]) {
    assert.equal(result.statusCode, 200); assert.equal(result.headers['cache-control'], 'no-store'); assert.equal(result.headers['referrer-policy'], 'no-referrer');
    assert.match(result.headers['content-type'], /text\/html/); assert.match(result.headers['content-security-policy'], /frame-ancestors https:\/\/parent.example/);
    const nonce = /nonce-([^']+)/.exec(result.headers['content-security-policy'])[1];
    assert.ok(Buffer.from(result.body, 'base64').toString().includes(`nonce="${nonce}"`));
  }
  assert.notEqual(first.headers['content-security-policy'], second.headers['content-security-policy']);
});

test('SR1 built-in Lambda auth receives canonical peer without starting timers or reactivating keys', async t => {
  const f = await h8Fixture(t), env = { ...f.env, ...runtimeEnv() };
  await HostedAuth.create(f.db, hostedConfig(f.env));
  let peer, closed = 0;
  t.mock.method(HostedAuth.prototype, 'login', async (_email, _password, _code, _tenant, value) => { peer = value; return { token: 'synthetic' }; });
  t.mock.method(globalThis, 'setInterval', () => assert.fail('invocation started an interval'));
  const runtime = createRuntime(() => env, { databases(scope) {
    scope.own({ close: async () => { closed++; }, force() {} }); return { membership: f.db, tenant: f.db };
  }, readiness: async () => {} });
  const e = event('/api/api/auth/login', 'POST', { email: 'synthetic@example.test', password: 'synthetic', code: '123456', tenantId: 'tenant-one' });
  delete e.headers.authorization; e.headers['cloudfront-viewer-address'] = '[::ffff:192.0.2.10]:1234';
  assert.equal((await runtime.lambda(e, context)).statusCode, 200); assert.equal(peer, '192.0.2.10'); assert.equal(closed, 1);
  await f.db.transaction(c => c.query('UPDATE h2_keys SET active = 0'));
  assert.equal((await runtime.lambda(e, context)).statusCode, 401); assert.equal(closed, 2);
  assert.equal((await f.db.transaction(c => c.query('SELECT active FROM h2_keys')))[0].active, 0);
});

test('SR1 local HTTP client abort cancels admitted work and closes owned resources', async t => {
  let entered, disposed;
  const ready = new Promise(resolve => { entered = resolve; }), closed = new Promise(resolve => { disposed = resolve; });
  const runtime = createRuntime(() => ({ ...runtimeEnv(), OPENSIGHT_RUNTIME: 'http' }), {
    databases(scope) { scope.own({ close: async () => disposed(), force() {} }); return {}; },
    readiness: (_db, scope) => new Promise((_, reject) => { scope.signal.addEventListener('abort', () => reject(Error('client disconnected')), { once: true }); entered(); }),
  });
  const server = runtime.http(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const req = request({ host: '127.0.0.1', port: server.address().port, path: '/api/session', headers: { host: 'opensight.example' } });
  req.on('error', () => {}); req.end(); await ready; req.destroy();
  await closed;
});
