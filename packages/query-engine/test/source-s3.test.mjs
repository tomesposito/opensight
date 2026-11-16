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

import * as XLSX from 'xlsx';
import { UploadStaging } from '@opensight/query-engine';
import { xlsxZip } from './upload-fixtures.mjs';
for (const format of ['csv', 'tsv', 'json', 'xls', 'xlsx']) test(`S3 ${format} shares upload parsing and DuckDB prep semantics`, async () => {
  let bytes;
  if (format === 'json') bytes = Buffer.from('[{"region":"East","amount":2},{"region":"West","amount":3}]');
  else if (format === 'xls' || format === 'xlsx') {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['region', 'amount'], ['East', 2], ['West', 3]]), 'Data');
    bytes = XLSX.write(workbook, { type: 'buffer', bookType: format });
  } else bytes = Buffer.from(`region${format === 'tsv' ? '\t' : ','}amount\nEast${format === 'tsv' ? '\t' : ','}2\nWest${format === 'tsv' ? '\t' : ','}3\n`);
  const f = fake(() => object(bytes)), request = await readS3Upload({ ...config, key: `data/sales.${format}` }, { format }, f.options);
  assert.deepEqual(parseUpload(request), parseUpload({ data: bytes, config: { format } }));
  const staging = await UploadStaging.create();
  try {
    const source = await staging.ingest(request);
    const result = await staging.previewPrep({ version: 1, input: source.id, steps: [{ id: 'total', kind: 'aggregate', config: { groupBy: [], measures: [{ column: 'amount', name: 'total', aggregation: 'SUM' }] } }] }, {});
    assert.deepEqual(result.rows, [{ total: 5 }]);
  } finally { staging.close(); }
});
for (const declared of [true, false]) test(`S3 workbook enforces the ${declared ? 'declared' : 'actual'} XLSX uncompressed-size ceiling (#221)`, async () => {
  const bytes = xlsxZip([{ data: Buffer.alloc(declared ? 1 : 16 * 1024 * 1024 + 1, 120), declaredSize: declared ? 16 * 1024 * 1024 + 1 : 1 }]);
  assert.ok(bytes.length < 8 * 1024 * 1024);
  const f = fake(() => object(bytes)), request = await readS3Upload(config, { format: 'xlsx' }, f.options);
  assert.throws(() => parseUpload(request), { code: 'UPLOAD_LIMIT_EXCEEDED' });
});
test('S3 uses the same invalid-format, schema and data errors as upload', async () => {
  for (const [format, bytes] of [['csv', 'a,b\n1'], ['json', '[{"a":1},{"b":2}]'], ['xlsx', 'a,b\n1,2']]) {
    const f = fake(() => object(bytes)), request = await readS3Upload(config, { format }, f.options);
    let expected; try { parseUpload({ config: { format }, data: Buffer.from(bytes) }); } catch (error) { expected = error.code; }
    assert.ok(expected); assert.throws(() => parseUpload(request), { code: expected });
  }
  const f = fake(() => { assert.fail('invalid config reached SDK'); });
  await assert.rejects(readS3Upload(config, { format: 'xml' }, f.options), { code: 'INVALID_CONNECTOR_CONFIG' });
  assert.equal(f.calls.length, 0);
});
test('S3 streamed overflow stops on the first over-limit chunk even without trustworthy ContentLength', async () => {
  for (const ContentLength of [undefined, 1]) {
    let pulled = 0, closed = 0;
    const f = fake(() => ({ ContentLength, Body: { async *[Symbol.asyncIterator]() { try { for (let i = 0; i < 12; i++) { pulled++; yield Buffer.alloc(1024 * 1024); } } finally { closed++; } } } }));
    await assert.rejects(readS3Upload(config, { format: 'csv' }, f.options), { code: 'UPLOAD_LIMIT_EXCEEDED' });
    assert.equal(pulled, 9); assert.equal(closed, 1); assert.equal(f.destroyed, 1);
  }
});
test('S3 rejects truncated, malformed or failed body streams without returning partial bytes', async () => {
  for (const handler of [() => ({}), () => ({ ...object('a\n1'), ContentLength: -1 }), () => ({ ...object('a\n1'), ContentLength: 2 }), () => ({ Body: Readable.from(['not bytes']) })]) {
    const f = fake(handler); await assert.rejects(readS3Upload(config, { format: 'csv' }, f.options), { code: 'S3_INVALID_RESPONSE' }); assert.equal(f.destroyed, 1);
  }
  const f = fake(() => ({ Body: { async *[Symbol.asyncIterator]() { yield Buffer.from('a\n1'); throw new Error('private transport detail'); } } }));
  await assert.rejects(readS3Upload(config, { format: 'csv' }, f.options), { code: 'S3_REQUEST_FAILED' });
});
test('S3 all configured environment values resolve explicitly and never use the default credential chain', async () => {
  for (const key of Object.keys(environment)) {
    for (const value of [undefined, '', 'bad\nvalue']) {
      const f = fake(() => assert.fail('missing env reached SDK'));
      await assert.rejects(readS3Upload(config, { format: 'csv' }, { ...f.options, environment: { ...environment, [key]: value } }), { code: 'CONNECTOR_NOT_CONFIGURED' });
      assert.equal(f.calls.length, 0);
    }
  }
  await assert.rejects(listS3Objects({ ...config, sessionTokenEnv: 'S3_TOKEN' }, { environment }), { code: 'CONNECTOR_NOT_CONFIGURED' });
  const token = randomBytes(12).toString('hex'); let settings;
  await readS3Upload({ ...config, sessionTokenEnv: 'S3_TOKEN' }, { format: 'csv' }, { environment: { ...environment, S3_TOKEN: token }, clientFactory(value) { settings = value; return { send: async () => object('a\n1'), destroy() {} }; } });
  assert.equal(settings.credentials.sessionToken, token);
});
test('S3 listings fail closed on page/count caps, cycles, invalid keys and malformed pagination', async () => {
  const runaway = fake((_command, _options) => ({ Contents: [], IsTruncated: true, NextContinuationToken: String(runaway.calls.length) }));
  await assert.rejects(listS3Objects(config, runaway.options), { code: 'S3_LIST_LIMIT_EXCEEDED' }); assert.equal(runaway.calls.length, 10);
  const count = fake(() => ({ Contents: Array.from({ length: 1001 }, (_, i) => ({ Key: `data/${i}`, Size: 1 })), IsTruncated: false }));
  await assert.rejects(listS3Objects(config, count.options), { code: 'S3_LIST_LIMIT_EXCEEDED' });
  for (const response of [
    { IsTruncated: true }, { IsTruncated: true, NextContinuationToken: 'cycle' }, { IsTruncated: false, NextContinuationToken: 'unexpected' }, {},
    ...[{ Key: 'outside.csv', Size: 1 }, { Key: 'data/a', Size: -1 }, { Key: 'data/a', Size: 1.5 }, { Key: 'data/a' }, { Key: 'data/\0', Size: 0 }].map(row => ({ Contents: [row], IsTruncated: false })),
    { Contents: [{ Key: 'data/a', Size: 1 }, { Key: 'data/a', Size: 1 }], IsTruncated: false },
  ]) {
    const f = fake(() => response); await assert.rejects(listS3Objects(config, f.options), { code: 'S3_INVALID_RESPONSE' }); assert.equal(f.destroyed, 1);
  }
  const empty = fake(() => ({ IsTruncated: false })); assert.deepEqual(await listS3Objects(config, empty.options), []);
});
test('S3 timeout and cancellation cover stalled SDK calls and body streams and close clients', async () => {
  for (const browse of [false, true]) {
    const f = fake(() => new Promise(() => {}));
    await assert.rejects(browse ? listS3Objects(config, { ...f.options, timeoutMs: 10 }) : readS3Upload(config, { format: 'csv' }, { ...f.options, timeoutMs: 10 }), { code: 'S3_TIMEOUT' });
    assert.equal(f.destroyed, 1);
  }
  let closed = 0;
  const stalled = fake(() => ({ Body: { [Symbol.asyncIterator]() { return { next: () => new Promise(() => {}) }; }, destroy() { closed++; } } }));
  await assert.rejects(readS3Upload(config, { format: 'csv' }, { ...stalled.options, timeoutMs: 10 }), { code: 'S3_TIMEOUT' }); assert.equal(closed, 1); assert.equal(stalled.destroyed, 1);
  const abort = new AbortController(), f = fake((_c, options) => { abort.abort(); assert.equal(options.abortSignal.aborted, true); return new Promise(() => {}); });
  await assert.rejects(readS3Upload(config, { format: 'csv' }, { ...f.options, signal: abort.signal }), { code: 'EXECUTION_CANCELLED' }); assert.equal(f.destroyed, 1);
  const before = fake(() => assert.fail('cancelled call reached SDK'));
  await assert.rejects(listS3Objects(config, { ...before.options, signal: abort.signal }), { code: 'EXECUTION_CANCELLED' }); assert.equal(before.calls.length, 0);
});
