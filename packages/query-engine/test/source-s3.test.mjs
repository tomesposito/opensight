import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import { GetObjectCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import { readS3Upload, listS3Objects, parseUpload } from '@opensight/query-engine';

const config = { regionEnv: 'S3_REGION', accessKeyIdEnv: 'S3_ACCESS_KEY_ID', secretAccessKeyEnv: 'S3_SECRET_ACCESS_KEY', bucket: 'example-bucket', key: 'data/sales.csv', prefix: 'data/' };
const environment = { S3_REGION: 'us-east-1', S3_ACCESS_KEY_ID: randomBytes(12).toString('hex'), S3_SECRET_ACCESS_KEY: randomBytes(24).toString('hex') };
function fake(handler) {
  const calls = []; let destroyed = 0;
  const options = { environment, clientFactory(settings) {
    assert.equal(settings.region, environment.S3_REGION);
    assert.deepEqual(settings.credentials, { accessKeyId: environment.S3_ACCESS_KEY_ID, secretAccessKey: environment.S3_SECRET_ACCESS_KEY });
    assert.equal(settings.ignoreConfiguredEndpointUrls, true);
    return { async send(command, options) { calls.push(command); return handler(command, options); }, destroy() { destroyed++; } };
  } };
  return { calls, options, get destroyed() { return destroyed; } };
}
const object = data => ({ Body: Readable.from([Buffer.from(data)]), ContentLength: Buffer.byteLength(data) });

test('S3 reads real SDK commands into the unchanged CSV upload parser', async () => {
  const f = fake(() => object('region,amount\nEast,2\nWest,3\n'));
  const request = await readS3Upload(config, { format: 'csv' }, f.options), parsed = parseUpload(request);
  assert.deepEqual(parsed.rows, [['East', 2], ['West', 3]]);
  assert.ok(f.calls[0] instanceof GetObjectCommand);
  assert.deepEqual(f.calls[0].input, { Bucket: config.bucket, Key: config.key });
  assert.equal(f.destroyed, 1);
});
test('S3 browse paginates keys and sizes only, never GetObject', async () => {
  const f = fake(command => command.input.ContinuationToken ? { Contents: [{ Key: 'data/b.csv', Size: 5, ETag: 'ignored' }], IsTruncated: false } : { Contents: [{ Key: 'data/a.csv', Size: 4, Body: 'not returned' }], IsTruncated: true, NextContinuationToken: 'next' });
  assert.deepEqual(await listS3Objects(config, f.options), [{ key: 'data/a.csv', size: 4 }, { key: 'data/b.csv', size: 5 }]);
  assert.ok(f.calls.every(c => c instanceof ListObjectsV2Command));
  assert.deepEqual(f.calls.map(c => c.input), [{ Bucket: config.bucket, Prefix: 'data/', MaxKeys: 100 }, { Bucket: config.bucket, Prefix: 'data/', MaxKeys: 100, ContinuationToken: 'next' }]);
  assert.equal(f.destroyed, 1);
});
test('S3 rejects declared oversize before pulling body bytes and destroys transport', async () => {
  let pulled = 0, closed = 0;
  const f = fake(() => ({ ContentLength: 8 * 1024 * 1024 + 1, Body: { async *[Symbol.asyncIterator]() { pulled++; yield Buffer.alloc(1); }, destroy() { closed++; } } }));
  await assert.rejects(readS3Upload(config, { format: 'csv' }, f.options), { code: 'UPLOAD_LIMIT_EXCEEDED' });
  assert.equal(pulled, 0); assert.equal(closed, 1); assert.equal(f.destroyed, 1);
});
test('S3 missing environment and raw SDK errors fail closed with sanitized names', async () => {
  const f = fake(() => { throw new Error('must not call'); });
  await assert.rejects(readS3Upload(config, { format: 'csv' }, { ...f.options, environment: {} }), { code: 'CONNECTOR_NOT_CONFIGURED' });
  assert.equal(f.calls.length, 0);
  for (const [name, code] of [['NoSuchKey', 'S3_OBJECT_NOT_FOUND'], ['NoSuchBucket', 'S3_BUCKET_NOT_FOUND'], ['AccessDenied', 'S3_ACCESS_DENIED'], ['InternalError', 'S3_REQUEST_FAILED']]) {
    const failed = fake(() => { throw Object.assign(new Error('private SDK detail'), { name }); });
    await assert.rejects(readS3Upload(config, { format: 'csv' }, failed.options), error => error.code === code && !error.message.includes('private'));
    assert.equal(failed.destroyed, 1);
  }
});
test('S3 real factory is exercised with a fake at S3Client.send, never network', async t => {
  t.mock.method(S3Client.prototype, 'send', async command => { assert.ok(command instanceof GetObjectCommand); return object('a\n1\n'); });
  assert.deepEqual(parseUpload(await readS3Upload(config, { format: 'csv' }, { environment })).rows, [[1]]);
});
