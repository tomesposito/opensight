import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { S3Client, GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { hostedS3Settings, permittedS3Config } from '../dist/source-s3-config.js';
import { fixture, config, registration, grant } from './source-s3-helpers.mjs';
const csv = Buffer.from('region,amount\nEast,2\nWest,3\n');
function sdk(t) {
  const calls = [];
  t.mock.method(S3Client.prototype, 'send', async command => {
    calls.push(command);
    if (command instanceof GetObjectCommand) return { Body: Readable.from([csv]), ContentLength: csv.length };
    if (command instanceof ListObjectsV2Command) return { Contents: [{ Key: config.key, Size: csv.length }], IsTruncated: false };
    throw new Error('Unexpected command');
  });
  return calls;
}
const env = entries => ({ OPENSIGHT_S3_SOURCES: JSON.stringify(entries) });

test('S3 grant parsing rejects unscoped, malformed and legacy operator entries', () => {
  for (const entries of [
    [config], // legacy plain config: no tenant scope, must not stay valid
    [{ config }], // missing tenantIds
    [{ config, tenantIds: [] }], // empty tenant scope
    [{ config, tenantIds: ['tenant-one', 'tenant-one'] }], // duplicates
    [{ config, tenantIds: ['bad id!'] }], // not identifier-shaped
    [{ config, tenantIds: 'tenant-one' }], // not an array
    [{ config, tenantIds: ['tenant-one'], namespaceIds: [] }],
    [{ config, tenantIds: ['tenant-one'], userIds: [42] }],
    [{ config, tenantIds: ['tenant-one'], tenants: ['tenant-one'] }], // unknown key
    [{ tenantIds: ['tenant-one'] }], // missing config
    [{ config: { ...config, bucket: 'INVALID BUCKET' }, tenantIds: ['tenant-one'] }],
  ]) assert.throws(() => hostedS3Settings(env(entries)), { code: 'SOURCE_ENDPOINT_CONFIG_INVALID' }, JSON.stringify(entries));
  const parsed = hostedS3Settings(env([grant(['tenant-one'], { namespaceIds: ['one'], userIds: ['admin'] })]));
  assert.equal(parsed.grants.length, 1);
  assert.deepEqual(parsed.grants[0].tenantIds, ['tenant-one']);
  assert.deepEqual(parsed.grants[0].namespaceIds, ['one']);
  assert.deepEqual(parsed.grants[0].userIds, ['admin']);
  assert.deepEqual(JSON.parse(JSON.stringify(parsed.grants[0].config)), config);
});

test('S3 permitted config requires an exact config match inside the verified scope', () => {
  const settings = hostedS3Settings(env([grant(['tenant-one'], { namespaceIds: ['one'], userIds: ['admin'] })]));
  const scope = { tenantId: 'tenant-one', namespaceId: 'one', userId: 'admin' };
  assert.deepEqual(JSON.parse(JSON.stringify(permittedS3Config(config, settings, scope))), config);
  for (const bad of [
    { ...scope, tenantId: 'tenant-two' },
    { ...scope, namespaceId: 'two' },
    { ...scope, userId: 'other' },
  ]) assert.throws(() => permittedS3Config(config, settings, bad), { code: 'SOURCE_ENDPOINT_DENIED' });
  assert.throws(() => permittedS3Config({ ...config, bucket: 'other-bucket' }, settings, scope), { code: 'SOURCE_ENDPOINT_DENIED' });
  assert.throws(() => permittedS3Config({ ...config, key: 'data/other.csv' }, settings, scope), { code: 'SOURCE_ENDPOINT_DENIED' });
  // A tenant-only grant admits any namespace and principal of that tenant.
  const tenantOnly = hostedS3Settings(env([grant(['tenant-one'])]));
  assert.ok(permittedS3Config(config, tenantOnly, { tenantId: 'tenant-one', namespaceId: 'elsewhere', userId: 'anyone' }));
});

test('S3 two-tenant: tenant B cannot browse or ingest tenant A\'s granted config under a new source ID', async t => {
  const calls = sdk(t), f = await fixture(t);
  f.s3.grants = [grant(['tenant-one'])];
  const a = await f.login('one', 'admin'), b = await f.login('two', 'admin');
  await assert.rejects(f.sources.browseS3(b, { config }), { code: 'SOURCE_ENDPOINT_DENIED' });
  await assert.rejects(f.sources.create(b, 'tenant-b-copy', registration()), { code: 'SOURCE_ENDPOINT_DENIED' });
  assert.equal(calls.length, 0);
  // Tenant A, the grant's tenant, browses and ingests normally.
  assert.deepEqual(await f.sources.browseS3(a, { config }), [{ key: config.key, size: csv.length }]);
  await f.sources.create(a, 'tenant-a-source', registration());
  assert.equal(calls.length, 2);
  assert.deepEqual(JSON.parse(JSON.stringify((await f.sources.get(a, 'tenant-a-source')).binding.s3Config)), config);
  // Subsequent admission is grant-checked too: narrowing the grant to the
  // other tenant revokes the owner's stored source, not just new creates.
  f.s3.grants = [grant(['tenant-two'])];
  await assert.rejects(f.sources.get(a, 'tenant-a-source'), { code: 'SOURCE_ENDPOINT_DENIED' });
  await assert.rejects(f.sources.payload(a, { id: 'tenant-a-source', version: 1, binding: { version: 3, connectorId: 's3', s3Config: config, state: 'active', columns: [], rowCount: 0 }, secretId: 'unused' }), { code: 'SOURCE_ENDPOINT_DENIED' });
  assert.equal(calls.length, 2);
});

test('S3 principal-scoped grant denies other administrators in the same tenant before any SDK call', async t => {
  const calls = sdk(t), f = await fixture(t);
  f.s3.grants = [grant(['tenant-one', 'tenant-two'], { userIds: ['admin'] })];
  const other = await f.login('one', 'other');
  await assert.rejects(f.sources.browseS3(other, { config }), { code: 'SOURCE_ENDPOINT_DENIED' });
  await assert.rejects(f.sources.create(other, 'principal-denied', registration()), { code: 'SOURCE_ENDPOINT_DENIED' });
  assert.equal(calls.length, 0);
  const admin = await f.login('one', 'admin');
  assert.deepEqual(await f.sources.browseS3(admin, { config }), [{ key: config.key, size: csv.length }]);
  assert.equal(calls.length, 1);
});
