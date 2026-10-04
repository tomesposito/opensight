import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { referenceConfig, secretEnvironment, assertReferenceSurfaces, unsupportedSurfaces } from '../dist/single-node-config.js';
import { h8Fixture, serveH8 } from './h8-helpers.mjs';
import { drainHostedServer } from '../dist/hosted-server.js';
const env = { OPENSIGHT_REFERENCE: 'single-node', OPENSIGHT_REFERENCE_LOCATION: 'local', OPENSIGHT_ENTITLEMENTS: JSON.stringify({ defaults: { apiCalls: 5, storageBytes: 4096, computeAttempts: 2 }, tenants: {} }) };
test('H8 reference rejects every H9-H12 opt-in and invalid retention/location configuration', () => {
  for (const flag of ['OPENSIGHT_SHARED_PARQUET', 'OPENSIGHT_DISTRIBUTED_REFRESH', 'OPENSIGHT_CUSTOM_EMBED_DOMAINS', 'OPENSIGHT_SUPPORTING_SERVICE_HA']) for (const value of ['true', '1', 'enabled']) assert.throws(() => referenceConfig({ ...env, [flag]: value }), { code: 'UNSUPPORTED' });
  for (const feature of unsupportedSurfaces) {
    assert.throws(() => assertReferenceSurfaces({ [feature]: true }), { code: 'UNSUPPORTED' });
    assert.throws(() => referenceConfig({ ...env, OPENSIGHT_OPTIONAL_SURFACES: JSON.stringify({ [feature]: true }) }), { code: 'UNSUPPORTED' });
    assertReferenceSurfaces({ [feature]: false });
  }
  assert.throws(() => referenceConfig({ ...env, OPENSIGHT_REPLICAS: '2' }), { code: 'UNSUPPORTED' });
  assert.throws(() => referenceConfig({ ...env, OPENSIGHT_REFERENCE_LOCATION: '' }), { code: 'REFERENCE_LOCATION_REQUIRED' });
  assert.throws(() => referenceConfig({ ...env, OPENSIGHT_USAGE_RETENTION_DAYS: '0' }), { code: 'REFERENCE_CONFIG_INVALID' });
  assert.equal(referenceConfig(env).auditDays, 0); assert.equal(referenceConfig(env).usageDays, 30);
});
test('H8 secret files are env selected, exact, conflict checked and never disclosed on failure', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'h8-secrets-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const key = randomBytes(32).toString('base64'), path = join(dir, 'secret'); await writeFile(path, `${key}\n`, { mode: 0o600 });
  const input = { OPENSIGHT_AUTH_SIGNING_KEY_FILE: path };
  assert.deepEqual(await secretEnvironment(input), { OPENSIGHT_AUTH_SIGNING_KEY: key }); assert.equal(input.OPENSIGHT_AUTH_SIGNING_KEY_FILE, path);
  for (const bad of [{ ...input, OPENSIGHT_AUTH_SIGNING_KEY: key }, { OPENSIGHT_AUTH_SIGNING_KEY_FILE: dir }, { OPENSIGHT_AUTH_SIGNING_KEY_FILE: join(dir, 'absent') }]) await assert.rejects(secretEnvironment(bad), e => e.message === 'SECRET_INJECTION_INVALID');
  await symlink(path, join(dir, 'symlink')); await assert.rejects(secretEnvironment({ OPENSIGHT_AUTH_SIGNING_KEY_FILE: join(dir, 'symlink') }), { code: 'SECRET_INJECTION_INVALID' });
});
test('H8 unsupported surface configuration is operator gated and returns named UNSUPPORTED', async t => {
  const f = await h8Fixture(t), { server, request, operator } = await serveH8(t, f);
  for (const feature of unsupportedSurfaces) {
    assert.equal((await request('/api/host/reference/surfaces', { method: 'PUT', headers: { authorization: 'one' }, body: { [feature]: true } })).body.errorCode, 'OPERATOR_REQUIRED');
    assert.equal((await request('/api/host/reference/surfaces', { method: 'PUT', headers: operator, body: { [feature]: true } })).body.errorCode, 'UNSUPPORTED');
  }
  assert.match((await request('/api/host/reference', { headers: operator })).body.disclosure, /Pilot, single-node, no HA claims/);
  await drainHostedServer(server);
});
