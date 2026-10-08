import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { createApiServer, emptySecurityState, StubMailTransport } from '../dist/index.js';
import { definition, rows } from '../../reports/test/fixture.mjs';
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
