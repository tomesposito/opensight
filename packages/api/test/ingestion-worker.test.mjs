import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { directRequest, uploadFixture } from './serverless-upload-helpers.mjs';
import { IngestionWorker } from '../dist/ingestion-worker.js';
import { ArtifactTransfer } from '../dist/artifact-transfer.js';
import { InvocationScope } from '../dist/runtime-scope.js';
import { TenantBudgets } from '../dist/budgets.js';
import { MetadataError } from '../dist/metadata-db.js';
import { SourceArtifacts } from '../dist/source-artifacts.js';
import { HostedSources } from '../dist/hosted-sources.js';
import { HostedData } from '../dist/hosted-data.js';

const recheck = async () => {};
async function fixture(t) {
  const f = await uploadFixture(t), bytes = Buffer.from('name,value\none,1\n');
  const reserved = await f.uploads.reserve(f.contexts[0], directRequest(), randomUUID(), recheck);
  const op = await f.uploads.complete(f.contexts[0], reserved.id, { versionId: 'raw-version' }, randomUUID(), recheck);
  const envelope = f.events.find(e => e[0] === 'dispatch' && e[2].kind === 'ingest')[1], objects = new Map(), calls = [];
  const hooks = { beforePut: undefined, afterPut: undefined, raw: undefined }; let closed = 0;
  f.objects.bytes = async (scope, entry) => { await hooks.raw?.(); assert.equal(entry.version, 'raw-version'); scope.memory(bytes.length); return bytes; };
  const awsFor = scope => ({ scope, call: work => work(scope.signal), s3: { send: async command => {
      calls.push(command); const p = command.input;
      if (command.constructor.name === 'PutObjectCommand') {
        await hooks.beforePut?.(); assert.equal(p.IfNoneMatch, '*'); assert.equal(objects.has(p.Key), false);
        const chunks = []; for await (const b of p.Body) chunks.push(b); const data = Buffer.concat(chunks);
        assert.equal(data.length, p.ContentLength); assert.equal(createHash('sha256').update(data).digest('base64'), p.ChecksumSHA256);
        const stored = { bytes: data, VersionId: `version-${objects.size + 1}`, ContentLength: data.length, ContentType: p.ContentType, ChecksumSHA256: p.ChecksumSHA256, ServerSideEncryption: 'AES256' };
        objects.set(p.Key, stored); await hooks.afterPut?.(); return { VersionId: stored.VersionId, ChecksumSHA256: stored.ChecksumSHA256 };
      }
      const stored = objects.get(p.Key);
      if (!stored) { const error = Error('absent'); error.name = 'NotFound'; error.$metadata = { httpStatusCode: 404 }; throw error; }
      if (p.VersionId !== undefined) assert.equal(p.VersionId, stored.VersionId);
      return { ...stored, ...(command.constructor.name === 'GetObjectCommand' ? { Body: Readable.from([stored.bytes]) } : {}) };
    } } });
  const run = () => new InvocationScope(Date.now() + 60000).run(async scope => {
    const aws = awsFor(scope);
    const budgets = new TenantBudgets(f.budgets, c => f.metadata.assertContext(c));
    const worker = new IngestionWorker(f.db, f.metadata, f.coordinator, f.dispatch, f.ledger, f.objects,
      new ArtifactTransfer(aws, { bucket: 'synthetic-artifacts', prefix: 'artifacts/v1' }), budgets, async () => { closed++; }, 'sqlite');
    try { await worker.run(envelope, 55000); } finally { await budgets.shutdown(); }
  });
  const query = sourceId => new InvocationScope(Date.now() + 60000).run(async scope => {
    const context = f.contexts[0], attempt = await f.coordinator.admit(context, { attemptId: randomUUID(), class: 'query', revisions: await f.metadata.revisions(context), platformRemainingMs: 55000 });
    const budgets = new TenantBudgets(f.budgets, c => f.metadata.assertContext(c)), transfer = new ArtifactTransfer(awsFor(scope), { bucket: 'synthetic-artifacts', prefix: 'artifacts/v1' });
    const reader = new SourceArtifacts(f.coordinator, () => attempt, transfer, budgets, 'sqlite');
    const sources = new HostedSources(f.metadata, Buffer.alloc(32, 1).toString('base64'), [], Date.now, reader.read), data = new HostedData(sources, undefined, budgets);
    data.begin(context, scope.signal, async () => f.coordinator.publish(attempt, async () => {}));
    try { return await data.execute(context, sourceId, 'query', { query: { dimensions: [], measures: [{ fieldId: 'total', columnName: 'value', aggregation: 'SUM' }], filters: [] } }); }
    finally { await budgets.shutdown(); await f.coordinator.release(attempt); }
  });
  return { ...f, reserved, op, envelope, objects, calls, hooks, run, query, closed: () => closed };
}

test('SR2d native ingestion atomically publishes a durable source, object binding and status exactly once', async t => {
  const f = await fixture(t); await f.run(); await f.run();
  const state = await f.uploads.status(f.contexts[0], f.op.id, recheck); assert.equal(state.state, 'completed'); assert.ok(state.sourceId);
  const source = await f.metadata.get(f.contexts[0], { kind: 'source', id: state.sourceId, ownerId: f.contexts[0].userId });
  assert.equal(source.body.binding.version, 4); assert.equal(source.body.binding.rowCount, 1); assert.equal(source.body.secretId, undefined);
  assert.deepEqual(source.body.binding.columns, [{ name: 'name', type: 'STRING' }, { name: 'value', type: 'INTEGER' }]);
  const output = (await f.rows('sr_object')).find(o => o.purpose === 'source'); assert.equal(output.state, 'live'); assert.equal(output.object_id, source.body.binding.objectId);
  assert.equal(f.calls.filter(c => c.constructor.name === 'PutObjectCommand').length, 1); assert.equal(f.closed(), 1);
  assert.equal((await f.rows('sr_admission'))[0].state, 'released'); assert.equal((await f.rows('sr_outbox')).find(r => r.kind === 'ingest').state, 'terminal');
  assert.deepEqual((await f.rows('h8_usage')).filter(r => r.metric === 'computeAttempts'), [], 'upload is not charged as a refresh');
  assert.deepEqual((await f.query(state.sourceId)).rows, [{ total: 1 }], 'a fresh invocation hydrates and queries the durable source');
});

test('SR2d ambiguous completed PUT recovers its staged checksum/key without another PUT or duplicate source', async t => {
  const f = await fixture(t); f.hooks.afterPut = async () => { throw Error('lost receipt'); };
  await assert.rejects(f.run()); assert.equal((await f.uploads.status(f.contexts[0], f.op.id, recheck)).state, 'running');
  const staged = (await f.rows('sr_object')).find(o => o.purpose === 'source'); assert.equal(staged.state, 'reserved'); assert.ok(staged.descriptor); assert.ok(staged.checksum);
  f.hooks.afterPut = undefined; await f.run();
  const state = await f.uploads.status(f.contexts[0], f.op.id, recheck); assert.equal(state.state, 'completed');
  assert.equal(f.calls.filter(c => c.constructor.name === 'PutObjectCommand').length, 1); assert.equal((await f.rows('sr_operation'))[0].fence, 2);
  assert.equal((await f.rows('h1_resources')).filter(r => r.kind === 'source' && r.resource_id === state.sourceId).length, 1);
});

test('SR2d interrupted pre-PUT attempt reuses only its immutable reserved key and descriptor', async t => {
  const f = await fixture(t); f.hooks.beforePut = async () => { throw Error('interrupted before write'); };
  await assert.rejects(f.run()); assert.equal(f.objects.size, 0);
  f.hooks.beforePut = undefined; await f.run();
  assert.equal((await f.uploads.status(f.contexts[0], f.op.id, recheck)).state, 'completed');
  const puts = f.calls.filter(c => c.constructor.name === 'PutObjectCommand'); assert.equal(puts.length, 2); assert.equal(puts[0].input.Key, puts[1].input.Key);
});

test('SR2d cancellation or membership revocation during native-object publication cannot create a source', async t => {
  for (const revoke of [false, true]) {
    const f = await fixture(t), before = (await f.rows('h1_resources')).filter(r => r.kind === 'source').length;
    f.hooks.beforePut = async () => {
      if (revoke) await f.db.transaction(c => c.query("UPDATE h2_memberships SET status = 'removed' WHERE namespace_id = 'one'"));
      else await f.uploads.cancel(f.contexts[0], 'operation', f.op.id, { expectedRevision: 2 }, recheck);
    };
    await f.run(); assert.equal((await f.rows('h1_resources')).filter(r => r.kind === 'source').length, before);
    assert.equal((await f.rows('sr_operation'))[0].state, revoke ? 'failed' : 'cancelled');
    assert.equal((await f.rows('sr_object')).find(r => r.purpose === 'source').state, 'reserved');
    assert.equal((await f.rows('sr_admission'))[0].state, 'released');
  }
});

test('SR2d invalid raw bytes terminate with a named error and preserve storage cleanup obligations', async t => {
  const f = await fixture(t); f.hooks.raw = async () => { throw new MetadataError('UPLOAD_OBJECT_INVALID', 400); };
  await f.run(); const state = await f.uploads.status(f.contexts[0], f.op.id, recheck);
  assert.equal(state.state, 'failed'); assert.equal(state.errorCode, 'UPLOAD_OBJECT_INVALID'); assert.equal(f.objects.size, 0);
  assert.equal((await f.rows('sr_outbox')).filter(r => r.kind === 'object-cleanup').length, 2);
});
