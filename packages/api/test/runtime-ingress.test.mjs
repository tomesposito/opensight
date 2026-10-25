import test from 'node:test';
import assert from 'node:assert/strict';
import { adaptGatewayRequest, authorizeIngress, publicPath, viewerPeer, validateViewerRequest } from '../dist/runtime-ingress.js';
import { createRuntime } from '../dist/runtime.js';
import { runtimeEnv, event, context } from './runtime-helpers.mjs';

test('SR1 authoring and embed routing preserves authorization and trusted normalized viewer peer', () => {
  for (const path of ['/api/api/session', '/api/api/auth/login', '/api/api/auth/login/select', '/api/api/sources', '/api/api/uploads', '/api/api/datasets/example/prep', '/api/api/embedding/sessions', '/api/embed/sessions/id/status', '/embed/sessions/id']) {
    const e = event(path, ['/api/api/auth/login', '/api/api/auth/login/select', '/api/api/uploads', '/api/api/embedding/sessions'].includes(path) ? 'POST' : 'GET'), input = adaptGatewayRequest(e, runtimeEnv());
    assert.equal(input.path, path.startsWith('/api/api/') ? path.slice(4) : path);
    assert.equal(input.headers.authorization, 'one'); assert.equal(input.headers.host, 'opensight.example'); assert.equal(input.peer, '192.0.2.1');
    assert.equal(input.headers['x-forwarded-for'], undefined); assert.equal(input.headers['x-opensight-ingress-secret'], undefined);
    assert.equal(authorizeIngress(e, runtimeEnv()).isAuthorized, true);
  }
  for (const [value, expected] of [['[2001:0db8:0:0:0:0:0:1]:123', '2001:db8::1'], ['[::ffff:192.0.2.1]:123', '192.0.2.1'], ['[0:0:0:0:0:ffff:c000:201]:1', '192.0.2.1']]) assert.equal(viewerPeer(value), expected);
  for (const peer of [undefined, '', '192.0.2.1', '192.0.2.1:0', '192.0.2.1:65536', '[192.0.2.1]:10', '2001:db8::1:80', '[fe80::1%eth0]:80', '192.0.2.1:443,192.0.2.2:443']) assert.throws(() => viewerPeer(peer));
});

test('SR1 ingress rejects route, header, encoding and gateway bypasses without constructing SQL', async () => {
  let opened = 0;
  const runtime = createRuntime(runtimeEnv, { databases() { opened++; assert.fail('rejected ingress touched SQL'); } });
  const bad = [];
  for (const path of ['/api/host', '/api/api/host', '/api/api/host/drain', '/api/api/namespaces/test/host', '/api/api/namespaces/test/startup', '/api/api/namespaces/test/auth/login', '/api/api/embed/sessions/id/redeem', '/healthz', '/readyz', '/metrics', '/api/api/api/session', '/api/api/../host', '/api//api/session', '/api/api/%2fhost', '/api/api/%252fhost', '/api/api/%', '/api/api/\\host', '/api/api/session?x=1', '/api/api/session#fragment', '/unknown', '/api/api/auth/unknown']) bad.push(event(path));
  for (const [key, value] of [['host', 'opensight.example'], ['host', 'distribution.example.test'], ['origin', 'null'], ['origin', 'https://opensight.example/'], ['origin', 'https://other.example'], ['authorization', 'one,two'], ['Authorization', 'two'], ['content-type', 'application/json,text/plain'], ['idempotency-key', 'a,b'], ['if-match', '"a","b"'], ['forwarded', 'for=192.0.2.1'], ['x-forwarded-host', 'opensight.example'], ['x-tenant-id', 'other'], ['x-opensight-ingress-unknown', '1'], ['cloudfront-viewer-address', 'bad'], ['transfer-encoding', 'chunked'], ['content-length', '1'], ['x-forwarded-proto', 'http'], ['x-opensight-ingress-secret', 'wrong'], ['x-opensight-ingress-key-id', 'retired'], ['authorization', 'one\r\ninjected: true']]) {
    const e = event(); e.headers[key] = value; bad.push(e);
  }
  for (const key of ['apiId', 'stage', 'domainName', 'routeKey']) { const e = event(); e.requestContext[key] = 'wrong'; bad.push(e); }
  for (const mutate of [e => { delete e.requestContext.authorizer; }, e => { e.requestContext.authorizer.lambda.version = 'old'; }, e => { e.requestContext.timeEpoch = Date.now() + 99999; },
    e => { e.rawQueryString = 'secret=value'; }, e => { e.requestContext.http.method = 'TRACE'; }, e => { e.requestContext.http.path = '/api/api/auth/login'; },
    e => { e.body = 'body on GET'; }, e => { e.isBase64Encoded = true; e.body = 'not base64!'; }, e => { e.isBase64Encoded = 'false'; }, e => { e.multiValueHeaders = { authorization: ['one', 'two'] }; }]) {
    const e = event(); mutate(e); bad.push(e);
  }
  for (const e of bad) { const result = await runtime.lambda(e, context); assert.ok(result.statusCode >= 400); assert.equal(result.headers['cache-control'], 'no-store'); }
  assert.equal(opened, 0);
});

test('SR1 DB-free authorizer rotates a bounded pair of keys and fails closed on bad configuration', () => {
  const env = runtimeEnv(); const old = event(); old.headers['x-opensight-ingress-key-id'] = 'old'; old.headers['x-opensight-ingress-secret'] = 'o'.repeat(43);
  env.OPENSIGHT_INGRESS_KEYS = JSON.stringify([{ id: 'current', secret: 's'.repeat(43) }, { id: 'old', secret: 'o'.repeat(43) }]);
  assert.equal(authorizeIngress(old, env).isAuthorized, true);
  env.OPENSIGHT_INGRESS_KEYS = runtimeEnv().OPENSIGHT_INGRESS_KEYS;
  assert.deepEqual(authorizeIngress(old, env), { isAuthorized: false });
  for (const keys of ['', '[]', '{}', JSON.stringify(Array(3).fill({ id: 'x', secret: 's'.repeat(43) }))]) assert.deepEqual(authorizeIngress(event(), { ...env, OPENSIGHT_INGRESS_KEYS: keys }), { isAuthorized: false });
});

test('SR1 edge contract rejects caller forwarding/identity headers, duplicate singletons and distribution Host', () => {
  const viewer = () => ({ protocol: 'https', uri: '/api/api/session', querystring: {}, headers: { host: { value: 'opensight.example' }, authorization: { value: 'Bearer synthetic' } } });
  validateViewerRequest(viewer(), 'https://opensight.example');
  for (const name of ['forwarded', 'x-forwarded-for', 'x-forwarded-host', 'x-opensight-ingress-secret', 'cloudfront-viewer-address', 'x-user']) {
    const v = viewer(); v.headers[name] = { value: 'spoofed' }; assert.throws(() => validateViewerRequest(v, 'https://opensight.example'));
  }
  for (const change of [v => { v.headers.host.value = 'distribution.example.test'; }, v => { v.headers.authorization.multiValue = [{ value: 'one' }, { value: 'two' }]; }, v => { v.protocol = 'http'; }]) {
    const v = viewer(); change(v); assert.throws(() => validateViewerRequest(v, 'https://opensight.example'));
  }
  assert.throws(() => publicPath('/api/api/migrations'));
});

test('SR1 pre-DB method validation matches existing data and job routes', () => {
  for (const [path, methods] of [['/api/api/sources/id/rows', ['POST']], ['/api/api/sources/id/output', ['POST']], ['/api/api/sources/id/policy', ['GET']], ['/api/api/uploads/upload_id', ['GET']], ['/api/api/jobs/id/runs', ['GET', 'POST']], ['/api/api/auth/login', ['POST']], ['/api/api/auth/login/select', ['POST']]]) {
    for (const method of ['GET', 'POST', 'PUT', 'DELETE']) {
      if (methods.includes(method)) assert.equal(adaptGatewayRequest(event(path, method), runtimeEnv()).method, method);
      else assert.throws(() => adaptGatewayRequest(event(path, method), runtimeEnv()));
    }
  }
});

test('SR2d control JSON is bounded at 1 MiB before SQL, with a 2 MiB envelope ceiling', async () => {
  let opened = 0;
  const runtime = createRuntime(runtimeEnv, { databases() { opened++; assert.fail('oversize request touched SQL'); } });
  const e = event('/api/api/uploads/reservations', 'POST'); e.body = 'x'.repeat(1024 * 1024);
  assert.equal(adaptGatewayRequest(e, runtimeEnv()).body.length, 1024 * 1024);
  e.body += 'x'; assert.equal((await runtime.lambda(e, context)).statusCode, 413);
  e.isBase64Encoded = true; e.body = Buffer.alloc(1024 * 1024).toString('base64');
  assert.equal(adaptGatewayRequest(e, runtimeEnv()).body.length, 1024 * 1024);
  e.body = Buffer.alloc(1024 * 1024 + 1).toString('base64');
  assert.equal(JSON.parse((await runtime.lambda(e, context)).body).errorCode, 'CONTROL_PAYLOAD_TOO_LARGE');
  e.body = ''; e.unused = 'x'.repeat(2 * 1024 * 1024);
  assert.equal((await runtime.lambda(e, context)).statusCode, 413); assert.equal(opened, 0);
  for (const [path, methods] of [['/api/api/uploads/reservations', ['POST']], ['/api/api/uploads/reservations/id', ['GET', 'DELETE']],
    ['/api/api/uploads/reservations/id/complete', ['POST']], ['/api/api/operations/id', ['GET', 'DELETE']], ['/api/api/operations/id/result/0', ['GET']]]) {
    for (const method of ['GET', 'POST', 'PUT', 'DELETE']) {
      if (methods.includes(method)) assert.equal(adaptGatewayRequest(event(path, method), runtimeEnv()).method, method);
      else assert.throws(() => adaptGatewayRequest(event(path, method), runtimeEnv()));
    }
  }
});

test('SR4a edge-derived peers are opt-in, normalized, never forwarded to application headers and required before SQL', async () => {
  const env = { ...runtimeEnv(), OPENSIGHT_INGRESS_PEER: 'viewer-function' };
  for (const [peer, expected] of [['192.0.2.7', '192.0.2.7'], ['2001:0db8:0:0:0:0:0:7', '2001:db8::7'], ['::ffff:192.0.2.7', '192.0.2.7']]) {
    const e = event(); delete e.headers['cloudfront-viewer-address']; e.headers['x-opensight-ingress-peer'] = peer;
    assert.equal(authorizeIngress(e, env).isAuthorized, true); const adapted = adaptGatewayRequest(e, env); assert.equal(adapted.peer, expected); assert.equal(adapted.headers['x-opensight-ingress-peer'], undefined);
    assert.equal(authorizeIngress(e, runtimeEnv()).isAuthorized, false);
  }
  const runtime = createRuntime(() => env, { databases() { assert.fail('bad peer opened SQL'); } });
  for (const peer of [undefined, '', '192.0.2.1:443', '[2001:db8::1]', 'fe80::1%eth0', '192.0.2.1,192.0.2.2', ' 192.0.2.1', 'not-an-ip']) {
    const e = event(); if (peer !== undefined) e.headers['x-opensight-ingress-peer'] = peer;
    assert.equal(authorizeIngress(e, env).isAuthorized, false); assert.ok((await runtime.lambda(e, context)).statusCode >= 400);
  }
  for (const mode of ['', 'forwarded-for', 'anything']) assert.equal(authorizeIngress(event(), { ...runtimeEnv(), OPENSIGHT_INGRESS_PEER: mode }).isAuthorized, false);
});
test('SR4a separate startup route cannot authorize a different method/path or override the gateway context', () => {
  const env = { ...runtimeEnv(), OPENSIGHT_INGRESS_STARTUP_ROUTE: 'separate' };
  const startup = event('/api/api/startup', 'POST', {}); startup.routeKey = startup.requestContext.routeKey = 'POST /api/api/startup';
  assert.equal(authorizeIngress(startup, env).isAuthorized, true); assert.equal(adaptGatewayRequest(startup, env).path, '/api/startup');
  assert.equal(authorizeIngress(startup, runtimeEnv()).isAuthorized, false);
  assert.equal(authorizeIngress(event('/api/api/startup', 'POST', {}), env).isAuthorized, false);
  assert.equal(authorizeIngress(event(), env).isAuthorized, true);
  for (const mutation of [e => { e.requestContext.http.method = 'GET'; }, e => { e.rawPath = e.requestContext.http.path = '/api/api/session'; }, e => { e.requestContext.routeKey = '$default'; }, e => { e.routeKey = '$default'; }, e => { e.requestContext.http.path = '/api/api/session'; }]) {
    const e = structuredClone(startup); mutation(e); assert.equal(authorizeIngress(e, env).isAuthorized, false);
  }
  for (const mode of ['', '$default', 'anything']) assert.equal(authorizeIngress(startup, { ...env, OPENSIGHT_INGRESS_STARTUP_ROUTE: mode }).isAuthorized, false);
});
