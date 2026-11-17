import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { S3Client, GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { HostedData } from '../dist/hosted-data.js';
import { HostedPrep } from '../dist/hosted-prep.js';
import { sourceBody } from '../dist/source-schema.js';
import { authFixture } from './hosted-helpers.mjs';
import { fixture, config, registration, s3Environment, serving } from './source-s3-helpers.mjs';
const csv = Buffer.from('region,amount\nEast,2\nWest,3\n');
function sdk(t, handler) {
  const calls = [];
  t.mock.method(S3Client.prototype, 'send', async command => {
    calls.push(command);
    if (handler) return handler(command);
    if (command instanceof GetObjectCommand) return { Body: Readable.from([csv]), ContentLength: csv.length };
    if (command instanceof ListObjectsV2Command) return { Contents: [{ Key: config.key, Size: csv.length, ETag: 'ignored' }], IsTruncated: false };
    throw new Error('Unexpected command');
  });
  return calls;
}
const pipeline = input => ({ version: 1, input, steps: [{ id: 'sum', kind: 'aggregate', config: { groupBy: [], measures: [{ column: 'amount', name: 'total', aggregation: 'SUM' }] } }] });

test('S3 HTTP source creation and prefix browse feed a real prepared DuckDB dataset', async t => {
  const calls = sdk(t), f = await authFixture(t), environment = s3Environment(), call = await serving(t, f, environment);
  let token = (await f.login()).token;
  assert.ok((await call('/api/connectors', 'GET', undefined, token)).body.some(c => c.id === 's3'));
  assert.equal((await call('/api/connectors/s3/browse', 'POST', { config })).status, 401);
  const browse = await call('/api/connectors/s3/browse', 'POST', { config }, token);
  assert.equal(browse.status, 200, JSON.stringify(browse.body));
  assert.deepEqual(browse.body, [{ key: config.key, size: csv.length }]);
  const created = await call('/api/sources/s3-sales', 'PUT', registration(), token);
  assert.equal(created.status, 201, JSON.stringify(created.body)); assert.equal(created.body.connectorId, 's3'); assert.equal(created.body.rowCount, 2);
  token = (await f.login()).token;
  assert.equal((await call('/api/prep-sources', 'GET', undefined, token)).body[0].id, 's3-sales');
  const saved = await call('/api/datasets/s3-dataset/prep', 'PUT', { name: 'S3 dataset', pipeline: pipeline('s3-sales'), expectedVersion: 0 }, token);
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  const refreshed = await call('/api/datasets/s3-dataset/refresh', 'POST', {}, token);
  assert.equal(refreshed.status, 200, JSON.stringify(refreshed.body));
  const rows = await call('/api/datasets/s3-dataset/rows', 'GET', undefined, token);
  assert.equal(rows.status, 200, JSON.stringify(rows.body)); assert.deepEqual(rows.body.rows, [{ total: 5 }]);
  const records = await f.db.transaction(c => c.query("SELECT body FROM h1_resources WHERE kind = 'source' AND resource_id = 's3-sales'"));
  const stored = sourceBody(JSON.parse(records[0].body));
  assert.deepEqual(JSON.parse(JSON.stringify(stored.binding.s3Config)), config);
  for (const value of [environment.S3_ACCESS_KEY_ID, environment.S3_SECRET_ACCESS_KEY]) assert.equal(records[0].body.includes(value), false);
  assert.deepEqual(calls.map(c => c.constructor.name), ['ListObjectsV2Command', 'GetObjectCommand']);
});

test('S3 stored snapshots retain source identity and reject owner, tenant, policy and configuration bypasses', async t => {
  const calls = sdk(t), f = await fixture(t), a = await f.login(), data = new HostedData(f.sources, undefined, f.budgets), prep = new HostedPrep(data);
  for (const change of [{ config: { ...config, bucket: 'other-bucket' } }, { config: { ...config, accessKeyIdEnv: 'OTHER_KEY' } }, { credentials: { secretAccessKey: 'raw-value' } }, { policy: undefined }, { expiresAt: undefined }]) {
    await assert.rejects(data.createSource(a, 'invalid', { ...registration(), ...change }));
  }
  assert.equal(calls.length, 0);
  await data.createSource(a, 'source', registration());
  assert.deepEqual((await f.sources.get(a, 'source')).binding.s3Config, Object.assign(Object.create(null), config));
  for (const other of [await f.login('one', 'other'), await f.login('two', 'admin')]) {
    await assert.rejects(f.sources.get(other, 'source'), { code: 'RESOURCE_NOT_FOUND' });
    await assert.rejects(prep.save(other, 'foreign', { name: 'Foreign', pipeline: pipeline('source'), expectedVersion: 0 }));
  }
  await f.sources.bind(a, 'source', { expectedVersion: 1, policy: { rowLevel: true, rowRules: [] } });
  await assert.rejects(prep.save(a, 'denied', { name: 'Denied', pipeline: pipeline('source'), expectedVersion: 0 }), { code: 'PREP_SECURITY_REJECTED' });
  await assert.rejects(f.sources.bind(a, 'source', { expectedVersion: 2, table: 'forged' }), { code: 'SOURCE_BINDING_IMMUTABLE' });
  f.s3.configs = [];
  await assert.rejects(f.sources.get(a, 'source'), { code: 'SOURCE_ENDPOINT_DENIED' });
  assert.equal(calls.length, 1);
});
