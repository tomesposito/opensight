import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { createApiServer } from '@opensight/api';

test('first-run fixture server never turns demo choices or forged credentials into a session', async t => {
  const server = await createApiServer({ dataRoot: fileURLToPath(new URL('../../../fixtures/', import.meta.url)) });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.close(); server.closeAllConnections(); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  for (const [path, headers] of [
    ['/api/session', {}],
    ['/api/session?demo=true', {}],
    ['/api/session?dev=true&userId=admin', {}],
    ['/api/session', { Authorization: 'Bearer public-sample' }],
    ['/api/session', { 'x-user-id': 'sample', 'x-role': 'administrator', 'x-namespace-id': 'sample' }],
    ['/api/session', { Cookie: 'demo=true; session=sample' }],
  ]) {
    const response = await fetch(origin + path, { headers });
    const forgedIdentity = 'x-user-id' in headers;
    assert.equal(response.status, forgedIdentity ? 403 : 503);
    assert.equal((await response.json()).errorCode, forgedIdentity ? 'FORGED_PRINCIPAL' : 'SECURITY_NOT_CONFIGURED');
    assert.equal(response.headers.get('set-cookie'), null);
    assert.match(response.headers.get('cache-control'), /no-store/);
  }
});
