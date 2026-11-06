import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { edgeSource } from '../../../ops/serverless/build-edge.mjs';
import { validateViewerRequest } from '../dist/runtime-ingress.js';
import { serverlessV1Methods } from '../dist/v1-route-contract.js';
const origin = 'https://opensight.example', host = 'opensight.example';
const source = await readFile(new URL('../../../ops/serverless/edge-viewer.js', import.meta.url), 'utf8');
const context = vm.createContext({ Buffer: { byteLength: Buffer.byteLength } });
// Only CloudFront runtime 2.0's documented Buffer.byteLength is exposed.
// No other Node APIs, URL or modern Object.hasOwn/Set are available.
vm.runInContext('Object.hasOwn = undefined; Set = undefined;', context);
vm.runInContext(source.replaceAll('__OPENSIGHT_ORIGIN__', JSON.stringify(origin)).replaceAll('__OPENSIGHT_HOST__', JSON.stringify(host)), context);
const frame = () => ({ viewer: { ip: '2001:db8::7' }, request: { method: 'GET', uri: '/api/api/session', querystring: {}, headers: { host: { value: host } } } });
test('Issue #176: generated edge admits marketing capture and preflight without opening neighboring routes', () => {
  for (const method of ['POST', 'OPTIONS']) {
    const e = frame(); e.request.method = method; e.request.uri = '/api/access-requests';
    e.request.headers.origin = { value: 'https://getopensight.org' };
    assert.equal(context.handler(e).uri, '/api/access-requests');
  }
  for (const uri of ['/api/access-requests/', '/api/api/namespaces/one/access-requests', '/api/api/session', '/api/api/host/access-requests']) {
    const e = frame(); e.request.uri = uri; e.request.headers.origin = { value: 'https://getopensight.org' };
    assert.equal(context.handler(e).statusCode, 403);
  }
});
test('SR4a generated edge boundary is current, within CloudFront size limit and injects only the platform viewer peer', async () => {
  assert.equal(source, await edgeSource()); assert.ok(Buffer.byteLength(source) < 10000);
  const event = frame(), output = context.handler(event); assert.equal(output.uri, event.request.uri); assert.equal(output.headers['x-opensight-ingress-peer'].value, event.viewer.ip);
  assert.equal(output.headers['x-opensight-ingress-secret'], undefined);
  const live = frame();
  Object.defineProperty(live.request, 'unrelatedNativeField', { enumerable: true, get() { throw Error('Unrelated event fields must not be copied'); } });
  assert.equal(context.handler(live).headers['x-opensight-ingress-peer'].value, live.viewer.ip);
});
test('D-86 folded edge grammar matches shared routes without per-request regex construction', () => {
  assert.ok(!source.includes('new RegExp'));
  for (const id of ['a', 'a-b_c', 'x'.repeat(512), 'x'.repeat(513), '', '%2f', '.', 'a/b']) {
    for (const suffix of ['', '/publish', '/calculated-fields', '/filter-groups', '/filter-groups/f', '/sheets/s/layouts', '/sheets/s/visuals', '/sheets/s/visuals/v', '/shares/user/u', '/versions', '/versions/1', '/versions/0', '/versions/1/visuals/v/query', '/exports', '/export', '/metrics', '/question', '/unknown']) {
      for (const kind of ['analyses', 'dashboards', 'datasets', 'metrics']) {
        const path = `/api/v1/${kind}/${id}${suffix}`;
        assert.equal(JSON.stringify(context.serverlessV1Methods(path)), JSON.stringify(serverlessV1Methods(path)), path);
      }
    }
  }
  for (const path of ['/api/v1/analyses', '/api/v1/dashboards', '/api/v1/metrics', '/api/v1/metric-datasets', '/api/uploads/reservations/a/complete', '/api/session'])
    assert.equal(JSON.stringify(context.serverlessV1Methods(path)), JSON.stringify(serverlessV1Methods(path)), path);
});
test('edge rejects unsupported paths before reading a large header map', () => {
  const e = frame(); e.request.uri = '/api/api/v1/datasets';
  Object.defineProperty(e.request.headers, 'authorization', { enumerable: true, get() { throw Error('Unsupported route scanned headers'); } });
  // Call the validator directly so a header read cannot be hidden by handler's
  // uniform denial response; the path error must win before accessing headers.
  assert.throws(() => context.validateViewerRequest({ ...e.request, protocol: 'https' }, origin), error => error.code === 'RESOURCE_NOT_FOUND');
});
test('SR4a edge executes shared path/header rejection without Node APIs and cannot accept forged provenance', () => {
  const bad = [];
  for (const name of ['x-user', 'x-role', 'x-tenant-id', 'x-opensight-ingress-peer', 'x-opensight-ingress-secret', 'x-forwarded-for', 'x-forwarded-host', 'forwarded']) {
    const e = frame(); e.request.headers[name] = { value: 'forged' }; bad.push(e);
  }
  for (const path of ['/api/api/host', '/api/api/../session', '/api/api/%73ession', '/api//api/session', '/api/api/namespaces/n/startup', '/api/api/session?token=anything', '/api/api/auth/unknown', '/index.html']) { const e = frame(); e.request.uri = path; bad.push(e); }
  for (const mutate of [e => { e.request.headers.host.value = 'distribution.example.test'; }, e => { e.request.headers.origin = { value: 'https://evil.example' }; }, e => { e.request.headers.authorization = { value: 'one,two' }; }, e => { e.request.querystring.token = { value: 'secret' }; }, e => { e.request.headers.host.multiValue = [{ value: host }, { value: host }]; }]) { const e = frame(); mutate(e); bad.push(e); }
  for (const event of bad) {
    assert.throws(() => validateViewerRequest({ ...event.request, protocol: 'https' }, origin));
    const result = context.handler(event); assert.equal(result.statusCode, 403); assert.equal(result.headers['cache-control'].value, 'no-store');
    assert.ok(!JSON.stringify(result).includes('forged'));
  }
  for (const path of ['/api/api/startup', '/api/api/uploads/reservations', '/api/api/operations/id/result/0', '/api/embed/sessions/id/status', '/embed/sessions/id']) {
    const e = frame(); e.request.uri = path; assert.equal(context.handler(e).uri, path);
  }
});
test('SR4a larger header sets preserve UTF-8 byte ceilings, duplicate rejection and late principal denial', () => {
  const base = frame();
  for (let i = 0; i < 30; i++) base.request.headers[`x-synthetic-${i}`] = { value: 'v'.repeat(36) };
  base.request.headers.constructor = { value: 'ordinary-header' };
  for (const [value, accept] of [['ascii', true], ['é'.repeat(3000), true], ['é'.repeat(9000), false], ['😀'.repeat(2000), true], ['😀'.repeat(5000), false]]) {
    const e = structuredClone(base); e.request.headers['x-text'] = { value };
    if (accept) {
      validateViewerRequest({ ...e.request, protocol: 'https' }, origin);
      assert.equal(context.handler(e).uri, e.request.uri);
    } else {
      assert.throws(() => validateViewerRequest({ ...e.request, protocol: 'https' }, origin));
      assert.equal(context.handler(e).statusCode, 403);
    }
  }
  for (const [name, value] of [['Host', host], ['x-tenant-id', 'forged']]) {
    const e = structuredClone(base); e.request.headers[name] = { value };
    assert.throws(() => validateViewerRequest({ ...e.request, protocol: 'https' }, origin));
    assert.equal(context.handler(e).statusCode, 403);
  }
});

test('SR4a edge discards nonauthoritative viewer-address metadata before deriving its own peer', () => {
  for (const field of [{ value: '198.51.100.199:54321' }, { value: 'malformed,forged' }, { value: 'ignored', multiValue: [{ value: 'forged' }, { value: 'also-forged' }] }]) {
    const e = frame(); e.request.headers['cloudfront-viewer-address'] = field;
    // The generic viewer boundary still denies this field. Only selected edge
    // packaging discards it, independent of its claimed address or provenance.
    assert.throws(() => validateViewerRequest({ ...e.request, protocol: 'https' }, origin));
    const result = context.handler(e);
    assert.equal(result.headers['x-opensight-ingress-peer'].value, e.viewer.ip);
    assert.equal(result.headers['cloudfront-viewer-address'], undefined);
  }
});


test('Issue #146: edge and packaged edge admit workspace selection with login boundary parity', async () => {
  assert.equal(await readFile(new URL('../../../ops/serverless/modules/edge/edge-viewer.js', import.meta.url), 'utf8'), source);
  for (const path of ['/api/api/auth/login', '/api/api/auth/login/select']) {
    const e = frame(); e.request.uri = path; e.request.method = 'POST'; delete e.request.headers.authorization;
    assert.equal(context.handler(e).uri, path);
  }
  for (const path of ['/api/api/auth/login/select/extra', '/api/api/namespaces/foreign/auth/login/select']) {
    const e = frame(); e.request.uri = path; e.request.method = 'POST';
    assert.equal(context.handler(e).statusCode, 403);
  }
});

test('issue 162 edge admits subscription and one-click unsubscribe routes without opening token neighbors', () => {
  for (const path of ['/api/v1/metrics/revenue/subscriptions', '/api/v1/metric-subscriptions/sub/preview', `/api/v1/metric-unsubscribe/tenant/namespace/sub/${'a'.repeat(64)}`]) {
    const event = frame(); event.request.uri = `/api${path}`;
    assert.equal(context.handler(event).uri, `/api${path}`);
  }
  for (const token of ['guess', 'a'.repeat(63), 'a'.repeat(65)]) {
    const event = frame(); event.request.uri = `/api/api/v1/metric-unsubscribe/tenant/namespace/sub/${token}`;
    assert.equal(context.handler(event).statusCode, 403);
  }
});

test('#196 generated and packaged edge admit plan/revise without opening neighboring paths', async () => {
  assert.equal(source, await readFile(new URL('../../../ops/serverless/modules/edge/edge-viewer.js', import.meta.url), 'utf8'));
  for (const scope of ['/api/api/o/', '/api/api/namespaces/one/o/']) for (const action of ['plan', 'revise']) {
    const e = frame(); e.request.method = 'POST'; e.request.uri = scope + action;
    assert.equal(context.handler(e).uri, e.request.uri);
    e.request.uri += '/unknown'; assert.equal(context.handler(e).statusCode, 403);
  }
});
