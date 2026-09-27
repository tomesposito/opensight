import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { organizationApi, viewer, groupViewer } from './organization-helpers.mjs';
import { startApi } from './automation-helpers.mjs';
const asset = '/api/assets/analysis/renderable-sales';

test('folder CRUD, membership moves, empty deletion and namespace isolation', async t => {
  const { api } = await organizationApi(t);
  assert.deepEqual((await api('/api/folders')).body, []);
  for (const id of ['one', 'two']) assert.equal((await api(`/api/folders/${id}`, 'PUT', { name: id })).status, 200);
  assert.equal((await api('/api/folders/one', 'PUT', { name: 'Renamed' })).body.name, 'Renamed');
  assert.equal((await api(`${asset}/move`, 'POST', { folderId: 'one' })).status, 200);
  assert.equal((await api('/api/folders/one/assets')).body[0].id, 'renderable-sales');
  assert.equal((await api('/api/folders/one', 'DELETE')).status, 409);
  assert.equal((await api(`${asset}/move`, 'POST', { folderId: 'two' })).status, 200);
  assert.deepEqual((await api('/api/folders/one/assets')).body, []);
  assert.equal((await api('/api/folders/one', 'DELETE')).status, 200);
  assert.equal((await api('/api/folders/one')).status, 404);
  assert.equal((await api('/api/folders/two', 'GET', undefined, 'tenant-admin')).status, 404);
  assert.equal((await api('/api/namespaces/default/folders/two', 'GET', undefined, 'tenant-admin')).status, 404);
  assert.equal((await api(`${asset}/move`, 'POST', { folderId: null })).status, 200);
  assert.equal((await api('/api/folders/two', 'DELETE')).status, 200);
});
test('folder grants inherit the namespace ceiling and restrict asset listing and direct reads', async t => {
  const { api } = await organizationApi(t);
  await api('/api/folders/private', 'PUT', { name: 'Private' });
  await api(`${asset}/move`, 'POST', { folderId: 'private' });
  assert.equal((await api('/analyses/renderable-sales/definition', 'GET', undefined, 'default-bob')).status, 200);
  await api('/api/folders/private/permissions', 'PUT', { grants: [groupViewer] });
  assert.equal((await api('/analyses/renderable-sales/definition', 'GET', undefined, 'default-alice')).status, 200);
  assert.equal((await api('/analyses/renderable-sales/definition', 'GET', undefined, 'default-bob')).status, 404);
  assert.ok(!(await api('/api/assets', 'GET', undefined, 'default-bob')).body.some(a => a.id === 'renderable-sales'));
  assert.deepEqual((await api('/api/folders', 'GET', undefined, 'default-bob')).body, []);
  await api('/api/folders/private/permissions', 'PUT', { grants: [{ ...viewer, role: 'co-owner' }] });
  assert.equal((await api('/api/folders/private', 'PUT', { name: 'Escalated' }, 'default-alice')).status, 403);
  assert.equal((await api(`${asset}/move`, 'POST', { folderId: null }, 'default-alice')).status, 403);
  assert.equal((await api('/api/folders/private/permissions', 'GET', undefined, 'default-alice')).status, 403);
  assert.equal((await api('/api/users/alice', 'DELETE')).status, 409);
  await api('/api/folders/private/permissions', 'PUT', { grants: [] });
  assert.equal((await api('/analyses/renderable-sales/definition', 'GET', undefined, 'default-alice')).status, 404);
  await api('/api/folders/private/permissions', 'PUT', { grants: null });
  assert.equal((await api('/analyses/renderable-sales/definition', 'GET', undefined, 'default-bob')).status, 200);
});
test('copy snapshots persist with their own IDs; failed transfers never change memberships', async t => {
  const root = await mkdtemp(join(tmpdir(), 'opensight-folders-')); t.after(() => rm(root, { recursive: true, force: true }));
  const storePath = join(root, 'security.json');
  const { api, dataRoot } = await organizationApi(t, { security: { storePath } });
  await api('/api/folders/copies', 'PUT', { name: 'Copies' });
  const original = (await api('/analyses/renderable-sales/definition')).body;
  assert.equal((await api(`${asset}/copy`, 'POST', { folderId: 'copies', newId: 'copy', name: 'Copy' })).status, 200);
  assert.equal((await api(`${asset}/copy`, 'POST', { folderId: 'copies', newId: 'copy' })).status, 409);
  assert.equal((await api(`${asset}/move`, 'POST', { folderId: 'missing' })).status, 404);
  const copy = (await api('/analyses/copy/definition')).body;
  assert.equal(copy.AnalysisId, 'copy'); assert.equal(copy.Name, 'Copy'); assert.deepEqual(copy.Definition, original.Definition);
  assert.equal((await api('/api/folders/copies/assets')).body.length, 1);
  assert.equal((await api('/api/assets/dashboard/sales-dashboard/copy', 'POST', { folderId: 'copies', newId: 'dashboard-copy' })).status, 200);
  assert.equal((await api('/dashboards/dashboard-copy/definition')).body.DashboardId, 'dashboard-copy');
  await api('/analyses/copy/shares/user/alice', 'PUT', { role: 'viewer' });
  await api('/analyses/copy/shares/user/alice', 'DELETE');
  const restarted = (await organizationApi(t, { dataRoot, security: { storePath } })).api;
  assert.deepEqual((await restarted('/analyses/copy/definition')).body.Definition, original.Definition);
  assert.equal((await restarted('/api/folders/copies/assets')).body.length, 2);
  assert.equal((await restarted('/analyses/copy/definition', 'GET', undefined, 'default-alice')).status, 404);
  const stored = JSON.parse(await readFile(storePath, 'utf8')); stored.assets[0].folderId = 'missing';
  await writeFile(storePath, JSON.stringify(stored));
  await assert.rejects(organizationApi(t, { dataRoot, security: { storePath } }), /Unable to load automation store/);
});
test('folder API validates bodies, IDs, grants, methods and requires configured authentication', async t => {
  const { api } = await organizationApi(t);
  for (const body of [null, {}, { name: '' }, { name: 'Bad\n' }, { name: 'x', namespaceId: 'tenant' }, { name: 'x', grants: [] }]) assert.equal((await api('/api/folders/f', 'PUT', body)).status, 400);
  await api('/api/folders/f', 'PUT', { name: 'Folder' });
  for (const grants of [null, {}, [viewer, viewer], [{ ...viewer, role: 'admin' }], [{ ...viewer, principal: { type: 'user', id: 'missing' } }], [{ ...viewer, principal: { ...viewer.principal, namespaceId: 'tenant' } }]]) {
    if (grants === null) continue;
    assert.equal((await api('/api/folders/f/permissions', 'PUT', { grants })).status, 400);
  }
  for (const body of [{}, { folderId: '../f' }, { folderId: null, namespaceId: 'tenant' }]) assert.equal((await api(`${asset}/move`, 'POST', body)).status, 400);
  assert.equal((await api(`${asset}/copy`, 'POST', { folderId: null })).status, 400);
  for (const path of ['/api/folders/%ZZ', '/api/folders/%2F', '/api/folders?namespace=tenant']) assert.equal((await api(path)).status, 400);
  assert.equal((await api('/api/folders', 'POST', {})).status, 405);
  assert.equal((await api('/api/folders/f', 'PUT', { name: 'No' }, 'default-alice')).status, 403);
  assert.equal((await api('/api/folders', 'GET', undefined, '')).status, 401);
  const local = await startApi(t);
  assert.equal((await local.request('/api/folders')).status, 503);
});
test('namespace and group deletion account for folder resources and grants', async t => {
  const { api } = await organizationApi(t);
  await api('/api/folders/f', 'PUT', { name: 'Folder' });
  await api('/api/folders/f/permissions', 'PUT', { grants: [groupViewer] });
  assert.equal((await api('/api/groups/team', 'DELETE')).status, 409);
  await api('/api/folders/f/permissions', 'PUT', { grants: [] });
  assert.equal((await api('/api/groups/team', 'DELETE')).status, 200);
});

test('concurrent copies serialize collision checks and preserve the original asset', async t => {
  const { api } = await organizationApi(t);
  const results = await Promise.all([1, 2].map(() => api(`${asset}/copy`, 'POST', { folderId: null, newId: 'unique' })));
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  assert.equal((await api('/analyses')).body.filter(a => a.id === 'unique').length, 1);
  assert.equal((await api('/analyses/renderable-sales/definition')).status, 200);
});
test('folders prevent deleting an otherwise empty namespace', async t => {
  const { registry } = await import('./organization-helpers.mjs');
  const initialState = registry();
  initialState.users = initialState.users.filter(u => u.namespaceId !== 'tenant' || u.id === 'admin');
  initialState.groups = initialState.groups.filter(g => g.namespaceId !== 'tenant');
  const { api } = await organizationApi(t, { security: { initialState } });
  await api('/api/folders/f', 'PUT', { name: 'Folder' }, 'tenant-admin');
  assert.equal((await api('/api/namespaces/tenant', 'DELETE', undefined, 'tenant-admin')).status, 409);
  await api('/api/folders/f', 'DELETE', undefined, 'tenant-admin');
  assert.equal((await api('/api/namespaces/tenant', 'DELETE', undefined, 'tenant-admin')).status, 200);
});
