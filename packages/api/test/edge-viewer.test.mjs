import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { edgeSource } from '../../../ops/serverless/build-edge.mjs';
import { validateViewerRequest } from '../dist/runtime-ingress.js';
const origin = 'https://opensight.example', host = 'opensight.example';
const source = await readFile(new URL('../../../ops/serverless/edge-viewer.js', import.meta.url), 'utf8');
const context = vm.createContext({});
// Deliberately no Node objects, URL, Buffer or modern Object.hasOwn/Set in this VM.
vm.runInContext('Object.hasOwn = undefined; Set = undefined;', context);
vm.runInContext(source.replaceAll('__OPENSIGHT_ORIGIN__', JSON.stringify(origin)).replaceAll('__OPENSIGHT_HOST__', JSON.stringify(host)), context);
const frame = () => ({ viewer: { ip: '2001:db8::7' }, request: { method: 'GET', uri: '/api/api/session', querystring: {}, headers: { host: { value: host } } } });
test('SR4a generated edge boundary is current, within CloudFront size limit and injects only the platform viewer peer', async () => {
  assert.equal(source, await edgeSource()); assert.ok(Buffer.byteLength(source) < 10000);
  const event = frame(), output = context.handler(event); assert.equal(output.uri, event.request.uri); assert.equal(output.headers['x-opensight-ingress-peer'].value, event.viewer.ip);
  assert.equal(output.headers['x-opensight-ingress-secret'], undefined);
  const live = frame();
  Object.defineProperty(live.request, 'unrelatedNativeField', { enumerable: true, get() { throw Error('Unrelated event fields must not be copied'); } });
  assert.equal(context.handler(live).headers['x-opensight-ingress-peer'].value, live.viewer.ip);
});
test('SR4a edge executes shared path/header rejection without Node APIs and cannot accept forged provenance', () => {
  const bad = [];
  for (const name of ['x-user', 'x-role', 'x-tenant-id', 'x-opensight-ingress-peer', 'x-opensight-ingress-secret', 'x-forwarded-for', 'x-forwarded-host', 'forwarded', 'cloudfront-viewer-address']) {
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
  for (const [value, accept] of [['ascii', true], ['é'.repeat(3000), true], ['é'.repeat(9000), false]]) {
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
