import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { UploadObjects } from '../dist/upload-objects.js';
import { InvocationAws } from '../dist/runtime-aws.js';
import { InvocationScope } from '../dist/runtime-scope.js';
import { TenantBudgets } from '../dist/budgets.js';
import { budgetConfig } from './budget-helpers.mjs';

function entry(bytes = Buffer.from('name,value\none,1\n'), now = Date.now()) {
  return { id: randomUUID(), key: `objects/v1/${'a'.repeat(64)}/${randomUUID()}`, purpose: 'raw-upload', state: 'reserved', capacityBytes: bytes.length,
    checksum: createHash('sha256').update(bytes).digest('base64'), mediaType: 'text/csv', createdAt: now, retentionUntil: now + 600000, signatureUntil: now + 60000 };
}
test('SR2d actual SDK presigning signs every upload constraint, never hoists required headers or calls a service', async () => {
  const now = Date.now(), invocation = new InvocationScope(now + 10000);
  await invocation.run(async () => {
    const aws = new InvocationAws(invocation, { AWS_REGION: 'us-east-1', AWS_ACCESS_KEY_ID: 'synthetic', AWS_SECRET_ACCESS_KEY: 'synthetic', AWS_SESSION_TOKEN: 'synthetic' });
    aws.s3.send = async () => assert.fail('presigning made a service call');
    const objects = new UploadObjects(aws, 'synthetic-uploads', () => now), e = entry(undefined, now);
    const capability = await objects.capability(e, now + 60000), url = new URL(capability.url);
    assert.equal(capability.method, 'PUT'); assert.equal(url.searchParams.get('X-Amz-Expires'), '60');
    assert.equal(url.pathname, `/synthetic-uploads/${e.key}`);
    assert.equal(url.searchParams.get('X-Amz-SignedHeaders'), 'content-length;content-type;host;if-none-match;x-amz-checksum-sha256;x-amz-server-side-encryption');
    assert.equal(capability.headers['content-length'], String(e.capacityBytes)); assert.equal(capability.headers['content-type'], 'text/csv');
    for (const name of Object.keys(capability.headers)) assert.equal(url.searchParams.has(name), false);
    for (const patch of [{ state: 'live' }, { signatureUntil: now }, { capacityBytes: 8 * 1024 * 1024 + 1 }, { key: 'other-owner/key' }, { checksum: 'bad' }]) await assert.rejects(objects.capability({ ...e, ...patch }, now + 60000));
    const smaller = await objects.capability(e, now + 15000); assert.equal(new URL(smaller.url).searchParams.get('X-Amz-Expires'), '15');
  });
});

test('SR2d HEAD/GET bind the exact version, signed constraints and bounded streaming digest', async () => {
  const bytes = Buffer.alloc(8 * 1024 * 1024, 97), e = { ...entry(bytes), state: 'live', version: 'version-one', bytes: bytes.length };
  const invocation = new InvocationScope(Date.now() + 20000), budgets = new TenantBudgets(budgetConfig, () => {}), context = { tenantId: 'synthetic' };
  await invocation.run(() => budgets.run(context, false, async () => {}, async () => {
    const work = budgets.current(context); let patch = {};
    const aws = { scope: invocation, region: 'us-east-1', call: fn => fn(invocation.signal), s3: { send: async command => {
      assert.equal(command.input.Key, e.key); assert.equal(command.input.VersionId, e.version); assert.equal(command.input.ChecksumMode, 'ENABLED');
      return { VersionId: e.version, ContentLength: bytes.length, ContentType: e.mediaType, ChecksumSHA256: e.checksum, ServerSideEncryption: 'AES256', ...patch,
        ...(command.constructor.name === 'GetObjectCommand' ? { Body: Readable.from([bytes]) } : {}) };
    } } };
    const objects = new UploadObjects(aws, 'synthetic-uploads');
    assert.deepEqual(await objects.head(e, e.version), { version: e.version, bytes: bytes.length, checksum: e.checksum });
    assert.deepEqual(await objects.bytes(work, e), bytes);
    for (const change of [{ VersionId: 'other' }, { ContentLength: 1 }, { ContentType: 'application/json' }, { ChecksumSHA256: 'wrong' }, { ServerSideEncryption: 'aws:kms' }, { DeleteMarker: true }, { ContentRange: 'bytes 1-2/3' }]) {
      patch = change; await assert.rejects(objects.head(e, e.version), { code: 'UPLOAD_OBJECT_INVALID' });
    }
  }));
});

test('SR2d streaming corruption/truncation/overflow closes the body and returns no file bytes', async () => {
  for (const stream of [Buffer.from('short'), Buffer.from('corrupt-data'), Buffer.alloc(100)]) {
    const bytes = Buffer.from('correct-data'), e = { ...entry(bytes), state: 'live', version: 'v1', bytes: bytes.length };
    const invocation = new InvocationScope(Date.now() + 10000), budgets = new TenantBudgets(budgetConfig, () => {}), ctx = { tenantId: 'synthetic' };
    await invocation.run(() => budgets.run(ctx, false, async () => {}, async () => {
      const body = Readable.from([stream]), aws = { scope: invocation, call: fn => fn(invocation.signal), s3: { send: async () => ({ Body: body, VersionId: e.version,
        ContentLength: e.capacityBytes, ContentType: e.mediaType, ChecksumSHA256: e.checksum, ServerSideEncryption: 'AES256' }) } };
      await assert.rejects(new UploadObjects(aws, 'synthetic-uploads').bytes(budgets.current(ctx), e), { code: 'UPLOAD_OBJECT_INVALID' });
      assert.equal(body.destroyed, true);
    }));
  }
});
