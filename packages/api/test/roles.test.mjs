import test from 'node:test';
import assert from 'node:assert/strict';
import { secureApi, query } from './security.test.mjs';
import { ROLES, hasCapability } from '@opensight/query-engine';
import { validateSecurityState } from '../dist/security.js';
import { emptySecurityState } from '@opensight/api';

test('five roles have explicit capabilities; invalid and legacy request roles fail closed', () => {
  for (const role of [...ROLES, 'admin', 'owner', undefined]) {
    assert.equal(hasCapability(role, 'admin'), role === 'administrator');
    assert.equal(hasCapability(role, 'build'), ['administrator', 'author', 'author_ai'].includes(role));
    assert.equal(hasCapability(role, 'ai'), ['administrator', 'author_ai', 'reader_ai'].includes(role));
  }
  const state = emptySecurityState();
  state.users = [{ id: 'old', namespaceId: 'default', name: 'Old', role: 'admin' }, { id: 'read', namespaceId: 'default', name: 'Read', role: 'reader' }];
  assert.deepEqual(validateSecurityState(state, []).users.map(u => u.role), ['administrator', 'reader']);
  state.users[0].role = 'owner'; assert.throws(() => validateSecurityState(state, []), /role/);
});
test('session roles come from registry; role changes cap analysis and query access immediately', async t => {
  const api = await secureApi(t);
  assert.equal((await api('/api/session')).body.role, 'administrator');
  for (const role of ROLES) {
    assert.equal((await api('/api/users/alice', 'PUT', { name: 'Alice', role })).status, 200);
    assert.equal((await api('/api/session', 'GET', undefined, 'alice')).body.role, role);
    const build = hasCapability(role, 'build');
    assert.equal((await api('/analyses/renderable-sales/definition', 'GET', undefined, 'alice')).status, build ? 200 : 403);
    assert.equal((await api('/api/datasets/sales/query', 'POST', query, 'alice')).status, build ? 200 : 403);
    assert.equal((await api('/api/users', 'GET', undefined, 'alice')).status, role === 'administrator' ? 200 : 403);
    if (!build) assert.ok((await api('/api/assets', 'GET', undefined, 'alice')).body.every(a => a.kind === 'dashboard'));
  }
  assert.equal((await api('/api/users/alice', 'PUT', { name: 'Alice', role: 'admin' })).status, 400);
  assert.equal((await api('/api/users/alice', 'PUT', { name: 'Alice', role: 'administrator' }, 'alice')).body.errorCode, 'SECURITY_ADMIN_REQUIRED');
  assert.equal((await api('/api/session', 'GET', undefined, '')).status, 401);
  for (const header of ['x-role', 'x-roles', 'x-capabilities']) assert.equal((await api('/api/session', 'GET', undefined, 'alice', { [header]: 'administrator' })).status, 403);
  assert.equal((await api('/api/session?role=administrator', 'GET', undefined, 'alice')).status, 400);
});
