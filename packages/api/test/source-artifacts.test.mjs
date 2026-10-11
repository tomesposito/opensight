import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceFixture, columns, policy } from './source-helpers.mjs';
import { HostedSources } from '../dist/hosted-sources.js';
import { EmbedSources } from '../dist/embed-sources.js';
import { sourceBody } from '../dist/source-schema.js';

const body = () => ({ binding: { version: 4, connectorId: 'file', state: 'active', columns, rowCount: 1, expiresAt: '2099-01-01T00:00:00.000Z', objectId: 'synthetic-object' }, policy });
test('SR2d v4 sources require an immutable object binding and retain H1 policy-principal validation', async t => {
  const f = await sourceFixture(t), ctx = await f.login(), raw = body();
  assert.equal(sourceBody(raw).binding.objectId, 'synthetic-object');
  for (const changed of [{ ...raw, secretId: 'forbidden' }, { ...raw, binding: { ...raw.binding, connectorId: 'postgresql' } }, { ...raw, binding: { ...raw.binding, objectId: undefined } },
    { ...raw, binding: { ...raw.binding, version: 3 } }]) assert.throws(() => sourceBody(changed));
  await assert.rejects(f.metadata.put(ctx, { kind: 'source', id: 'protected', ownerId: ctx.userId }, { ...raw, policy: { rowLevel: true, rowRules: [{ id: 'unknown', principals: [{ type: 'user', id: 'missing' }], predicate: { column: 'region', operator: 'eq', value: 'east' } }] } }), { code: 'METADATA_REFERENCE_INVALID' });
  await f.metadata.put(ctx, { kind: 'source', id: 'source', ownerId: ctx.userId }, raw);
  const source = await f.sources.get(ctx, 'source');
  await assert.rejects(f.sources.payload(ctx, source), { code: 'SOURCE_ARTIFACT_READER_REQUIRED' });
});

test('SR2d owner artifact hydration rechecks source/revisions after external I/O', async t => {
  const f = await sourceFixture(t), ctx = await f.login();
  await f.metadata.put(ctx, { kind: 'source', id: 'source', ownerId: ctx.userId }, body());
  let invalidate = false, reads = 0;
  const sources = new HostedSources(f.metadata, f.key, [], f.clock, async (context, resource, verify) => {
    reads++; assert.equal(context, ctx); assert.equal(resource.ownerId, ctx.userId); assert.equal(resource.id, 'source'); await verify();
    if (invalidate) await f.metadata.put(ctx, { kind: 'source', id: 'source', ownerId: ctx.userId }, { ...body(), binding: { ...body().binding, state: 'retired' } }, 1);
    return { rows: [['east', 10, 'private']] };
  });
  assert.deepEqual(await sources.payload(ctx, await sources.get(ctx, 'source')), { rows: [['east', 10, 'private']] });
  invalidate = true; await assert.rejects(sources.payload(ctx, await sources.get(ctx, 'source')), { code: 'METADATA_REVISED' }); assert.equal(reads, 2);
});

test('SR2d embed artifacts follow the authorized dataset owner; general source reads remain owner-only', async t => {
  const f = await sourceFixture(t), owner = await f.login(), viewer = await f.login('one', 'other');
  await f.metadata.put(owner, { kind: 'source', id: 'source', ownerId: owner.userId }, body());
  await f.metadata.put(owner, { kind: 'dataset', id: 'dataset' }, { definition: { DataSet: { DataSetId: 'dataset' } }, sources: [{ kind: 'source', id: 'source', ownerId: owner.userId }] });
  let invalidate = false;
  const sources = new EmbedSources(f.metadata, f.key, [], f.clock, async (context, resource, verify) => {
    assert.equal(context.userId, 'other'); assert.equal(resource.ownerId, 'admin'); assert.equal(resource.id, 'source'); await verify();
    if (invalidate) await f.metadata.put(owner, { kind: 'dataset', id: 'dataset' }, { definition: { DataSet: { DataSetId: 'dataset' } }, sources: [] }, 1);
    return { rows: [['east', 10, 'private']] };
  });
  await assert.rejects(f.sources.get(viewer, 'source'), { code: 'RESOURCE_NOT_FOUND' });
  const bound = await sources.bindDataset(viewer, 'dataset');
  assert.deepEqual(await sources.payload(viewer, await sources.get(viewer, bound)), { rows: [['east', 10, 'private']] });
  invalidate = true; await assert.rejects(sources.payload(viewer, await sources.get(viewer, bound)), { code: 'METADATA_REVISED' });
});
