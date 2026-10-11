import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { ArtifactTransfer } from '../dist/artifact-transfer.js';
import { artifactDescriptor } from '../dist/artifact-schema.js';
import { BlazeTable } from '../dist/blaze.js';
import { TenantBudgets, WorkScope } from '../dist/budgets.js';
import { InvocationScope } from '../dist/runtime-scope.js';
import { budgetConfig } from './budget-helpers.mjs';

const limits = { encodedBytes: 1048576, decodedBytes: 1048576, rows: 1000, columns: 256, cellChars: 16384 };
const identity = { tenant: 'tenant', namespace: 'ns', owner: 'owner', kind: 'source', resource: 'same-id' };
const columns = [{ name: 'text 🛰', type: 'STRING' }, { name: 'integer', type: 'INTEGER' }, { name: 'decimal', type: 'DECIMAL' }, { name: 'date', type: 'DATETIME' }, { name: 'flag', type: 'BOOLEAN' }];
const rows = [['α\n\0😀', '9223372036854775807', 0.125, '2026-10-10T10:00:00.123+02:00', true],
  ['', -42, '123456789012345678901234567890', '2020-01-01 00:00:00', false],
  [null, null, null, null, null], ['last', 0, -0, '', null]];
const provenance = [{ datasetId: 'upstream', refreshedAt: '2026-10-09T12:00:00.000Z' }];
const table = (data = rows, schema = columns) => {
  const t = new BlazeTable({ maxBytes: limits.decodedBytes, datasetBytes: limits.decodedBytes, maxRows: limits.rows, cellChars: limits.cellChars });
  t.start(schema); t.setCachedInputs(provenance); for (const row of data) t.row(row); return t;
};
async function runtime(work) {
  const invocation = new InvocationScope(Date.now() + 60000), budgets = new TenantBudgets(budgetConfig, () => {}), context = { tenantId: 'tenant' };
  return invocation.run(() => budgets.run(context, false, async () => {}, () => work(budgets.current(context), invocation)));
}
function fakeAws(invocation) {
  const objects = new Map(), calls = [];
  const aws = { scope: invocation, call: work => invocation.stage(() => work(invocation.signal), 6000, () => invocation.controller.abort()), s3: { send: async command => {
    calls.push(command); const p = command.input;
    if (command.constructor.name === 'PutObjectCommand') {
      const chunks = []; for await (const chunk of p.Body) chunks.push(chunk);
      const bytes = Buffer.concat(chunks), version = `version-${objects.size + 1}`;
      assert.equal(p.IfNoneMatch, '*'); assert.equal(p.ContentLength, bytes.length);
      assert.equal(p.ChecksumSHA256, createHash('sha256').update(bytes).digest('base64'));
      objects.set(p.Key, { bytes, VersionId: version, ContentLength: bytes.length, ContentType: p.ContentType, ChecksumSHA256: p.ChecksumSHA256 });
      return { VersionId: version, ChecksumSHA256: p.ChecksumSHA256 };
    }
    const object = objects.get(p.Key); assert.ok(object); assert.equal(p.VersionId, object.VersionId); assert.equal(p.ChecksumMode, 'ENABLED');
    return { ...object, ...(command.constructor.name === 'GetObjectCommand' ? { Body: Readable.from([object.bytes]) } : {}) };
  } } };
  return { aws, calls, objects, transfer: new ArtifactTransfer(aws, { bucket: 'synthetic-artifacts', prefix: 'artifacts/v1' }) };
}

test('SR2b contained Parquet round trip preserves scalar types, order, provenance and empty tables', async () => {
  let root;
  await runtime(async (scope, invocation) => {
    const codec = new ArtifactTransfer(), input = table(), handle = await codec.encode(scope, input, limits);
    root = await invocation.temporaryDirectory();
    assert.equal((await stat(join(root, (await readdir(root))[0], 'data.parquet'))).mode & 0o777, 0o600);
    assert.equal(handle.descriptor.format, 'opensight-parquet-v1'); assert.ok(Object.isFrozen(handle.descriptor.columns[0]));
    const restored = await codec.decode(scope, handle, limits);
    assert.deepEqual(restored.rows(), input.rows()); assert.equal(restored.bytes, input.bytes);
    assert.ok(Object.is(restored.value(3, 2), -0)); assert.deepEqual(restored.cachedInputs, provenance);
    const empty = await codec.encode(scope, table([]), limits); assert.equal((await codec.decode(scope, empty, limits)).rowCount, 0);
    await handle.close(); await handle.close(); await assert.rejects(codec.decode(scope, handle, limits), { code: 'ARTIFACT_HANDLE_INVALID' });
  });
  await assert.rejects(stat(root), { code: 'ENOENT' });
});

test('SR2b local handles are branded and invocation-bound; changed file digest is rejected before decode', async () => {
  assert.throws(() => new ArtifactTransfer(), { code: 'ARTIFACT_SCOPE_REQUIRED' });
  let oldCodec, oldHandle;
  await runtime(async (scope, invocation) => {
    const codec = new ArtifactTransfer(), handle = await codec.encode(scope, table(), limits); oldCodec = codec; oldHandle = handle;
    await assert.rejects(codec.decode(scope, { ...handle }, limits), { code: 'ARTIFACT_HANDLE_INVALID' });
    await assert.rejects(new ArtifactTransfer().decode(scope, handle, limits), { code: 'ARTIFACT_HANDLE_INVALID' });
    const root = await invocation.temporaryDirectory(), path = join(root, (await readdir(root))[0], 'data.parquet');
    const data = await readFile(path); data[10] ^= 1; await writeFile(path, data);
    await assert.rejects(codec.decode(scope, handle, limits), { code: 'ARTIFACT_INVALID' });
  });
  await runtime(async scope => assert.rejects(oldCodec.decode(scope, oldHandle, limits), { code: 'ARTIFACT_SCOPE_REQUIRED' }));
});

test('SR2b codec rejects row, column, text, encoded and decoded bounds and invalid scalar/schema/provenance', async () => {
  await runtime(async (scope, invocation) => {
    const codec = new ArtifactTransfer();
    for (const patch of [{ rows: 1 }, { columns: 1 }, { cellChars: 1 }, { encodedBytes: 10 }, { decodedBytes: 256 }]) {
      await assert.rejects(codec.encode(scope, table(), { ...limits, ...patch }));
    }
    for (const bad of [NaN, Infinity, {}, 1.5]) {
      const t = table([[bad]], [{ name: 'n', type: 'INTEGER' }]); await assert.rejects(codec.encode(scope, t, limits), { code: 'ARTIFACT_INVALID' });
    }
    const duplicate = table([[1, 2]], [{ name: 'n', type: 'INTEGER' }, { name: 'n', type: 'INTEGER' }]);
    await assert.rejects(codec.encode(scope, duplicate, limits), { code: 'ARTIFACT_INVALID' });
    const t = table(); t.cachedInputs[0].refreshedAt = '2026-02-30T00:00:00.000Z';
    await assert.rejects(codec.encode(scope, t, limits), { code: 'ARTIFACT_INVALID' });
    await assert.rejects(codec.encode(scope, table(), { ...limits, columns: 257 }), { code: 'ARTIFACT_LIMIT_INVALID' });
    assert.deepEqual(await readdir(await invocation.temporaryDirectory()), []);
  });
});

test('SR2b S3 protocol uses conditional checksummed writes and exact-version HEAD/GET with scope-specific keys', async () => {
  await runtime(async (scope, invocation) => {
    const { transfer, calls } = fakeAws(invocation), local = await transfer.encode(scope, table(), limits);
    const first = await transfer.upload(scope, identity, local), second = await transfer.upload(scope, { ...identity, owner: 'other' }, local);
    assert.notEqual(first.key.split('/')[2], second.key.split('/')[2]); assert.notEqual(first.key, second.key);
    const downloaded = await transfer.download(scope, identity, first, limits);
    assert.deepEqual((await transfer.decode(scope, downloaded, limits)).rows(), table().rows());
    assert.deepEqual(calls.map(c => c.constructor.name), ['PutObjectCommand', 'HeadObjectCommand', 'PutObjectCommand', 'HeadObjectCommand', 'GetObjectCommand']);
    const count = calls.length;
    for (const ref of [{ ...first, identity: { ...identity, namespace: 'other' } }, { ...first, key: first.key.replace('/v1/', '/v2/') },
      { ...first, version: 'null' }, { ...first, bucket: 'elsewhere' }, { ...first, descriptor: { ...first.descriptor, encodedBytes: limits.encodedBytes + 1 } }]) {
      await assert.rejects(transfer.download(scope, identity, ref, limits), { code: 'ARTIFACT_INVALID' });
    }
    await assert.rejects(transfer.download(scope, { ...identity, tenant: 'other' }, first, limits), { code: 'ARTIFACT_INVALID' });
    assert.equal(calls.length, count, 'invalid references cannot touch S3');
    const mutable = structuredClone(first), pending = transfer.download(scope, identity, mutable, limits);
    mutable.descriptor.columns[0].name = 'changed'; mutable.identity.owner = 'changed'; mutable.key = 'changed';
    const snapshot = await pending; assert.deepEqual(snapshot.descriptor.columns, columns);
  });
});

test('SR2b descriptor row/decoded-byte mismatch cannot publish a hydrated table', async () => {
  await runtime(async (scope, invocation) => {
    const { transfer } = fakeAws(invocation), local = await transfer.encode(scope, table(), limits), ref = await transfer.upload(scope, identity, local);
    for (const patch of [{ rowCount: rows.length + 1 }, { decodedBytes: ref.descriptor.decodedBytes + 1 }]) {
      const downloaded = await transfer.download(scope, identity, { ...ref, descriptor: { ...ref.descriptor, ...patch } }, limits);
      await assert.rejects(transfer.decode(scope, downloaded, limits), { code: 'ARTIFACT_INVALID' }); await downloaded.close();
    }
  });
});

test('SR2b cancellation destroys an active object body and removes the partial download', async () => {
  let body;
  await assert.rejects(runtime(async (scope, invocation) => {
    const { transfer, aws } = fakeAws(invocation), local = await transfer.encode(scope, table(), limits), ref = await transfer.upload(scope, identity, local);
    const root = await invocation.temporaryDirectory(), baseline = await readdir(root), send = aws.s3.send;
    aws.s3.send = async command => {
      const response = await send(command); response.Body.destroy();
      body = new Readable({ read() { scope.cancel(); } }); return { ...response, Body: body };
    };
    await assert.rejects(transfer.download(scope, identity, ref, limits), { code: 'EXECUTION_CANCELLED' });
    assert.equal(body.destroyed, true); assert.equal(body.closed, true); assert.deepEqual(await readdir(root), baseline);
  }), { code: 'EXECUTION_CANCELLED' });
});

test('SR2b S3 rejects wrong headers, truncated/extra/corrupt streams and invalid Parquet without retaining partial files', async () => {
  await runtime(async (scope, invocation) => {
    const { transfer, aws } = fakeAws(invocation), local = await transfer.encode(scope, table(), limits), reference = await transfer.upload(scope, identity, local);
    const send = aws.s3.send, root = await invocation.temporaryDirectory(), baseline = await readdir(root);
    const changes = [r => ({ ...r, VersionId: 'other' }), r => ({ ...r, ContentLength: r.ContentLength + 1 }), r => ({ ...r, ChecksumSHA256: 'bad' }),
      r => ({ ...r, ContentType: 'text/plain' }), r => ({ ...r, ContentRange: 'bytes 0-1/2' }),
      r => ({ ...r, Body: Readable.from([r.bytes.subarray(1)]) }), r => ({ ...r, Body: Readable.from([r.bytes, Buffer.from('surplus')]) }),
      r => ({ ...r, Body: Readable.from([Buffer.alloc(r.bytes.length)]) })];
    for (const change of changes) {
      aws.s3.send = async command => { const response = await send(command); response.Body.destroy(); return change({ ...response, Body: Readable.from([response.bytes]) }); };
      await assert.rejects(transfer.download(scope, identity, reference, limits), { code: 'ARTIFACT_INVALID' });
      assert.deepEqual(await readdir(root), baseline);
    }
    const bad = Buffer.from('synthetic invalid parquet'), descriptor = { ...reference.descriptor, encodedBytes: bad.length, sha256: createHash('sha256').update(bad).digest('hex') };
    aws.s3.send = async () => ({ VersionId: reference.version, ContentType: 'application/vnd.apache.parquet', ContentLength: bad.length,
      ChecksumSHA256: Buffer.from(descriptor.sha256, 'hex').toString('base64'), Body: Readable.from([bad]) });
    const corrupt = await transfer.download(scope, identity, { ...reference, descriptor }, limits);
    await assert.rejects(transfer.decode(scope, corrupt, limits)); await corrupt.close();
    assert.deepEqual(await readdir(root), baseline);
  });
});

test('SR2b ambiguous PUT and unversioned response are never retried or deleted', async () => {
  await runtime(async (scope, invocation) => {
    const { transfer, aws } = fakeAws(invocation), local = await transfer.encode(scope, table(), limits); let count = 0;
    aws.s3.send = async () => { count++; throw new Error('private upstream details'); };
    await assert.rejects(transfer.upload(scope, identity, local), { code: 'ARTIFACT_UNAVAILABLE', message: 'ARTIFACT_UNAVAILABLE' }); assert.equal(count, 1);
    aws.s3.send = async () => { count++; return { VersionId: 'null' }; };
    await assert.rejects(transfer.upload(scope, identity, local), { code: 'ARTIFACT_INVALID' }); assert.equal(count, 2);
  });
});

test('SR2b cancellation reaps the native worker and deletes its output directory', async t => {
  await assert.rejects(runtime(async (scope, invocation) => {
    const codec = new ArtifactTransfer(), original = WorkScope.prototype.workerStarted;
    t.mock.method(WorkScope.prototype, 'workerStarted', function () { original.call(this); this.cancel(); });
    const root = await invocation.temporaryDirectory();
    await assert.rejects(codec.encode(scope, table(), limits), { code: 'EXECUTION_CANCELLED' });
    assert.deepEqual(await readdir(root), []);
  }), { code: 'EXECUTION_CANCELLED' });
});

test('SR2b descriptors require exact, bounded framing before transfer or native decode', () => {
  const value = { format: 'opensight-parquet-v1', columns, rowCount: 1, decodedBytes: 1000, encodedBytes: 1000, sha256: 'a'.repeat(64), cachedInputs: provenance };
  assert.deepEqual(artifactDescriptor(value, limits), value);
  for (const patch of [{ rowCount: -1 }, { decodedBytes: NaN }, { sha256: '../file' }, { format: 'parquet' }, { extra: true }, { cachedInputs: Array(257).fill(provenance[0]) }]) {
    assert.throws(() => artifactDescriptor({ ...value, ...patch }, limits), { code: 'ARTIFACT_INVALID' });
  }
});

test('SR2d planned writes expose the exact cleanup key before PUT and cannot be forged, redirected or reused', async () => {
  await runtime(async (scope, invocation) => {
    const { transfer, calls } = fakeAws(invocation), local = await transfer.encode(scope, table(), limits);
    const plan = transfer.planWrite(scope, identity, local);
    assert.ok(Object.isFrozen(plan)); assert.ok(Object.isFrozen(plan.identity)); assert.equal(calls.length, 0);
    await assert.rejects(transfer.upload(scope, identity, local, { ...plan }), { code: 'ARTIFACT_WRITE_HANDLE_INVALID' });
    await assert.rejects(transfer.upload(scope, { ...identity, owner: 'other' }, local, plan), { code: 'ARTIFACT_WRITE_HANDLE_INVALID' });
    const reference = await transfer.upload(scope, identity, local, plan);
    assert.equal(reference.key, plan.key); assert.equal(calls[0].input.Key, plan.key); assert.equal(calls[0].input.ServerSideEncryption, 'AES256');
    await assert.rejects(transfer.upload(scope, identity, local, plan), { code: 'ARTIFACT_WRITE_HANDLE_INVALID' });
    assert.equal(calls.filter(c => c.constructor.name === 'PutObjectCommand').length, 1);
    await local.close();
  });
});
