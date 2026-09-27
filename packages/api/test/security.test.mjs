import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { dashboardRoot, interval } from './automation-helpers.mjs';
import { createApiServer, emptySecurityState, StubMailTransport } from '@opensight/api';

const fixtures = fileURLToPath(new URL('../../../fixtures/', import.meta.url));
export const query = { dimensions: [{ fieldId: 'region', columnName: 'region' }], measures: [{ fieldId: 'total', columnName: 'revenue', aggregation: 'SUM' }], filters: [] };
export async function secureApi(t, options = {}) {
  const { apiOptions = {}, ...securityOptions } = options;
  const initialState = emptySecurityState();
  initialState.users = ['admin', 'alice', 'bob'].map(id => ({ id, name: id, namespaceId: 'default', role: id === 'admin' ? 'admin' : 'reader' }));
  initialState.groups = [{ id: 'east', name: 'East', namespaceId: 'default', userIds: ['alice'] }];
  const server = await createApiServer({ dataRoot: fixtures, mailTransport: new StubMailTransport(), security: { initialState, authenticate: request => {
    const token = request.headers.authorization;
    return ['admin', 'alice', 'bob'].some(id => token === `Bearer test-${id}`) ? { namespaceId: 'default', userId: token.slice(12) } : undefined;
  }, ...securityOptions }, ...apiOptions });
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
test('namespace CRUD validates resources, scopes reads and handles empty namespace deletion', async t => {
  const api = await secureApi(t, { authenticate: r => {
    const token = r.headers.authorization;
    return token === 'Bearer test-created' ? { namespaceId: 'created', userId: 'admin' } : token === 'Bearer test-admin' ? { namespaceId: 'default', userId: 'admin' } : undefined;
  } });
  for (const body of [{}, { name: '' }, { name: 'Tenant', extra: true }, { name: 1 }]) assert.equal((await api('/api/namespaces/created', 'PUT', body)).status, 400);
  assert.equal((await api('/api/namespaces/created', 'PUT', { name: 'Created' })).status, 200);
  assert.equal((await api('/api/namespaces/created')).status, 404);
  assert.deepEqual((await api('/api/namespaces', 'GET', undefined, 'created')).body, [{ id: 'created', name: 'Created' }]);
  assert.equal((await api('/api/namespaces/created', 'PUT', { name: 'Renamed' }, 'created')).status, 200);
  assert.equal((await api('/api/namespaces/created', 'GET', undefined, 'created')).body.name, 'Renamed');
  assert.equal((await api('/api/namespaces/default', 'DELETE')).status, 409);
  assert.equal((await api('/api/namespaces/created', 'DELETE', undefined, 'created')).status, 200);
  assert.equal((await api('/api/assets', 'GET', undefined, 'created')).body.errorCode, 'UNKNOWN_PRINCIPAL');
});
test('users and groups are scoped resources with referential and membership validation', async t => {
  const api = await secureApi(t);
  assert.equal((await api('/api/users/carol', 'PUT', { name: 'Carol', role: 'reader' })).status, 200);
  assert.equal((await api('/api/users/carol')).body.namespaceId, 'default');
  assert.equal((await api('/api/groups/team', 'PUT', { name: 'Team', userIds: ['carol'] })).status, 200);
  for (const body of [{ name: 'Team', userIds: ['missing'] }, { name: 'Team', userIds: ['carol', 'carol'] }, { name: 'Team', userIds: [], namespaceId: 'other' }]) assert.equal((await api('/api/groups/team', 'PUT', body)).status, 400);
  assert.equal((await api('/api/users/admin', 'PUT', { name: 'Admin', role: 'reader' })).status, 409);
  assert.equal((await api('/api/users/carol', 'DELETE')).status, 409);
  assert.equal((await api('/api/groups/team', 'DELETE')).status, 200);
  assert.equal((await api('/api/users/carol', 'DELETE')).status, 200);
  assert.equal((await api('/api/users/carol')).status, 404);
  await api('/api/datasets/sales/row-rules/east', 'PUT', rowRule);
  assert.equal((await api('/api/groups/east', 'DELETE')).status, 409);
  assert.equal((await api('/api/users', 'GET', undefined, 'alice')).status, 403);
});
test('namespace assets, definitions, same user/group IDs, policies and query bindings stay isolated', async t => {
  const root = await mkdtemp(join(tmpdir(), 'opensight-tenant-')); t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'tenant.json'), JSON.stringify({ AnalysisId: 'renderable-sales', Name: 'Tenant private asset', Definition: { DataSetIdentifierDeclarations: [], Sheets: [] } }));
  const initialState = emptySecurityState(); initialState.namespaces.push({ id: 'tenant', name: 'Tenant' });
  initialState.users = ['default', 'tenant'].flatMap(namespaceId => [{ id: 'admin', name: 'Admin', namespaceId, role: 'admin' }, { id: 'alice', name: 'Alice', namespaceId, role: 'reader' }]);
  initialState.groups = ['default', 'tenant'].map(namespaceId => ({ id: 'east', name: 'East', namespaceId, userIds: ['alice'] }));
  const api = await secureApi(t, { initialState, apiOptions: { namespaceDataRoots: { tenant: root } }, authenticate: r => {
    const match = /^Bearer test-(default|tenant)-(admin|alice)$/.exec(r.headers.authorization ?? '');
    return match ? { namespaceId: match[1], userId: match[2] } : undefined;
  } });
  const tenant = 'tenant-admin', normal = 'default-admin';
  assert.equal((await api('/analyses/renderable-sales/definition', 'GET', undefined, tenant)).body.Name, 'Tenant private asset');
  assert.notEqual((await api('/analyses/renderable-sales/definition', 'GET', undefined, normal)).body.Name, 'Tenant private asset');
  assert.deepEqual((await api('/api/assets', 'GET', undefined, tenant)).body, [{ kind: 'analysis', id: 'renderable-sales', name: 'Tenant private asset' }]);
  assert.deepEqual((await api('/api/datasets', 'GET', undefined, tenant)).body, []);
  for (const path of ['/api/namespaces/default/assets', '/api/namespaces/default/analyses/renderable-sales/definition', '/api/namespaces/default/datasets/sales/query', '/api/refresh-schedules', '/api/alert-rules']) assert.equal((await api(path, 'GET', undefined, tenant)).status, 404, path);
  assert.equal((await api('/api/namespaces/tenant/assets', 'GET', undefined, tenant)).status, 200);
  assert.equal((await api('/api/datasets/sales/query', 'POST', query, tenant)).status, 404);
  assert.equal((await api('/api/datasets/sales/row-rules/east', 'PUT', rowRule, normal)).status, 200);
  assert.equal((await api('/api/datasets/sales/row-rules', 'GET', undefined, tenant)).status, 404);
  assert.equal((await api('/api/groups/east', 'PUT', { name: 'Tenant team', userIds: [] }, tenant)).status, 200);
  assert.deepEqual((await api('/api/groups/east', 'GET', undefined, normal)).body.userIds, ['alice']);
  assert.deepEqual((await api('/api/datasets/sales/query', 'POST', query, 'default-alice')).body.rows, [{ region: 'East', total: 500 }]);
  assert.equal((await api('/api/namespaces/tenant', 'DELETE', undefined, tenant)).status, 409);
});
test('direct query bypass attempts reject missing/forged credentials and untrusted identity or policy claims', async t => {
  const api = await secureApi(t);
  await api('/api/datasets/sales/row-rules/east', 'PUT', rowRule);
  const path = '/api/datasets/sales/query';
  assert.deepEqual((await api(path, 'POST', query, '')).body.errorCode, 'PRINCIPAL_REQUIRED');
  assert.deepEqual((await api(path, 'POST', query, 'forged')).body.errorCode, 'UNKNOWN_PRINCIPAL');
  for (const key of ['principal', 'principals', 'user', 'userId', 'groups', 'groupIds', 'namespace', 'namespaceId', 'security', 'policy']) {
    const result = await api(path, 'POST', { ...query, [key]: 'admin' }, 'alice');
    assert.equal(result.status, 403, key); assert.equal(result.body.errorCode, 'FORGED_PRINCIPAL');
  }
  for (const header of ['x-user', 'x-user-id', 'x-principal', 'x-groups', 'x-group-ids', 'x-namespace', 'x-namespace-id']) assert.equal((await api(path, 'POST', query, 'alice', { [header]: 'admin' })).body.errorCode, 'FORGED_PRINCIPAL');
  for (const field of ['localData', 'dataSet', 'dataSource', 'sql']) assert.equal((await api(path, 'POST', { ...query, [field]: {} }, 'alice')).status, 400);
  assert.equal((await api(`${path}?namespace=other`, 'POST', query, 'alice')).status, 400);
  assert.deepEqual((await api(path, 'POST', { ...query, filters: [{ columnName: 'region', values: ['West', "East' OR TRUE --"] }] }, 'alice')).body.rows, []);
  assert.equal((await api('/api/datasets/sales/row-rules/east', 'DELETE', undefined, 'alice')).status, 403);
  // Changing membership takes effect on the next query; no principal/group cache.
  await api('/api/groups/east', 'PUT', { name: 'East', userIds: [] });
  assert.equal((await api(path, 'POST', query, 'alice')).body.errorCode, 'ROW_ACCESS_DENIED');
});
test('verifier exceptions and unknown registered identities fail closed without leaking verifier details', async t => {
  for (const authenticate of [() => { throw new Error('private verifier details'); }, () => ({ namespaceId: 'default', userId: 'missing' }), () => ({ namespaceId: 'missing', userId: 'alice' })]) {
    const api = await secureApi(t, { authenticate });
    const result = await api('/api/datasets/sales/query', 'POST', query);
    assert.equal(result.body.errorCode, 'UNKNOWN_PRINCIPAL'); assert.doesNotMatch(JSON.stringify(result.body), /private verifier/);
  }
});
test('protected background refresh, alerts and report capture cannot bypass missing execution identities', async t => {
  const mail = new StubMailTransport();
  const api = await secureApi(t, { apiOptions: { dataRoot: await dashboardRoot(t), mailTransport: mail } });
  await api('/api/datasets/sales/row-rules/east', 'PUT', rowRule);
  const run = await api('/api/datasets/sales/refresh-runs', 'POST', {});
  assert.equal(run.body.state, 'failed'); assert.equal(run.body.rows, null); assert.equal(run.body.error.code, 'PRINCIPAL_REQUIRED');
  assert.equal((await api('/api/refresh-schedules', 'GET', undefined, 'alice')).status, 403);
  const alert = await api('/api/alert-rules/test', 'PUT', { datasetId: 'sales', dashboardId: 'sales-dashboard', visualId: 'total-revenue', fieldId: 'revenue', enabled: true, recipients: ['reader@example.com'], condition: { kind: 'above', threshold: 1 } });
  assert.equal(alert.body.errorCode, 'PRINCIPAL_REQUIRED');
  assert.equal((await api('/api/users/alice/subscriptions/test', 'PUT', { dashboardId: 'sales-dashboard', recipients: ['reader@example.com'], enabled: false, schedule: interval })).status, 200);
  assert.equal((await api('/api/users/alice/subscriptions/test/runs', 'POST', {})).body.state, 'failed');
  assert.equal(mail.messages.length, 0);
});
test('security store persists protection and rejects corrupted policies before startup', async t => {
  const root = await mkdtemp(join(tmpdir(), 'opensight-policy-')); t.after(() => rm(root, { recursive: true, force: true }));
  const storePath = join(root, 'security.json'), api = await secureApi(t, { storePath });
  await api('/api/datasets/sales/row-rules/east', 'PUT', rowRule);
  await api('/api/datasets/sales/row-rules/east', 'DELETE');
  await api('/api/datasets/sales/column-grants/revenue', 'PUT', { column: 'revenue', effect: 'allow', principals: [{ type: 'user', id: 'alice' }] });
  await api('/api/datasets/sales/column-grants/revenue', 'DELETE');
  const restarted = await secureApi(t, { storePath });
  assert.equal((await restarted('/api/datasets/sales/query', 'POST', query, 'alice')).body.errorCode, 'ROW_ACCESS_DENIED');
  const { readFile } = await import('node:fs/promises');
  const saved = JSON.parse(await readFile(storePath, 'utf8'));
  assert.equal(saved.datasets[0].rowLevel, true); assert.deepEqual(saved.datasets[0].protectedColumns, ['revenue']);
  saved.datasets[0].rowRules = [{ id: 'bad', ...rowRule, principals: [{ type: 'user', id: 'missing' }] }];
  await writeFile(storePath, JSON.stringify(saved));
  await assert.rejects(secureApi(t, { storePath }), /Unable to load automation store/);
});
