import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createApiServer, emptySecurityState, StubMailTransport } from '@opensight/api';

const fixtures = fileURLToPath(new URL('../../../fixtures/', import.meta.url));
export const query = { dimensions: [{ fieldId: 'region', columnName: 'region' }], measures: [{ fieldId: 'total', columnName: 'revenue', aggregation: 'SUM' }], filters: [] };
export async function secureApi(t, options = {}) {
  const initialState = emptySecurityState();
  initialState.users = ['admin', 'alice', 'bob'].map(id => ({ id, name: id, namespaceId: 'default', role: id === 'admin' ? 'admin' : 'reader' }));
  initialState.groups = [{ id: 'east', name: 'East', namespaceId: 'default', userIds: ['alice'] }];
  const server = await createApiServer({ dataRoot: fixtures, mailTransport: new StubMailTransport(), security: { initialState, authenticate: request => {
    const token = request.headers.authorization;
    return ['admin', 'alice', 'bob'].some(id => token === `Bearer test-${id}`) ? { namespaceId: 'default', userId: token.slice(12) } : undefined;
  }, ...options } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.close(); server.closeAllConnections(); });
  return async (path, method = 'GET', body, user = 'admin', headers = {}) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method, headers: { 'Content-Type': 'application/json', ...(user ? { Authorization: `Bearer test-${user}` } : {}), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() };
  };
}
export const rowRule = { principals: [{ type: 'group', id: 'east' }], predicate: { column: 'region', operator: 'eq', value: 'East' } };
test('RLS resource CRUD enforces authenticated user/group rules and retains protection after deletion', async t => {
  const api = await secureApi(t), path = '/api/datasets/sales/row-rules/east';
  assert.equal((await api(path, 'PUT', rowRule)).status, 200);
  assert.deepEqual((await api(path)).body, { id: 'east', ...rowRule });
  assert.equal((await api('/api/datasets/sales/row-rules')).body.length, 1);
  assert.deepEqual((await api('/api/datasets/sales/query', 'POST', query, 'alice')).body.rows, [{ region: 'East', total: 500 }]);
  assert.equal((await api('/api/datasets/sales/query', 'POST', query, 'bob')).body.errorCode, 'ROW_ACCESS_DENIED');
  assert.equal((await api(path, 'DELETE')).status, 200);
  assert.equal((await api('/api/datasets/sales/query', 'POST', query, 'alice')).body.errorCode, 'ROW_ACCESS_DENIED');
  assert.equal((await api(path)).status, 404);
});
test('RLS resource validates bodies, columns, principal resolution, operators and admin access', async t => {
  const api = await secureApi(t), path = '/api/datasets/sales/row-rules/rule';
  for (const body of [null, {}, { ...rowRule, sql: 'TRUE' }, { ...rowRule, principals: [] }, { ...rowRule, principals: [{ type: 'user', id: 'unknown' }] },
    { ...rowRule, predicate: { all: [] } }, { ...rowRule, predicate: { column: 'region', operator: 'eq', value: 4 } },
    { ...rowRule, predicate: { column: 'unknown', operator: 'eq', value: 'x' } }, { ...rowRule, predicate: { column: 'region', operator: 'sql', value: 'TRUE' } }]) assert.equal((await api(path, 'PUT', body)).status, 400, JSON.stringify(body));
  assert.equal((await api(path, 'PUT', rowRule, 'alice')).status, 403);
  assert.deepEqual((await api('/api/datasets/sales/row-rules')).body, []);
});
test('column grant CRUD validates principals/columns/effects and retains column protection after delete', async t => {
  const api = await secureApi(t), path = '/api/datasets/sales/column-grants/revenue';
  const grant = { column: 'revenue', effect: 'allow', principals: [{ type: 'user', id: 'alice' }] };
  assert.equal((await api(path, 'PUT', grant)).status, 200);
  assert.deepEqual((await api(path)).body, { id: 'revenue', ...grant });
  assert.equal((await api('/api/datasets/sales/column-grants')).body.length, 1);
  assert.equal((await api('/api/datasets/sales/query', 'POST', query, 'alice')).status, 200);
  assert.equal((await api('/api/datasets/sales/query', 'POST', query, 'bob')).body.errorCode, 'COLUMN_ACCESS_DENIED');
  for (const invalid of [{ ...grant, column: 'missing' }, { ...grant, effect: 'other' }, { ...grant, sql: '1' }, { ...grant, principals: [{ type: 'user', id: 'missing' }] }]) assert.equal((await api(path, 'PUT', invalid)).status, 400);
  assert.equal((await api(path, 'PUT', { ...grant, effect: 'deny' }, 'alice')).status, 403);
  assert.equal((await api(path, 'DELETE')).status, 200);
  assert.equal((await api('/api/datasets/sales/query', 'POST', query, 'alice')).body.errorCode, 'COLUMN_ACCESS_DENIED');
});
