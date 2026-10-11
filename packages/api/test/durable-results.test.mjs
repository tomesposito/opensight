import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { DurableResults } from '../dist/durable-results.js';
import { ResultObjects } from '../dist/result-objects.js';
import { ServerlessWork } from '../dist/serverless-work.js';
import { HostedData } from '../dist/hosted-data.js';
import { TenantBudgets } from '../dist/budgets.js';
import { InvocationScope } from '../dist/runtime-scope.js';
import { MetadataError } from '../dist/metadata-db.js';
import { uploadFixture } from './serverless-upload-helpers.mjs';
import { objectStorage } from './manifest-helpers.mjs';
import { budgetConfig } from './budget-helpers.mjs';
const body = { columns: [{ name: 'text', type: 'STRING' }], rows: Array.from({ length: 1400 }, () => ({ text: 'a'.repeat(1000) })) };
const reader = () => ({ kind: 'author', id: 'synthetic-session-one', expiresAt: Date.now() + 600000 });
async function fixture(t) {
  const budgets = structuredClone(budgetConfig); budgets.defaults.resultBytes = budgets.node.resultBytes = 3 * 1024 * 1024;
  const f = await uploadFixture(t, { budgets }), bytes = new Map();
  const objects = { beforeRead: undefined, beforeWrite: undefined, write: async (_scope, entry, chunk) => {
    await objects.beforeWrite?.(); assert.equal(entry.state, 'reserved');
    const stored = Buffer.from(chunk); bytes.set(entry.id, stored);
    return { version: `version-${entry.id}`, bytes: stored.length, checksum: createHash('sha256').update(stored).digest('base64') };
  }, read: async entry => { await objects.beforeRead?.(); return bytes.get(entry.id); } };
  const storage = objectStorage();
  const invoke = run => new InvocationScope(Date.now() + 28000).run(async scope => {
    const budgets = new TenantBudgets(f.budgets, c => f.metadata.assertContext(c));
    const work = new ServerlessWork(f.coordinator, f.manifests, f.dispatch, f.ledger, storage.transfer(scope), budgets, scope, async () => {});
    const data = new HostedData(f.sources, undefined, budgets, work.cache, work), context = f.contexts[0]; data.begin(context);
    const results = new DurableResults(f.db, f.metadata, f.dispatch, f.ledger, objects, work, budgets, 'sqlite');
    try { return await run({ work, data, context, results }); } finally { await work.finish(); }
  });
  const publish = async (session, mode = 'DIRECT_QUERY') => invoke(async ({ data, context, results }) => {
    await data.execute(context, f.target().id, 'query', { mode, query: { dimensions: [], measures: [{ fieldId: 'total', columnName: 'amount', aggregation: 'SUM' }], filters: [] } });
    return results.publish(context, body, session, async () => {});
  });
  return { ...f, bytes, objects, invoke, publish };
}
test('SR2d result chunks survive invocation teardown and reassemble the exact bounded JSON', async t => {
  const f = await fixture(t), session = reader(), response = await f.publish(session);
  assert.equal(response.status, 202); const operation = response.body.operation;
  assert.equal(operation.result.chunks.length, 2);
  assert.ok(operation.result.chunks.every(c => c.byteLength <= 1048576));
  assert.equal(Date.parse(operation.expiresAt), session.expiresAt);
  assert.ok((await f.rows('sr_object')).every(r => r.state === 'live'));
  assert.equal((await f.rows('sr_outbox')).filter(r => r.kind === 'object-cleanup').length, 2);
  const parts = [];
  for (const chunk of operation.result.chunks) parts.push(await f.invoke(async ({ results, context }) => {
    const response = await results.chunk(context, operation.id, chunk.index, session, async () => {});
    assert.equal(response.sha256, chunk.sha256); return Buffer.from(response.data, 'base64');
  }));
  const bytes = Buffer.concat(parts);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), operation.result.sha256); assert.deepEqual(JSON.parse(bytes), body);
  assert.equal((await f.rows('sr_admission')).length, 1, 'chunk reads do not reserve native compute');
});
test('SR2d result reads reject another session, another owner, expiry and revocation during object I/O', async t => {
  const f = await fixture(t), session = reader(), response = await f.publish(session), id = response.body.operation.id;
  await f.invoke(async ({ results, context }) => {
    await assert.rejects(results.chunk(context, id, 0, { ...session, id: 'synthetic-session-two' }, async () => {}), { code: 'RESULT_SESSION_DENIED' });
    await assert.rejects(results.chunk(f.contexts[1], id, 0, session, async () => {}), { code: 'RESOURCE_NOT_FOUND' });
    await assert.rejects(results.chunk(context, id, 99, session, async () => {}), { code: 'RESOURCE_NOT_FOUND' });
    f.objects.beforeRead = () => f.db.transaction(c => c.query('UPDATE h1_revisions SET policy = policy + 1 WHERE tenant_id = ?', [context.tenantId]));
    await assert.rejects(results.chunk(context, id, 0, session, async () => {}), { code: 'METADATA_REVISED' });
  });
  const next = await fixture(t), saved = await next.publish(session);
  await next.db.transaction(c => c.query('UPDATE sr_operation SET expires_at = ?', [Date.now() - 1]));
  await next.invoke(({ results, context }) => assert.rejects(results.chunk(context, saved.body.operation.id, 0, session, async () => {}), { code: 'RESULT_EXPIRED' }));
});
test('SR2d cached result retains full dependency certificate and rejects a replaced generation', async t => {
  const f = await fixture(t), session = reader();
  await f.invoke(({ data, context }) => data.refresh(context, f.target().id));
  const response = await f.publish(session, 'BLAZE');
  await f.invoke(({ data, context }) => data.refresh(context, f.target().id));
  await f.invoke(({ results, context }) => assert.rejects(results.chunk(context, response.body.operation.id, 0, session, async () => {}), { code: 'BLAZE_INVALIDATED' }));
});
test('SR2d failed partial result writes never publish; reservations remain charged with prearmed cleanup', async t => {
  const f = await fixture(t); let count = 0;
  f.objects.beforeWrite = async () => { if (++count === 2) throw new MetadataError('PUT_TIMEOUT', 503); };
  await assert.rejects(f.publish(reader()), { code: 'PUT_TIMEOUT' });
  assert.equal((await f.rows('sr_operation'))[0].state, 'running');
  assert.ok((await f.rows('sr_object')).every(r => r.state === 'reserved'));
  assert.equal((await f.rows('sr_storage_usage'))[0].reserved_bytes, Buffer.byteLength(JSON.stringify(body)));
  assert.equal((await f.rows('sr_outbox')).filter(r => r.kind === 'object-cleanup' && r.state === 'dispatched').length, 2);
});
test('SR2d immutable result adapter verifies exact version, AES256, hashes and bounded streaming bytes', async () => {
  await new InvocationScope(Date.now() + 15000).run(async scope => {
    const bytes = Buffer.from('synthetic-result'), checksum = createHash('sha256').update(bytes).digest('base64');
    const entry = { purpose: 'result', state: 'live', key: `objects/v1/${'a'.repeat(64)}/${'b'.repeat(36)}`, capacityBytes: bytes.length, bytes: bytes.length, checksum, mediaType: 'application/octet-stream', version: 'v1' };
    let response = { VersionId: 'v1', ContentLength: bytes.length, ContentType: entry.mediaType, ChecksumSHA256: checksum, ServerSideEncryption: 'AES256' }, contents = bytes;
    const aws = { scope, call: work => work(scope.signal), s3: { send: async command => { assert.equal(command.input.VersionId, 'v1'); return { ...response, Body: Readable.from([contents]) }; } } };
    const objects = new ResultObjects(aws, 'synthetic-artifacts');
    assert.deepEqual(await objects.read(entry), bytes);
    for (const change of [{ VersionId: 'v2' }, { ServerSideEncryption: undefined }, { ChecksumSHA256: 'wrong' }, { ContentRange: 'bytes 0-2/3' }]) {
      const original = response; response = { ...response, ...change };
      await assert.rejects(objects.read(entry), { code: 'RESULT_OBJECT_INVALID' }); response = original;
    }
    contents = Buffer.concat([bytes, Buffer.from('overflow')]); await assert.rejects(objects.read(entry), { code: 'RESULT_OBJECT_INVALID' });
    contents = Buffer.alloc(bytes.length); await assert.rejects(objects.read(entry), { code: 'RESULT_OBJECT_INVALID' });
  });
});
