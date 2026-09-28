import test from 'node:test';
import assert from 'node:assert/strict';
import { organizationApi, viewer } from './organization-helpers.mjs';
const asset = '/analyses/renderable-sales', dashboard = '/dashboards/sales-dashboard';
const rowRule = { principals: [{ type: 'group', id: 'team' }], predicate: { column: 'region', operator: 'eq', value: 'East' } };

test('analysis and dashboard user/group shares can be listed, updated and revoked without reopening access', async t => {
  const { api } = await organizationApi(t);
  for (const path of [asset, dashboard]) {
    assert.equal((await api(`${path}/shares`)).body.access, 'inherited');
    assert.equal((await api(`${path}/shares/user/alice`, 'PUT', { role: 'viewer' })).status, 200);
    assert.equal((await api(`${path}/definition`, 'GET', undefined, 'default-alice')).status, 200);
    assert.equal((await api(`${path}/definition`, 'GET', undefined, 'default-bob')).status, 404);
    assert.equal((await api(`${path}/shares/user/alice`)).body.role, 'viewer');
    assert.equal((await api(`${path}/shares/user/alice`, 'PUT', { role: 'co-owner' })).body.role, 'co-owner');
    assert.equal((await api(`${path}/shares/group/team`, 'PUT', { role: 'viewer' })).status, 200);
    assert.equal((await api(`${path}/shares`)).body.grants.length, 2);
    assert.equal((await api(`${path}/shares/user/alice`, 'DELETE')).status, 200);
    assert.equal((await api(`${path}/definition`, 'GET', undefined, 'default-alice')).status, 200);
    assert.equal((await api(`${path}/shares/group/team`, 'DELETE')).status, 200);
    assert.deepEqual((await api(`${path}/shares`)).body, { access: 'restricted', grants: [] });
    assert.equal((await api(`${path}/definition`, 'GET', undefined, 'default-alice')).status, 404);
    assert.equal((await api(`${path}/shares/group/team`, 'DELETE')).status, 404);
  }
  assert.deepEqual((await api('/analyses', 'GET', undefined, 'default-alice')).body, []);
});
test('share permissions intersect folder and namespace grants and follow live membership changes', async t => {
  const { api } = await organizationApi(t);
  await api('/api/folders/f', 'PUT', { name: 'Private' });
  await api('/api/folders/f/permissions', 'PUT', { grants: [viewer] });
  await api('/api/assets/analysis/renderable-sales/move', 'POST', { folderId: 'f' });
  await api(`${asset}/shares/user/bob`, 'PUT', { role: 'viewer' });
  assert.equal((await api(`${asset}/definition`, 'GET', undefined, 'default-alice')).status, 404);
  assert.equal((await api(`${asset}/definition`, 'GET', undefined, 'default-bob')).status, 404);
  await api(`${asset}/shares/group/team`, 'PUT', { role: 'co-owner' });
  assert.equal((await api(`${asset}/definition`, 'GET', undefined, 'default-alice')).status, 200);
  assert.equal((await api(`${asset}/shares/user/bob`, 'PUT', { role: 'viewer' }, 'default-alice')).status, 403);
  assert.equal((await api(`${asset}/shares`, 'GET', undefined, 'default-alice')).status, 403);
  assert.equal((await api('/api/groups/team', 'DELETE')).status, 409);
  assert.equal((await api('/api/users/bob', 'DELETE')).status, 409);
  await api('/api/groups/team', 'PUT', { name: 'Team', userIds: [] });
  assert.equal((await api(`${asset}/definition`, 'GET', undefined, 'default-alice')).status, 404);
  assert.equal((await api('/api/namespaces/default/analyses/renderable-sales/shares', 'GET', undefined, 'tenant-admin')).status, 404);
});
test('shared viewer queries enforce their own RLS and CLS, including group changes and admin policy denial', async t => {
  const { api } = await organizationApi(t);
  await api(`${dashboard}/shares/group/team`, 'PUT', { role: 'viewer' });
  await api('/api/datasets/sales/row-rules/east', 'PUT', rowRule);
  const visual = `${dashboard}/visuals/total-revenue/query`;
  let result = await api(visual, 'POST', {}, 'default-alice');
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.deepEqual(result.body.rows, [{ revenue: 500 }]);
  assert.equal((await api(visual, 'POST', {}, 'default-bob')).status, 404);
  assert.equal((await api(visual, 'POST', {})).body.errorCode, 'ROW_ACCESS_DENIED');
  await api('/api/datasets/sales/column-grants/deny', 'PUT', { column: 'revenue', effect: 'deny', principals: [{ type: 'user', id: 'alice' }] });
  assert.equal((await api(visual, 'POST', {}, 'default-alice')).body.errorCode, 'COLUMN_ACCESS_DENIED');
  await api('/api/datasets/sales/column-grants/allow', 'PUT', { column: 'revenue', effect: 'allow', principals: [{ type: 'group', id: 'team' }] });
  assert.equal((await api(visual, 'POST', {}, 'default-alice')).body.errorCode, 'COLUMN_ACCESS_DENIED');
  await api('/api/datasets/sales/column-grants/deny', 'DELETE');
  assert.deepEqual((await api(visual, 'POST', {}, 'default-alice')).body.rows, [{ revenue: 500 }]);
  await api(`${dashboard}/shares/group/team`, 'DELETE');
  assert.equal((await api(visual, 'POST', {}, 'default-alice')).status, 404);
});
test('copy preserves restricted asset grants and revocation affects only the copy', async t => {
  const { api } = await organizationApi(t);
  await api(`${asset}/shares/user/alice`, 'PUT', { role: 'viewer' });
  await api('/api/assets/analysis/renderable-sales/copy', 'POST', { folderId: null, newId: 'copy' });
  assert.equal((await api('/analyses/copy/definition', 'GET', undefined, 'default-bob')).status, 404);
  assert.equal((await api('/analyses/copy/definition', 'GET', undefined, 'default-alice')).status, 200);
  await api('/analyses/copy/shares/user/alice', 'DELETE');
  assert.equal((await api('/analyses/copy/definition', 'GET', undefined, 'default-alice')).status, 404);
  assert.equal((await api(`${asset}/definition`, 'GET', undefined, 'default-alice')).status, 200);
});
test('sharing and visual-query API reject invalid roles, principals, IDs, methods and forged context', async t => {
  const { api } = await organizationApi(t);
  const path = `${asset}/shares/user/alice`;
  for (const body of [null, {}, { role: 'owner' }, { role: 'viewer', namespaceId: 'tenant' }, { role: 'viewer', principal: 'bob' }]) assert.equal((await api(path, 'PUT', body)).status, 400);
  assert.equal((await api(`${asset}/shares/user/unknown`, 'PUT', { role: 'viewer' })).status, 400);
  assert.equal((await api(`${asset}/shares/user/%ZZ`, 'PUT', { role: 'viewer' })).status, 400);
  assert.equal((await api(`${asset}/shares?namespace=tenant`)).status, 400);
  assert.equal((await api(`${asset}/shares`, 'POST', {})).status, 405);
  assert.equal((await api('/analyses/missing/shares')).status, 404);
  assert.equal((await api(`${asset}/visuals/total-revenue/query`, 'POST', { principal: 'admin' }, 'default-alice')).status, 400);
  assert.equal((await api(`${asset}/visuals/total-revenue/query`, 'GET')).status, 405);
});

test('namespace role demotion immediately caps an existing co-owner grant', async t => {
  const { api } = await organizationApi(t);
  await api('/api/users/alice', 'PUT', { name: 'Alice', role: 'administrator' });
  await api(`${asset}/shares/user/alice`, 'PUT', { role: 'co-owner' });
  assert.equal((await api(`${asset}/shares/user/bob`, 'PUT', { role: 'viewer' }, 'default-alice')).status, 200);
  await api('/api/users/alice', 'PUT', { name: 'Alice', role: 'reader' });
  assert.equal((await api(`${asset}/definition`, 'GET', undefined, 'default-alice')).status, 403);
  assert.equal((await api(`${asset}/shares/user/bob`, 'DELETE', undefined, 'default-alice')).status, 403);
  assert.equal((await api('/api/assets/analysis/renderable-sales/copy', 'POST', { folderId: null, newId: 'forbidden' }, 'default-alice')).status, 403);
});
test('missing secured definitions preserve the existing definition API error envelope', async t => {
  const { api } = await organizationApi(t);
  const result = await api('/analyses/missing/definition');
  assert.equal(result.status, 404); assert.equal(result.body.Type, 'ResourceNotFoundException');
  assert.equal(result.body.Message, 'Definition not found'); assert.match(result.body.RequestId, /^[0-9a-f-]{36}$/);
});
