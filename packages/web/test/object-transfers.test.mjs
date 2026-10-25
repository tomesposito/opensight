import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createApiClient } from '../build/test/api-client.js';
import { assembleResult } from '../build/test/object-transfers.js';
const capabilities = { directUploads: { version: 1, maxBytes: 8388608 }, resultChunks: { version: 1, maxBytes: 1048576, maxResultBytes: 4194304 }, controlJsonBytes: 1048576 };
const session = { id: 'author', namespaceId: 'workspace', tenantId: 'tenant', role: 'author', name: 'Synthetic author', capabilities };
const operation = () => ({ id: randomUUID(), revision: 1, kind: 'ingest', state: 'queued', expiresAt: new Date(Date.now() + 3600000).toISOString(), resultAvailable: false });
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
async function clientFixture(size = 8388608) {
  const calls = [], progress = [], op = operation(), expiresAt = new Date(Date.now() + 3600000).toISOString();
  const file = new File([Buffer.alloc(size, 65)], 'synthetic.csv', { type: 'text/csv' });
  let override;
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    if (override) { const value = await override(url, options); if (value) return value; }
    if (url.endsWith('/auth/login')) return Response.json({ token: 'synthetic.token', tenantId: 'tenant', expiresAt: Date.now() + 900000 });
    if (url.endsWith('/session')) return Response.json(session);
    if (url.endsWith('/reservations')) {
      const body = JSON.parse(options.body), id = randomUUID();
      assert.equal(body.byteLength, file.size); assert.deepEqual(body.policy, { rowLevel: false, rowRules: [] });
      assert.equal(body.sha256, createHash('sha256').update(Buffer.from(await file.arrayBuffer())).digest('base64'));
      assert.equal(body.expiresAt, expiresAt); assert.match(options.headers['Idempotency-Key'], /^[a-f0-9-]{36}$/);
      return Response.json({ id, revision: 1, state: 'reserved', expiresAt, sourceExpiresAt: expiresAt, put: { method: 'PUT',
        url: `https://s3.us-east-1.amazonaws.com/synthetic-bucket/objects/v1/${'a'.repeat(64)}/${id}?signature=synthetic`, expiresAt,
        headers: { 'content-length': String(file.size), 'content-type': 'text/csv', 'x-amz-checksum-sha256': body.sha256, 'if-none-match': '*', 'x-amz-server-side-encryption': 'AES256' } } });
    }
    if (url.startsWith('https://s3.')) {
      assert.equal(options.body, file); assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'error');
      assert.equal(options.headers.Authorization, undefined); assert.equal(options.headers.authorization, undefined); assert.equal(options.headers['content-length'], undefined);
      return new Response(null, { headers: { 'x-amz-version-id': 'synthetic-version' } });
    }
    if (url.endsWith('/complete')) { assert.deepEqual(JSON.parse(options.body), { versionId: 'synthetic-version' }); return Response.json(op, { status: 202 }); }
    assert.fail(`unexpected URL ${url}`);
  };
  const client = createApiClient('/api', fetcher);
  await client.login({ email: 'synthetic@example.test', password: 'synthetic', code: '123456' }, false);
  return { client, file, calls, progress, op, expiresAt, override: fn => { override = fn; }, upload: signal => client.uploadDirectFile(file, { format: 'csv' }, expiresAt, p => progress.push(p), signal) };
}
test('SR2d browser negotiates an 8 MiB direct upload and never forwards a bearer or forbidden length header to S3', async () => {
  const f = await clientFixture(); assert.deepEqual(await f.upload(), f.op);
  assert.deepEqual(f.progress.map(p => p.stage), ['hashing', 'reserving', 'uploading', 'accepting', 'accepted']);
  for (const call of f.calls.filter(c => c.url.endsWith('/reservations') || c.url.endsWith('/complete'))) assert.equal(call.options.headers.Authorization, 'Bearer synthetic.token');
  assert.equal(f.calls.filter(c => c.url.startsWith('https://s3.')).length, 1);
  f.client.clearSession(); assert.equal(f.client.getTransportCapabilities(), undefined);
  assert.throws(() => f.upload(), { errorCode: 'UPLOAD_TRANSPORT_REQUIRED' });
});
test('SR2d size, explicit expiry and JSON limits fail before transfer and a session change stops completion after PUT', async () => {
  const large = await clientFixture(8388609), before = large.calls.length;
  await assert.rejects(large.upload(), { errorCode: 'UPLOAD_LIMIT_EXCEEDED' }); assert.equal(large.calls.length, before);
  const f = await clientFixture(20);
  await assert.rejects(f.client.uploadDirectFile(f.file, { format: 'csv' }, '', () => {}), { errorCode: 'UPLOAD_EXPIRY_REQUIRED' });
  await assert.rejects(f.client.uploadFile({ config: { format: 'csv' }, base64: 'x'.repeat(1048576) }), { errorCode: 'CONTROL_PAYLOAD_TOO_LARGE' });
  f.override(async url => { if (url.startsWith('https://s3.')) f.client.clearSession(); });
  await assert.rejects(f.upload(), { errorCode: 'AUTH_REQUEST_SUPERSEDED' }); assert.ok(!f.calls.some(c => c.url.endsWith('/complete')));
});
test('SR2d missing S3 version or untrusted transfer headers cannot trigger ingestion; accepted reservation remains reviewable', async () => {
  const f = await clientFixture(20); f.override(async url => url.startsWith('https://s3.') ? new Response(null) : undefined);
  await assert.rejects(f.upload(), { errorCode: 'UPLOAD_VERSION_UNAVAILABLE' });
  assert.ok(f.progress.at(-1).reservation.id); assert.ok(!f.calls.some(c => c.url.endsWith('/complete')));
  const poisoned = await clientFixture(20);
  poisoned.override(async url => url.endsWith('/reservations') ? Response.json({ id: randomUUID(), revision: 1, state: 'reserved', expiresAt: poisoned.expiresAt, sourceExpiresAt: poisoned.expiresAt,
    put: { method: 'PUT', url: 'https://foreign.example/upload', expiresAt: poisoned.expiresAt, headers: { authorization: 'Bearer forbidden' } } }) : undefined);
  await assert.rejects(poisoned.upload(), { errorCode: 'TRANSFER_RESPONSE_INVALID' }); assert.ok(!poisoned.calls.some(c => c.url.startsWith('https:')));
});
function resultFixture() {
  const original = { rows: [{ value: 'a'.repeat(1100000) }] }, bytes = Buffer.from(JSON.stringify(original)), id = randomUUID(), expiresAt = new Date(Date.now() + 900000).toISOString();
  const chunks = [], responses = [];
  for (let offset = 0; offset < bytes.length; offset += 1048576) {
    const data = bytes.subarray(offset, offset + 1048576), chunk = { index: chunks.length, byteLength: data.length, sha256: sha(data) };
    chunks.push(chunk); responses.push({ ...chunk, operationId: id, revision: 2, expiresAt, data: data.toString('base64') });
  }
  const envelope = { operation: { id, revision: 2, state: 'completed', kind: 'result', expiresAt, resultAvailable: true,
    result: { version: 1, byteLength: bytes.length, sha256: sha(bytes), chunks } } };
  return { original, envelope, responses };
}
test('SR2d browser validates chunk order, lengths, hashes, whole digest and generation before publishing a result', async () => {
  const f = resultFixture(), calls = [];
  assert.deepEqual(await assembleResult(f.envelope, 4194304, async path => { calls.push(path); return f.responses[calls.length - 1]; }, () => {}), f.original);
  assert.equal(calls.length, 2);
  for (const tamper of [r => { r.index = 1; }, r => { r.byteLength--; }, r => { r.sha256 = 'b'.repeat(64); }, r => { r.data = Buffer.alloc(1048576).toString('base64'); }, r => { r.expiresAt = new Date(0).toISOString(); }]) {
    const f = resultFixture(); tamper(f.responses[0]); let index = 0;
    await assert.rejects(assembleResult(f.envelope, 4194304, async () => f.responses[index++], () => {}), { errorCode: 'TRANSFER_RESPONSE_INVALID' });
  }
  const revised = resultFixture(); let current = true, reads = 0;
  await assert.rejects(assembleResult(revised.envelope, 4194304, async () => { reads++; current = false; return revised.responses[0]; }, () => { if (!current) throw new Error('session changed'); }), /session changed/);
  assert.equal(reads, 1);
});

test('SR2d authoring client fetches chunks through the originating session and aborts publication after logout', async () => {
  const f = await clientFixture(20), r = resultFixture(), seen = [];
  f.override(async (url, options) => {
    if (url.endsWith('/rows')) return Response.json(r.envelope, { status: 202 });
    if (url.includes('/result/')) { seen.push(url); assert.equal(options.headers.Authorization, 'Bearer synthetic.token'); return Response.json(r.responses[Number(url.split('/').at(-1))]); }
  });
  assert.deepEqual(await f.client.getPreparedRows('dataset'), r.original); assert.equal(seen.length, 2);
  f.override(async url => {
    if (url.endsWith('/rows')) return Response.json(r.envelope, { status: 202 });
    if (url.includes('/result/')) { f.client.clearSession(); return Response.json(r.responses[0]); }
  });
  await assert.rejects(f.client.getPreparedRows('dataset'), { errorCode: 'AUTH_REQUEST_SUPERSEDED' });
});

test('#91 the hosted upload client preserves the quota explanation and sends no object bytes', async () => {
  const f = await clientFixture(16), summary = 'Storage limit 256 MiB exceeded: 248 MiB reserved. Eligible times are not a promise of deletion.';
  f.override(url => url.endsWith('/reservations') ? Response.json({ errorCode: 'USAGE_LIMIT_EXCEEDED', Message: summary }, { status: 429 }) : undefined);
  await assert.rejects(f.upload(), e => e.status === 429 && e.errorCode === 'USAGE_LIMIT_EXCEEDED' && e.message.includes(summary));
  assert.equal(f.calls.filter(c => c.url.startsWith('https://s3.')).length, 0);
});
