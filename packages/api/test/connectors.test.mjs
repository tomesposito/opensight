import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { createApiServer, emptySecurityState, StubMailTransport } from '@opensight/api';
const root = fileURLToPath(new URL('../../../fixtures/', import.meta.url));
async function api(t, authenticated = true) {
  const state = emptySecurityState();
  state.namespaces.push({ id: 'other', name: 'Other' });
  state.users = [{ id: 'author', name: 'Author', namespaceId: 'default', role: 'author' }, { id: 'reader', name: 'Reader', namespaceId: 'default', role: 'reader' }, { id: 'other-author', name: 'Other author', namespaceId: 'default', role: 'author' }, { id: 'author', name: 'Author', namespaceId: 'other', role: 'author' }];
  const server = await createApiServer({ dataRoot: root, mailTransport: new StubMailTransport(), ...(authenticated ? { security: { initialState: state, authenticate: r => {
    const id = r.headers.authorization?.replace('Bearer ', '');
    return id === 'tenant-author' ? { namespaceId: 'other', userId: 'author' } : ['author', 'reader', 'other-author'].includes(id) ? { namespaceId: 'default', userId: id } : undefined;
  } } } : {}) });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.close(); server.closeAllConnections(); });
  return async (path, method = 'GET', body, user = authenticated ? 'author' : undefined) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method, headers: { 'Content-Type': 'application/json', ...(user ? { Authorization: `Bearer ${user}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() };
  };
}
const upload = { config: { format: 'csv' }, base64: Buffer.from('region,amount\nEast,2\nWest,3\n').toString('base64') };
test('connector API lists honest states and validates configs without making connections', async t => {
  const call = await api(t);
  const list = await call('/api/connectors'); assert.equal(list.status, 200); assert.equal(list.body.length, 23);
  assert.equal(list.body.find(c => c.id === 'mysql').availability.state, 'not_configured');
  assert.equal((await call('/api/connectors/github/connect', 'POST', { config: { endpointEnv: 'TEST_ENDPOINT', tokenEnv: 'TEST_TOKEN' } })).body.state, 'not_configured');
  assert.equal((await call('/api/connectors/github/connect', 'POST', { config: { endpointEnv: 'https://private.invalid', tokenEnv: 'secret' } })).body.errorCode, 'INVALID_CONNECTOR_CONFIG');
  assert.equal((await call('/api/connectors/missing/connect', 'POST', { config: {} })).body.errorCode, 'UNKNOWN_CONNECTOR');
  assert.equal((await call('/api/connectors?unknown=1')).status, 400);
  assert.equal((await call('/api/connectors', 'POST', {})).status, 405);
});
test('hosted upload persists to private DuckDB staging, reports rows/schema and blocks cross-user/tenant access', async t => {
  const call = await api(t), result = await call('/api/uploads', 'POST', upload);
  assert.equal(result.status, 201); assert.equal(result.body.rowCount, 2);
  assert.deepEqual(result.body.columns, [{ name: 'region', type: 'STRING' }, { name: 'amount', type: 'INTEGER' }]);
  const path = `/api/uploads/${result.body.id}`;
  assert.deepEqual((await call(path)).body.rows, [{ region: 'East', amount: 2 }, { region: 'West', amount: 3 }]);
  for (const user of ['other-author', 'tenant-author']) assert.equal((await call(path, 'GET', undefined, user)).body.errorCode, 'UPLOAD_NOT_FOUND');
  for (const endpoint of ['/api/connectors', path]) assert.equal((await call(endpoint, 'GET', undefined, 'reader')).status, 403);
  assert.equal((await call('/api/uploads', 'POST', upload, 'reader')).status, 403);
});
test('upload API rejects invalid schemas, forged identity, invalid base64 and oversized envelopes', async t => {
  const call = await api(t);
  for (const body of [{ ...upload, base64: '??' }, { ...upload, base64: 'Zh==' }, { ...upload, columns: [{ name: 'region', type: 'BOGUS' }] }, { ...upload, config: { format: 'csv', typo: 1 } }, { ...upload, namespaceId: 'other' }, { ...upload, userId: 'other-author' }, { ...upload, base64: Buffer.from('a,b\n1').toString('base64') }]) assert.equal((await call('/api/uploads', 'POST', body)).status, 400);
  assert.equal((await call('/api/uploads', 'POST', { ...upload, base64: 'a'.repeat(1024 * 1024) })).status, 413);
  assert.equal((await call('/api/uploads', 'POST', upload)).status, 201);
});
test('upload and connector APIs require hosted authentication', async t => {
  const call = await api(t, false);
  assert.equal((await call('/api/connectors')).body.errorCode, 'SECURITY_NOT_CONFIGURED');
  assert.equal((await call('/api/uploads', 'POST', upload)).body.errorCode, 'SECURITY_NOT_CONFIGURED');
});
