import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { ArtifactCache } from '../dist/artifact-cache.js';
import { HostedData } from '../dist/hosted-data.js';
import { HostedPrep } from '../dist/hosted-prep.js';
import { InvocationScope } from '../dist/runtime-scope.js';
import { TenantBudgets } from '../dist/budgets.js';
import { BlazeTable } from '../dist/blaze.js';
import { MetadataError } from '../dist/metadata-db.js';
import { manifestFixture, objectStorage } from './manifest-helpers.mjs';
import { upload } from './source-helpers.mjs';

const query = { dimensions: [], measures: [{ fieldId: 'total', columnName: 'amount', aggregation: 'SUM' }], filters: [] };
const protectedPolicy = { rowLevel: true, rowRules: [{ id: 'east', principals: [{ type: 'user', id: 'admin' }], predicate: { column: 'region', operator: 'eq', value: 'east' } }], protectedColumns: ['private'], columnGrants: [] };
const prepare = { async prepareWrite() {} }; // Test-only in-memory object service, no external obligation.
async function invoke(f, storage, target, work, options = {}) {
  const invocation = new InvocationScope(Date.now() + 60000);
  return invocation.run(async invocation => {
    const budgets = new TenantBudgets(f.budgets, c => f.metadata.assertContext(c)), context = f.contexts[0];
    const attempt = await f.admit(target, options.definitions ?? []);
    const transfer = storage.transfer(invocation), cache = new ArtifactCache(f.manifests, attempt, transfer, Object.hasOwn(options, 'preparation') ? options.preparation : prepare);
    const data = new HostedData(f.sources, undefined, budgets, cache); data.begin(context); if (target) data.prepaidCompute.add(context);
    try { return await work({ context, attempt, data, cache, invocation, budgets }); }
    finally { await budgets.shutdown(); await f.coordinator.release(attempt); }
  });
}
const cacheKey = (ctx, target) => JSON.stringify([ctx.tenantId, ctx.namespaceId, ctx.userId, target.kind === 'source' ? 'source' : 'prep', target.id]);

test('SR2c hosted source hydration across invocations matches local direct query and preserves RLS/CLS', async t => {
  const f = await manifestFixture(t), storage = objectStorage();
  const source = await f.sources.upload(f.contexts[0], upload(protectedPolicy)), target = { kind: 'source', id: source.id, version: 1 }; await f.open();
  await invoke(f, storage, target, async ({ context, data }) => { assert.equal((await data.refresh(context, target.id)).state, 'ready'); });
  assert.equal(storage.objects.size, 1);
  await invoke(f, storage, undefined, async ({ context, data, cache, invocation }) => {
    const direct = await data.execute(context, target.id, 'query', { mode: 'DIRECT_QUERY', query });
    const hydrated = await data.execute(context, target.id, 'query', { mode: 'BLAZE', query });
    assert.deepEqual(hydrated, direct); assert.deepEqual(hydrated.rows, [{ total: 40 }]);
    const before = storage.calls.length;
    await assert.rejects(data.execute(context, target.id, 'output', { mode: 'BLAZE', columns: ['private'] }), { code: 'COLUMN_ACCESS_DENIED' });
    assert.equal(storage.calls.length, before, 'CLS denial precedes download');
    await assert.rejects(cache.invalidate(JSON.stringify(['other', context.namespaceId, context.userId, 'source', target.id])), { code: 'ARTIFACT_CACHE_CONTEXT_INVALID' });
    assert.deepEqual(await readdir(await invocation.temporaryDirectory()), []);
  });
});

test('SR2c prepared dataset hydration preserves transitive provenance and matches the local prepared executor', async t => {
  const f = await manifestFixture(t), storage = objectStorage(), context = f.contexts[0];
  const budgets = new TenantBudgets(f.budgets, c => f.metadata.assertContext(c)), local = new HostedPrep(new HostedData(f.sources, undefined, budgets));
  for (const [id, input] of [['first', f.target().id], ['second', { dataset: 'first' }]]) {
    await local.save(context, id, { name: id, pipeline: { version: 1, input, steps: [] }, expectedVersion: 0 });
    await local.configure(context, id, { expectedVersion: 1, mode: 'BLAZE', intervalMinutes: null });
  }
  await local.execute(context, 'first', 'refresh'); await local.execute(context, 'second', 'refresh');
  const expected = await local.execute(context, 'second', 'query', query); await budgets.shutdown();
  await f.open(); const first = { kind: 'prepared-dataset', id: 'first', version: 2 }, second = { ...first, id: 'second' };
  await invoke(f, storage, first, ({ data }) => new HostedPrep(data).execute(context, 'first', 'refresh'), { definitions: [f.target()] });
  const firstManifest = JSON.parse((await f.rows('sr_manifest')).find(r => r.resource_id === 'first').body);
  await invoke(f, storage, second, ({ data }) => new HostedPrep(data).execute(context, 'second', 'refresh'), { definitions: [f.target(), first] });
  const secondManifest = JSON.parse((await f.rows('sr_manifest')).find(r => r.resource_id === 'second').body);
  assert.deepEqual(secondManifest.reference.descriptor.cachedInputs, [{ datasetId: 'first', refreshedAt: firstManifest.refreshedAt }]);
  await invoke(f, storage, undefined, async ({ data }) => { assert.deepEqual(await new HostedPrep(data).execute(context, 'second', 'query', query), expected); });
});

test('SR2c missing or failed recovery preparation prevents any object write', async t => {
  for (const absent of [true, false]) {
    const f = await manifestFixture(t), storage = objectStorage(); await f.open(); let loaded = 0, prepared = 0;
    await invoke(f, storage, f.target(), async ({ cache, budgets, context, data, invocation }) => {
      const stamp = JSON.stringify([1, await f.metadata.revisions(context)]);
      await budgets.run(context, true, async () => {}, async () => {
        const scope = budgets.current(context);
        await assert.rejects(cache.refresh(scope, cacheKey(context, f.target()), stamp, async () => {
          loaded++; const table = new BlazeTable(data.limits(context)); table.start([{ name: 'amount', type: 'INTEGER' }]); table.row([1]); return table;
        }), { code: absent ? 'ARTIFACT_RECOVERY_REQUIRED' : 'RECOVERY_UNAVAILABLE' });
      });
      assert.deepEqual(await readdir(await invocation.temporaryDirectory()), []);
    }, { preparation: absent ? undefined : { async prepareWrite() { prepared++; throw new MetadataError('RECOVERY_UNAVAILABLE', 503); } } });
    assert.equal(loaded, absent ? 0 : 1); assert.equal(prepared, absent ? 0 : 1); assert.equal(storage.calls.length, 0);
    assert.equal((await f.rows('sr_manifest'))[0].state, absent ? 'running' : 'error');
  }
});

test('SR2c revocation during hydration discards decoded bytes and returns no protected result', async t => {
  const f = await manifestFixture(t), storage = objectStorage(); await f.open();
  await invoke(f, storage, f.target(), ({ context, data }) => data.refresh(context, f.target().id));
  await invoke(f, storage, undefined, async ({ context, data, attempt, invocation }) => {
    storage.beforeGet = () => f.coordinator.revoke(attempt);
    await assert.rejects(data.execute(context, f.target().id, 'query', { mode: 'BLAZE', query }), { code: 'ATTEMPT_REVOKED' });
    assert.deepEqual(await readdir(await invocation.temporaryDirectory()), []);
  });
});

test('SR2c final hosted publication rechecks a dependency changed after hydration', async t => {
  const f = await manifestFixture(t), storage = objectStorage(); await f.open();
  await invoke(f, storage, f.target(), ({ context, data }) => data.refresh(context, f.target().id));
  await invoke(f, storage, undefined, async ({ context, data }) => {
    const compute = data.computeQuery.bind(data);
    data.computeQuery = async (...args) => {
      const result = await compute(...args);
      await f.db.transaction(c => c.query('UPDATE sr_claim SET fence = fence + 1 WHERE resource_id = ?', [f.target().id]));
      return result;
    };
    await assert.rejects(data.execute(context, f.target().id, 'query', { mode: 'BLAZE', query }), { code: 'BLAZE_INVALIDATED' });
  });
});
