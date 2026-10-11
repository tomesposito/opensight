import test from 'node:test';
import assert from 'node:assert/strict';
import { ServerlessWork } from '../dist/serverless-work.js';
import { serverlessDataPath } from '../dist/serverless-application.js';
import { HostedData } from '../dist/hosted-data.js';
import { InvocationScope } from '../dist/runtime-scope.js';
import { TenantBudgets } from '../dist/budgets.js';
import { MetadataError } from '../dist/metadata-db.js';
import { uploadFixture } from './serverless-upload-helpers.mjs';
import { objectStorage } from './manifest-helpers.mjs';
const query = { dimensions: [], measures: [{ fieldId: 'total', columnName: 'amount', aggregation: 'SUM' }], filters: [] };
async function invoke(f, storage, run, close) {
  return new InvocationScope(Date.now() + 28000).run(async invocation => {
    const budgets = new TenantBudgets(f.budgets, c => f.metadata.assertContext(c));
    const work = new ServerlessWork(f.coordinator, f.manifests, f.dispatch, f.ledger, storage.transfer(invocation), budgets, invocation, close ?? (async () => {}));
    const data = new HostedData(f.sources, undefined, budgets, work.cache, work), context = f.contexts[0]; data.begin(context);
    try { return await run({ work, data, context, invocation }); } finally { await work.finish(); }
  });
}
test('SR2d HTTP work retains admission through publication, closes transfers before release, and hydrates on the next invocation', async t => {
  const f = await uploadFixture(t), storage = objectStorage();
  await invoke(f, storage, async ({ data, context }) => {
    await data.refresh(context, f.target().id);
    assert.equal((await f.rows('sr_admission'))[0].state, 'held');
    assert.equal((await f.rows('sr_object'))[0].state, 'live');
    assert.equal((await f.rows('sr_outbox')).filter(r => r.kind === 'object-cleanup').length, 1);
    await data.publication(context, await f.metadata.revisions(context));
  }, async () => { assert.equal((await f.rows('sr_admission'))[0].state, 'held'); });
  assert.equal((await f.rows('sr_admission'))[0].state, 'released');
  await invoke(f, storage, async ({ data, context }) => {
    const direct = await data.execute(context, f.target().id, 'query', { mode: 'DIRECT_QUERY', query });
    const hydrated = await data.execute(context, f.target().id, 'query', { mode: 'BLAZE', query });
    assert.deepEqual(hydrated, direct);
    assert.equal((await f.rows('sr_admission')).filter(r => r.state === 'held').length, 1);
  });
  assert.equal((await f.rows('sr_admission')).length, 2, 'sequential data work shares one invocation admission');
  assert.ok((await f.rows('sr_admission')).every(r => r.state === 'released'));
});
test('SR2d refresh prearms superseded-object cleanup before removing readability; failed recovery send changes nothing', async t => {
  const f = await uploadFixture(t), storage = objectStorage();
  await invoke(f, storage, ({ data, context }) => data.refresh(context, f.target().id));
  const previous = (await f.rows('sr_manifest'))[0].body;
  const recover = f.transport.recover; f.transport.recover = async () => { throw new MetadataError('RECOVERY_UNAVAILABLE', 503); };
  await assert.rejects(invoke(f, storage, ({ data, context }) => data.refresh(context, f.target().id)), { code: 'RECOVERY_UNAVAILABLE' });
  assert.equal((await f.rows('sr_manifest'))[0].body, previous);
  assert.equal(storage.objects.size, 1);
  f.transport.recover = recover;
  await invoke(f, storage, ({ data, context }) => data.refresh(context, f.target().id));
  assert.equal(storage.objects.size, 2);
  const target = (await f.rows('sr_cleanup_target'))[0], cleanup = (await f.rows('sr_outbox')).find(r => r.kind === 'artifact-cleanup');
  assert.equal(cleanup.aggregate_id, target.cleanup_id);
  assert.equal((await f.rows('sr_object')).find(r => r.object_id === target.object_id).object_version, 'version-1');
});
test('SR2d failed socket shutdown retains admission and an aborted invocation never releases its hold early', async t => {
  for (const abort of [false, true]) {
    const f = await uploadFixture(t), storage = objectStorage();
    const result = invoke(f, storage, async ({ data, context, invocation }) => {
      await data.execute(context, f.target().id, 'query', { mode: 'DIRECT_QUERY', query });
      if (abort) invocation.controller.abort();
    }, async () => { if (!abort) throw new MetadataError('TRANSFER_CLOSE_FAILED', 503); });
    await assert.rejects(result, { code: abort ? 'INVOCATION_DEADLINE_EXCEEDED' : 'TRANSFER_CLOSE_FAILED' });
    assert.equal((await f.rows('sr_admission'))[0].state, 'held');
  }
});
test('SR2d invocation gate permits implemented data routes and refuses H7, legacy payloads, and operator paths', () => {
  for (const path of ['/api/uploads/reservations', '/api/namespaces/one/operations/op', '/api/sources/source/query', '/api/datasets/data/prep']) assert.equal(serverlessDataPath(path), true);
  for (const path of ['/api/uploads', '/api/uploads/upload_old', '/api/jobs', '/api/jobs/job/runs', '/api/host/tenants', '/api/namespaces/one/jobs', '/api/operations/op/secret', '/api/sources/source/query/extra']) assert.equal(serverlessDataPath(path), false);
});
