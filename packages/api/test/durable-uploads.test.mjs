import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { MetadataError } from '../dist/metadata-db.js';
import { directRequest, uploadFixture } from './serverless-upload-helpers.mjs';
const recheck = async () => {};

test('SR2d upload reservation commits raw/output capacity and cleanup before exposing an expiring capability', async t => {
  const f = await uploadFixture(t), request = directRequest(), key = randomUUID();
  f.objects.capability = async (entry, until) => {
    assert.equal((await f.rows('sr_upload')).length, 1); assert.equal((await f.rows('sr_outbox')).length, 2);
    assert.equal((await f.rows('sr_dispatch_intent'))[0].state, 'committed');
    assert.ok(until > Date.now() && until <= Date.now() + 60000);
    return { url: 'https://synthetic.example/put', method: 'PUT', headers: {}, expiresAt: new Date(until).toISOString() };
  };
  const reserved = await f.uploads.reserve(f.contexts[0], request, key, recheck);
  assert.equal(reserved.state, 'reserved'); assert.ok(reserved.put.url); assert.equal(reserved.sourceId, undefined);
  const retry = await f.uploads.reserve(f.contexts[0], { ...request, policy: { rowRules: [], rowLevel: false } }, key, recheck);
  assert.equal(retry.id, reserved.id); assert.equal((await f.rows('sr_upload')).length, 1); assert.equal((await f.rows('sr_object')).length, 2);
  const read = await f.uploads.reservation(f.contexts[0], reserved.id, recheck); assert.equal(read.put, undefined); assert.equal(JSON.stringify(read).includes('https:'), false);
  await assert.rejects(f.uploads.reserve(f.contexts[0], { ...request, byteLength: request.byteLength + 1 }, key, recheck), { code: 'IDEMPOTENCY_CONFLICT' });
  await assert.rejects(f.uploads.reservation(f.contexts[1], reserved.id, recheck), { code: 'RESOURCE_NOT_FOUND' });
  const sourceObject = (await f.rows('sr_object')).find(o => o.purpose === 'source'); assert.match(sourceObject.object_key, /^artifacts\/v1\/[a-f0-9]{64}\/[a-f0-9-]{36}\.parquet$/);
});

test('SR2d exact-version completion accepts one operation/outbox across concurrent and differently keyed retries', async t => {
  const f = await uploadFixture(t), reserved = await f.uploads.reserve(f.contexts[0], directRequest(), randomUUID(), recheck), key = randomUUID();
  const [a, b] = await Promise.all([f.uploads.complete(f.contexts[0], reserved.id, { versionId: 'exact-version' }, key, recheck),
    f.uploads.complete(f.contexts[0], reserved.id, { versionId: 'exact-version' }, key, recheck)]);
  assert.equal(a.id, b.id); assert.equal(a.state, 'queued'); assert.equal(a.resultAvailable, false);
  const retry = await f.uploads.complete(f.contexts[0], reserved.id, { versionId: 'exact-version' }, randomUUID(), recheck); assert.equal(retry.id, a.id);
  assert.equal((await f.rows('sr_operation')).length, 1); assert.equal((await f.rows('sr_outbox')).filter(e => e.kind === 'ingest').length, 1);
  assert.equal((await f.uploads.reservation(f.contexts[0], reserved.id, recheck)).operationId, a.id);
  await assert.rejects(f.uploads.complete(f.contexts[0], reserved.id, { versionId: 'different-version' }, key, recheck), { code: 'UPLOAD_BINDING_CONFLICT' });
  await assert.rejects(f.uploads.status(f.contexts[1], a.id, recheck), { code: 'RESOURCE_NOT_FOUND' });
});

test('SR2d a failed HEAD, cancellation during HEAD and revoked session cannot accept ingestion', async t => {
  for (const failure of ['head', 'cancel', 'session']) {
    const f = await uploadFixture(t), reserved = await f.uploads.reserve(f.contexts[0], directRequest(), randomUUID(), recheck);
    let revoked = false;
    f.objects.head = async (entry, version) => {
      if (failure === 'head') throw new MetadataError('UPLOAD_OBJECT_INVALID', 400);
      if (failure === 'cancel') await f.uploads.cancel(f.contexts[0], 'reservation', reserved.id, { expectedRevision: 1 }, recheck);
      revoked = failure === 'session'; return { bytes: entry.capacityBytes, version, checksum: entry.checksum };
    };
    await assert.rejects(f.uploads.complete(f.contexts[0], reserved.id, { versionId: 'version' }, randomUUID(), async () => { if (revoked) throw new MetadataError('AUTHENTICATION_FAILED', 401); }));
    assert.deepEqual(await f.rows('sr_operation'), []); assert.equal((await f.rows('sr_outbox')).filter(e => e.kind === 'ingest').length, 0);
    assert.ok((await f.rows('sr_object')).every(r => r.state === 'reserved'));
  }
});

test('SR2d cancellation is owner/revision scoped, idempotent and retains cleanup/storage/admission obligations', async t => {
  const f = await uploadFixture(t), reserved = await f.uploads.reserve(f.contexts[0], directRequest(), randomUUID(), recheck);
  const op = await f.uploads.complete(f.contexts[0], reserved.id, { versionId: 'version' }, randomUUID(), recheck), before = await f.rows('sr_storage_usage');
  await assert.rejects(f.uploads.cancel(f.contexts[0], 'operation', op.id, { expectedRevision: 2 }, recheck), { code: 'OPERATION_CONFLICT' });
  const cancelled = await f.uploads.cancel(f.contexts[0], 'operation', op.id, { expectedRevision: 1 }, recheck); assert.equal(cancelled.state, 'cancelled');
  assert.deepEqual(await f.uploads.cancel(f.contexts[0], 'operation', op.id, { expectedRevision: 1 }, recheck), cancelled);
  assert.equal((await f.uploads.reservation(f.contexts[0], reserved.id, recheck)).state, 'cancelled');
  assert.deepEqual(await f.rows('sr_storage_usage'), before); assert.equal((await f.rows('sr_outbox')).filter(r => r.kind === 'object-cleanup').length, 2);
});

test('SR2d concurrent upload admission, explicit expiry and strict transfer declarations bound accepted obligations', async t => {
  const f = await uploadFixture(t), request = directRequest();
  for (const patch of [{ byteLength: 8 * 1024 * 1024 + 1 }, { sha256: 'wrong' }, { mediaType: 'application/json' }, { expiresAt: 'invalid' }, { policy: undefined }]) {
    await assert.rejects(f.uploads.reserve(f.contexts[0], { ...request, ...patch }, randomUUID(), recheck));
  }
  await assert.rejects(f.uploads.reserve(f.contexts[0], { ...request, expiresAt: '2000-01-01T00:00:00.000Z' }, randomUUID(), recheck), { code: 'UPLOAD_EXPIRY_REQUIRED' });
  const results = await Promise.allSettled(Array.from({ length: 3 }, () => f.uploads.reserve(f.contexts[0], request, randomUUID(), recheck)));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 2); assert.equal(results.find(r => r.status === 'rejected').reason.code, 'UPLOAD_ADMISSION_REFUSED');
  assert.equal((await f.rows('sr_upload')).length, 2); assert.equal((await f.rows('sr_object')).length, 4);
});

test('SR2d uncertain immediate dispatch preserves the accepted receipt and prearmed recovery', async t => {
  const f = await uploadFixture(t); f.transport.dispatch = async () => { throw Error('no receipt'); };
  const reserved = await f.uploads.reserve(f.contexts[0], directRequest(), randomUUID(), recheck);
  const op = await f.uploads.complete(f.contexts[0], reserved.id, { versionId: 'version' }, randomUUID(), recheck);
  assert.equal(op.state, 'queued'); assert.ok((await f.rows('sr_outbox')).every(r => r.state === 'pending'));
  f.transport.dispatch = async () => {};
  for (const [, envelope] of f.events.filter(e => e[0] === 'recover')) await f.dispatch.recover(envelope);
  assert.ok((await f.rows('sr_outbox')).every(r => r.state === 'dispatched'));
});
