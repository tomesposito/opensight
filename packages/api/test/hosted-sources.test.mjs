import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { sourceFixture, registration, upload, credentials } from './source-helpers.mjs';
import { sourceEndpoints } from '../dist/source-schema.js';

test('H3 durable tenant and owner source isolation, encrypted secrets and rotation survive restart', async t => {
  const f = await sourceFixture(t), raw = registration(); let a = await f.login();
  const summary = await f.sources.create(a, 'same', raw);
  await f.sources.create(await f.login('two'), 'same', registration());
  await f.sources.create(await f.login('one', 'other'), 'same', registration());
  assert.equal(JSON.stringify(summary).includes(raw.credentials.password), false);
  assert.equal('secretId' in summary, false);
  let source = await f.sources.get(a, 'same');
  assert.deepEqual(await f.sources.payload(a, source), raw.credentials);
  const records = await f.db.transaction(c => c.query('SELECT body FROM h1_resources'));
  assert.equal(JSON.stringify(records).includes(raw.credentials.password), false);
  const rev = await f.metadata.revisions(a), rotated = credentials();
  await f.sources.rotate(a, 'same', { expectedVersion: 1, credentials: rotated });
  await assert.rejects(f.metadata.assertRevisions(a, rev), { code: 'METADATA_REVISED' });
  await assert.rejects(f.sources.rotate(a, 'same', { expectedVersion: 1, credentials: raw.credentials }), { code: 'METADATA_CONFLICT' });
  await f.restart(); a = await f.login(); source = await f.sources.get(a, 'same');
  assert.equal(source.version, 2); assert.deepEqual(await f.sources.payload(a, source), rotated);
  assert.notDeepEqual(await f.sources.payload(await f.login('two'), await f.sources.get(await f.login('two'), 'same')), rotated);
  assert.notDeepEqual(await f.sources.payload(await f.login('one', 'other'), await f.sources.get(await f.login('one', 'other'), 'same')), rotated);
  assert.equal((await readFile(f.path)).includes(Buffer.from(raw.credentials.password)), false);
});
test('H3 explicit source policy, scoped principal links and endpoint authorization fail before I/O', async t => {
  const f = await sourceFixture(t), a = await f.login();
  for (const [changes, code] of [[{ policy: undefined }, 'SOURCE_POLICY_REQUIRED'], [{ endpointId: 'foreign' }, 'SOURCE_ENDPOINT_DENIED'], [{ connectorId: 'mysql' }, 'SOURCE_CONNECTOR_UNSUPPORTED'], [{ credentials: { connectionString: 'forged' } }, 'METADATA_INVALID'], [{ tenantId: 'tenant-two' }, 'METADATA_INVALID'], [{ policy: { rowLevel: true, rowRules: [{ id: 'r', principals: [{ type: 'user', id: 'foreign' }], predicate: { column: 'region', operator: 'eq', value: 'east' } }] } }, 'METADATA_REFERENCE_INVALID']]) {
    await assert.rejects(f.sources.create(a, 'invalid', { ...registration(), ...changes }), { code });
  }
  assert.deepEqual(await f.metadata.list(a, 'source'), []); assert.deepEqual(await f.metadata.list(a, 'secret'), []);
  await f.sources.create(await f.login('two'), 'foreign', registration());
  for (const id of ['foreign', 'missing']) await assert.rejects(f.sources.get(a, id), { code: 'RESOURCE_NOT_FOUND' });
  await assert.rejects(f.sources.create({ ...a }, 'forged', registration()), { code: 'TENANT_CONTEXT_REQUIRED' });
  assert.throws(() => sourceEndpoints({ OPENSIGHT_SOURCE_ENDPOINTS: '[{"id":"x","host":"/tmp/socket"}]' }), { code: 'SOURCE_ENDPOINT_CONFIG_INVALID' });
});
test('H3 upload expiry is explicit and survives restart; retirement removes encrypted payload', async t => {
  const f = await sourceFixture(t); let a = await f.login();
  for (const expiresAt of [undefined, 'invalid', '2000-01-01T00:00:00.000Z']) await assert.rejects(f.sources.upload(a, { ...upload(), expiresAt }), { code: 'UPLOAD_EXPIRY_REQUIRED' });
  const u = await f.sources.upload(a, upload(undefined, new Date(Date.now() + 60000).toISOString()));
  assert.equal(u.rowCount, 3); const s = await f.sources.get(a, u.id);
  assert.equal((await f.sources.payload(a, s)).rows.length, 3);
  await f.restart(); a = await f.login(); assert.equal((await f.sources.get(a, u.id)).binding.rowCount, 3);
  await assert.rejects(f.sources.get(await f.login('one', 'other'), u.id), { code: 'RESOURCE_NOT_FOUND' });
  f.advance(61000); await assert.rejects(f.sources.get(a, u.id), { code: 'UPLOAD_EXPIRED' });
  await f.sources.retire(a, u.id, 1); await assert.rejects(f.sources.get(a, u.id), { code: 'SOURCE_RETIRED' });
  assert.deepEqual(await f.metadata.list(a, 'secret'), []);
});
test('H3 policy rebinding is durable, revisioned and refuses unresolved schema', async t => {
  const f = await sourceFixture(t), a = await f.login(); await f.sources.create(a, 'bound', registration());
  const rev = await f.metadata.revisions(a);
  await f.sources.bind(a, 'bound', { expectedVersion: 1, policy: { rowLevel: true, rowRules: [] } });
  await assert.rejects(f.metadata.assertRevisions(a, rev), { code: 'METADATA_REVISED' });
  await assert.rejects(f.sources.bind(a, 'bound', { expectedVersion: 2, policy: { rowLevel: false, rowRules: [], protectedColumns: ['absent'] } }), { code: 'INVALID_SECURITY_POLICY' });
  await f.restart(); assert.equal((await f.sources.get(await f.login(), 'bound')).policy.rowLevel, true);
});
