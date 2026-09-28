import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { organizationApi } from './organization-helpers.mjs';
const path = '/api/invitations';
const authenticate = r => {
  const match = /^Bearer test-(default|tenant)-(admin|alice|bob|invited)$/.exec(r.headers.authorization ?? '');
  return match ? { namespaceId: match[1], userId: match[2] } : undefined;
};
const invite = { id: 'invited', name: 'Invited user', role: 'author_ai' };

test('admin invitations bind verified identity, persist only a digest, and accept exactly once', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'opensight-invite-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const security = { authenticate, storePath: join(dir, 'security.json') };
  const { api } = await organizationApi(t, { security });
  const created = await api(path, 'POST', invite);
  assert.equal(created.status, 201); assert.match(created.body.token, /^[a-f0-9]{64}$/);
  assert.equal(created.body.invitation.role, 'author_ai');
  assert.ok(!JSON.stringify((await api(path)).body).includes(created.body.token));
  const saved = await readFile(security.storePath, 'utf8'); assert.ok(!saved.includes(created.body.token));
  assert.match(JSON.parse(saved).invitations[0].tokenHash, /^[a-f0-9]{64}$/);
  assert.equal((await api('/api/session', 'GET', undefined, 'default-invited')).status, 403);
  const restarted = await organizationApi(t, { security });
  const accepted = await restarted.api(`${path}/accept`, 'POST', { token: created.body.token }, 'default-invited');
  assert.equal(accepted.status, 200); assert.equal(accepted.body.role, 'author_ai');
  assert.equal((await restarted.api('/api/session', 'GET', undefined, 'default-invited')).body.role, 'author_ai');
  assert.equal((await restarted.api(`${path}/accept`, 'POST', { token: created.body.token }, 'default-invited')).body.errorCode, 'SECURITY_INVITATION_INVALID');
});
test('non-admin invitation and user mutation bypass attempts cannot elevate roles', async t => {
  const { api } = await organizationApi(t, { security: { authenticate } });
  for (const role of ['author', 'author_ai', 'reader', 'reader_ai']) {
    await api('/api/users/alice', 'PUT', { name: 'Alice', role });
    for (const [route, method, body] of [[path, 'GET'], [path, 'POST', { ...invite, role: 'administrator' }], [`${path}/invited`, 'DELETE'], ['/api/users/alice', 'PUT', { name: 'Alice', role: 'administrator' }], ['/api/users/bob', 'DELETE']]) {
      const result = await api(route, method, body, 'default-alice');
      assert.equal(result.body.errorCode, 'SECURITY_ADMIN_REQUIRED');
    }
  }
  assert.equal((await api(path, 'POST', invite, '')).status, 401);
  assert.equal((await api(path, 'POST', invite, 'default-alice', { 'x-role': 'administrator' })).status, 403);
  for (const body of [{ ...invite, role: 'admin' }, { ...invite, role: 'owner' }, { ...invite, namespaceId: 'tenant' }, { ...invite, id: 'accept' }, { ...invite, name: '' }]) assert.equal((await api(path, 'POST', body)).status, 400);
});
test('stolen invitation tokens, foreign namespaces and body-supplied roles cannot select identity', async t => {
  const { api } = await organizationApi(t, { security: { authenticate } });
  const { token } = (await api(path, 'POST', invite)).body;
  for (const user of ['default-alice', 'tenant-invited', 'tenant-admin']) assert.equal((await api(`${path}/accept`, 'POST', { token }, user)).body.errorCode, 'SECURITY_INVITATION_PRINCIPAL_MISMATCH');
  assert.equal((await api(`${path}/accept`, 'POST', { token }, '')).status, 401);
  for (const body of [{ token, role: 'administrator' }, { token, userId: 'invited' }, { token, namespaceId: 'default' }]) assert.equal((await api(`${path}/accept`, 'POST', body, 'default-invited')).status, 400);
  assert.deepEqual((await api(path, 'GET', undefined, 'tenant-admin')).body, []);
  assert.equal((await api(`${path}/invited`, 'DELETE', undefined, 'tenant-admin')).status, 404);
  assert.equal((await api(`${path}/accept`, 'POST', { token }, 'default-invited')).status, 200);
});
test('revocation, duplicate invitations, last administrator and user references fail atomically', async t => {
  const { api } = await organizationApi(t, { security: { authenticate } });
  const { token } = (await api(path, 'POST', invite)).body;
  assert.equal((await api(path, 'POST', invite)).status, 409);
  assert.equal((await api('/api/users/invited', 'PUT', { name: 'Invite', role: 'administrator' })).status, 409);
  assert.equal((await api(`${path}/invited`, 'DELETE')).status, 200);
  assert.equal((await api(`${path}/accept`, 'POST', { token }, 'default-invited')).body.errorCode, 'SECURITY_INVITATION_INVALID');
  assert.equal((await api('/api/users/admin', 'DELETE')).status, 409);
  assert.equal((await api('/api/users/admin', 'PUT', { name: 'Admin', role: 'author_ai' })).status, 409);
  assert.equal((await api('/api/users/alice', 'DELETE')).status, 409);
  assert.equal((await api('/api/users/admin')).body.role, 'administrator');
});
test('expired invitations and demoted inviters cannot grant access', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'opensight-expiry-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const security = { authenticate, storePath: join(dir, 'security.json') };
  const { api } = await organizationApi(t, { security });
  const { token } = (await api(path, 'POST', invite)).body;
  const state = JSON.parse(await readFile(security.storePath, 'utf8'));
  state.invitations[0].expiresAt = '2000-01-01T00:00:00.000Z'; await writeFile(security.storePath, JSON.stringify(state));
  const restarted = await organizationApi(t, { security });
  assert.equal((await restarted.api(`${path}/accept`, 'POST', { token }, 'default-invited')).body.errorCode, 'SECURITY_INVITATION_EXPIRED');
  await api('/api/users/alice', 'PUT', { name: 'Alice', role: 'administrator' });
  await api('/api/users/admin', 'PUT', { name: 'Former admin', role: 'author' }, 'default-alice');
  assert.equal((await api(`${path}/accept`, 'POST', { token }, 'default-invited')).body.errorCode, 'SECURITY_ADMIN_REQUIRED');
});
test('concurrent acceptance consumes invitation atomically', async t => {
  const { api } = await organizationApi(t, { security: { authenticate } });
  const { token } = (await api(path, 'POST', invite)).body;
  const results = await Promise.all([1, 2].map(() => api(`${path}/accept`, 'POST', { token }, 'default-invited')));
  assert.deepEqual(results.map(r => r.status).sort(), [200, 404]);
  assert.equal((await api('/api/users')).body.filter(u => u.id === 'invited').length, 1);
});
