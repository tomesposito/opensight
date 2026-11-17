import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { HostedSources } from '../dist/hosted-sources.js';
import { HostedData } from '../dist/hosted-data.js';
import { sourceBody } from '../dist/source-schema.js';
import { hostedS3Settings } from '../dist/source-s3-config.js';
import { expireUploads } from '../dist/source-maintenance.js';
import { authFixture } from './hosted-helpers.mjs';
import { fixture, config, registration, serving } from './source-s3-helpers.mjs';
const csv = Buffer.from('region,amount\nEast,2\nWest,3\n');
const object = () => ({ Body: Readable.from([csv]), ContentLength: csv.length });

test('S3 HTTP preserves named SDK and size errors, hides raw messages and creates no partial source', async t => {
  let failure, calls = 0;
  t.mock.method(S3Client.prototype, 'send', async command => { calls++; assert.ok(command instanceof GetObjectCommand); if (failure) throw Object.assign(new Error('private SDK detail'), { name: failure }); return { Body: Readable.from([]), ContentLength: 8 * 1024 * 1024 + 1 }; });
  const f = await authFixture(t), call = await serving(t, f), token = (await f.login()).token;
  for (const [name, code] of [['NoSuchKey', 'S3_OBJECT_NOT_FOUND'], ['NoSuchBucket', 'S3_BUCKET_NOT_FOUND'], ['AccessDenied', 'S3_ACCESS_DENIED'], [undefined, 'UPLOAD_LIMIT_EXCEEDED']]) {
    failure = name;
    const result = await call('/api/sources/failure', 'PUT', registration(), token);
    assert.equal(result.status, 422); assert.deepEqual(result.body, { errorCode: code });
  }
  assert.equal(calls, 4);
  assert.equal((await f.db.transaction(c => c.query("SELECT * FROM h1_resources WHERE kind IN ('source','secret')"))).length, 0);
});
test('S3 HTTP missing credential environment fails before the SDK boundary', async t => {
  t.mock.method(S3Client.prototype, 'send', () => assert.fail('missing credentials reached SDK'));
  const f = await authFixture(t), call = await serving(t, f, { S3_REGION: 'us-east-1' }), token = (await f.login()).token;
  for (const [path, method, body] of [['/api/sources/unconfigured', 'PUT', registration()], ['/api/connectors/s3/browse', 'POST', { config }]]) {
    const result = await call(path, method, body, token);
    assert.equal(result.status, 422); assert.deepEqual(result.body, { errorCode: 'CONNECTOR_NOT_CONFIGURED' });
  }
});
test('S3 snapshots survive restart, expire on reads, and the sweep deletes only their encrypted rows', async t => {
  let calls = 0;
  t.mock.method(S3Client.prototype, 'send', async () => { calls++; return object(); });
  const f = await fixture(t), a = await f.login(), expiresAt = new Date(f.clock() + 1000).toISOString();
  await f.sources.create(a, 'expiring', { ...registration(), expiresAt });
  const secretId = (await f.sources.get(a, 'expiring')).secretId;
  await f.restart();
  const sources = new HostedSources(f.metadata, f.key, f.endpoints, f.clock, undefined, f.s3), current = await f.login();
  assert.deepEqual(JSON.parse(JSON.stringify((await sources.get(current, 'expiring')).binding.s3Config)), config);
  assert.deepEqual((await sources.payload(current, await sources.get(current, 'expiring'))).rows, [['East', 2], ['West', 3]]);
  f.advance(1001);
  await assert.rejects(sources.get(current, 'expiring'), { code: 'UPLOAD_EXPIRED' });
  await expireUploads(f.db, f.clock());
  const stored = await sources.stored(current, 'expiring'); assert.equal(stored.binding.state, 'expired'); assert.equal(stored.secretId, undefined);
  await assert.rejects(f.metadata.get(current, { kind: 'secret', id: secretId, ownerId: current.userId }), { code: 'RESOURCE_NOT_FOUND' });
  assert.equal(calls, 1);
});
test('S3 revocation during download and cancellation before commit cannot leave source metadata', async t => {
  const f = await fixture(t), a = await f.login();
  t.mock.method(S3Client.prototype, 'send', async () => {
    await f.db.transaction(c => c.query('UPDATE h1_revisions SET configuration = configuration + 1 WHERE tenant_id = ? AND namespace_id = ?', [a.tenantId, a.namespaceId]));
    return object();
  });
  await assert.rejects(f.sources.create(a, 'revoked', registration()), { code: 'METADATA_REVISED' });
  t.mock.method(S3Client.prototype, 'send', async () => object());
  const controller = new AbortController();
  await assert.rejects(f.sources.create(a, 'cancelled', registration(), async () => { controller.abort(); return { columns: [{ name: 'amount', type: 'INTEGER' }], rows: [[1]] }; }, controller.signal), { code: 'EXECUTION_CANCELLED' });
  assert.equal((await f.db.transaction(c => c.query("SELECT * FROM h1_resources WHERE kind IN ('source','secret')"))).length, 0);
});
test('S3 read and browse honor tenant work cancellation before further SDK calls', async t => {
  const f = await fixture(t), a = await f.login(), data = new HostedData(f.sources, undefined, f.budgets);
  let destroyed = 0;
  t.mock.method(S3Client.prototype, 'send', async (_command, options) => {
    // Cancellation of the admitted tenant scope must reach the SDK transport.
    f.budgets.current(a).cancel();
    assert.equal(options.abortSignal.aborted, true);
    return new Promise(() => {});
  });
  t.mock.method(S3Client.prototype, 'destroy', () => { destroyed++; });
  await assert.rejects(data.createSource(a, 'cancelled', registration()), { code: 'EXECUTION_CANCELLED' });
  await assert.rejects(data.browseS3(a, { config }), { code: 'EXECUTION_CANCELLED' });
  assert.equal(destroyed, 2);
});
test('S3 schemas reject forged snapshot shapes and operator allowlist errors', async t => {
  t.mock.method(S3Client.prototype, 'send', async () => object());
  const f = await fixture(t), a = await f.login(); await f.sources.create(a, 'source', registration());
  const source = await f.sources.get(a, 'source');
  for (const changes of [{ version: 4, objectId: 'forged' }, { s3Config: undefined }, { connectorId: 'file' }, { endpointId: 'forged' }, { table: 'forged' }, { rowCount: -1 }, { expiresAt: 'invalid' }]) {
    assert.throws(() => sourceBody({ binding: { ...source.binding, ...changes }, policy: source.policy, secretId: source.secretId }));
  }
  for (const raw of ['null', '{}', '[{}]', JSON.stringify(Array(257).fill(config)), '{']) assert.throws(() => hostedS3Settings({ OPENSIGHT_S3_SOURCES: raw }), { code: 'SOURCE_ENDPOINT_CONFIG_INVALID' });
  assert.deepEqual(hostedS3Settings({}).configs, []);
});
test('S3 build permission gates browsing and reading before any SDK call', async t => {
  t.mock.method(S3Client.prototype, 'send', () => assert.fail('reader reached SDK'));
  const f = await fixture(t);
  await f.db.transaction(c => c.query("UPDATE h1_resources SET body = ? WHERE kind = 'user' AND resource_id = 'other'", [JSON.stringify({ name: 'Other', role: 'reader' })]));
  const reader = await f.login('one', 'other');
  await assert.rejects(f.sources.create(reader, 'denied', registration()), { code: 'SOURCE_ACCESS_DENIED' });
  await assert.rejects(f.sources.browseS3(reader, { config }), { code: 'SOURCE_ACCESS_DENIED' });
  await assert.rejects(f.sources.create({ ...reader }, 'forged', registration()));
});
