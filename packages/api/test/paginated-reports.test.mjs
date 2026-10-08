import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { fileURLToPath } from 'node:url';
import { createApiServer, emptySecurityState, StubMailTransport } from '../dist/index.js';
import { definition, rows } from '../../reports/test/fixture.mjs';
import { createHostedApiServer } from '../dist/hosted-server.js';
import { authFixture } from './hosted-helpers.mjs';
const root = fileURLToPath(new URL('../../../fixtures/', import.meta.url));
const body = () => ({ definition: definition(), rowsByBand: rows(90) });
async function serve(t, secure = false) {
  const initialState = emptySecurityState();
  initialState.users = ['author', 'reader'].map(id => ({ id, name: id, namespaceId: 'default', role: id }));
  const server = await createApiServer({ dataRoot: root, mailTransport: new StubMailTransport(), ...(secure ? { security: { initialState, authenticate: r => {
    const id = r.headers.authorization?.slice(7); return ['author', 'reader'].includes(id) ? { namespaceId: 'default', userId: id } : undefined;
  } } } : {}) });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.close(); server.closeAllConnections(); });
  return (value = body(), path = '/api/reports/synthetic/pdf', options = {}) => fetch(`http://127.0.0.1:${server.address().port}${path}`, {
    method: 'POST', ...options, headers: { 'Content-Type': 'application/json', ...options.headers }, ...(value === undefined ? {} : { body: JSON.stringify(value) }),
  });
}
test('stateless PDF endpoint returns a real multipage attachment from supplied rows', async t => {
  const request = await serve(t), response = await request(); assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/pdf'); assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('content-disposition'), 'attachment; filename="synthetic.pdf"');
  const text = Buffer.from(await response.arrayBuffer()).toString('latin1'); assert.ok(text.startsWith('%PDF'));
  assert.equal([...text.matchAll(/\/Type \/Page\b/g)].length, 4);
  assert.equal((await request(body(), '/reports/synthetic/pdf')).status, 200);
});
test('PDF endpoint rejects invalid definitions, missing rows, unknown bands, overflow and identity claims', async t => {
  const request = await serve(t);
  for (const [mutate, code] of [
    [b => b.definition.pageSetup.size = 'A3', 'REPORT_INVALID_DEFINITION'],
    [b => delete b.rowsByBand.sales, 'REPORT_INVALID_ROWS'],
    [b => b.definition.body[0].kind = 'chart', 'REPORT_UNSUPPORTED_BAND'],
    [b => b.rowsByBand.sales = [{ region: 'x\n'.repeat(100), amount: 1 }], 'REPORT_ROW_OVERFLOW'],
    [b => b.definition.id = 'different', 'REPORT_INVALID_DEFINITION'],
    [b => b.principal = 'admin', 'REPORT_INVALID_DEFINITION'],
  ]) {
    const b = body(); mutate(b); const r = await request(b); assert.equal(r.status, 422); assert.equal((await r.json()).errorCode, code);
  }
  assert.equal((await request(body(), '/api/reports/synthetic/pdf?query=true')).status, 400);
  assert.equal((await request(body(), '/api/reports/synthetic/pdf', { method: 'PUT' })).status, 405);
  assert.equal((await request(body(), '/api/reports/%22bad/pdf')).status, 422);
});
test('authenticated report renderer requires build capability and rejects bypass headers and cross-namespace paths', async t => {
  const request = await serve(t, true);
  assert.equal((await request()).status, 401);
  assert.equal((await request(body(), undefined, { headers: { authorization: 'Bearer reader' } })).status, 403);
  assert.equal((await request(body(), undefined, { headers: { authorization: 'Bearer author' } })).status, 200);
  assert.equal((await request(body(), undefined, { headers: { authorization: 'Bearer author', 'x-role': 'admin' } })).status, 403);
  assert.equal((await request(body(), '/api/namespaces/foreign/reports/synthetic/pdf', { headers: { authorization: 'Bearer author' } })).status, 404);
});
test('hosted report PDF uses the normal verified session and origin boundary', async t => {
  const f = await authFixture(t), c = f.config;
  const env = { OPENSIGHT_PUBLIC_ORIGIN: c.origin, OPENSIGHT_AUTH_ISSUER: c.issuer, OPENSIGHT_AUTH_AUDIENCE: c.audience,
    OPENSIGHT_AUTH_KEY_ID: c.keyId, OPENSIGHT_AUTH_SIGNING_KEY: c.signingKey.toString('base64'), OPENSIGHT_AUTH_ENCRYPTION_KEY: c.encryptionKey.toString('base64'),
    OPENSIGHT_OPERATOR_KEY: c.operatorKey.toString('base64'), OPENSIGHT_SESSION_SECONDS: String(c.sessionSeconds), OPENSIGHT_INVITATION_SECONDS: String(c.invitationSeconds) };
  const server = await createHostedApiServer({ membershipDatabase: f.db, tenantDatabase: f.db, security: { authenticate: f.auth.authenticate }, builtinAuth: f.auth, mailTransport: f.mail, env });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const request = headers => new Promise((resolve, reject) => {
    const bytes = JSON.stringify(body());
    const req = httpRequest({ host: '127.0.0.1', port: server.address().port, path: '/api/reports/synthetic/pdf', method: 'POST', headers: { Host: new URL(c.origin).host, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bytes), ...headers } }, res => {
      const chunks = []; res.on('data', b => chunks.push(b)); res.on('end', () => resolve({ status: res.statusCode, text: () => Buffer.concat(chunks).toString() }));
    }); req.on('error', reject); req.end(bytes);
  });
  assert.equal((await request({})).status, 401);
  const session = await f.login(), headers = { authorization: `Bearer ${session.token}` };
  const exported = await request(headers); assert.equal(exported.status, 200); assert.ok((await exported.text()).startsWith('%PDF'));
  const forged = await request({ ...headers, 'x-tenant': 'forged' }); assert.equal(forged.status, 403);
  assert.equal((await request({ ...headers, origin: 'https://foreign.example' })).status, 403);
});
