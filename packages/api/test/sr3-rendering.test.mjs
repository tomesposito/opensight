import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { sr3Fixture } from './sr3-helpers.mjs';
import { assetDefinition } from './embed-content-helpers.mjs';
import { upload } from './source-helpers.mjs';
import { objectStorage } from './manifest-helpers.mjs';
import { HostedSources } from '../dist/hosted-sources.js';
import { EmbedSources } from '../dist/embed-sources.js';
import { HostedData } from '../dist/hosted-data.js';
import { EmbedContent } from '../dist/embed-content.js';
import { JobRenderer } from '../dist/job-renderer.js';
import { DurableJobs } from '../dist/durable-jobs.js';
import { InvocationScope } from '../dist/runtime-scope.js';
import { TenantBudgets } from '../dist/budgets.js';
import { ServerlessWork } from '../dist/serverless-work.js';
import { ObjectLedger } from '../dist/object-ledger.js';

test('SR3 real recipient report rendering uses SR2 admission and preserves RLS/CLS through SMTP authorization', async t => {
  const f = await sr3Fixture(t), key = randomBytes(32).toString('base64'), sources = new HostedSources(f.metadata, key, []); let context = f.contexts[0];
  const source = await sources.upload(context, upload({ rowLevel: true, rowRules: [
    { id: 'owner', principals: [{ type: 'user', id: 'admin' }], predicate: { column: 'region', operator: 'in', values: ['east', 'west'] } },
    { id: 'recipient', principals: [{ type: 'user', id: 'other' }], predicate: { column: 'region', operator: 'eq', value: 'east' } },
  ], protectedColumns: ['private'], columnGrants: [{ id: 'owner', column: 'private', effect: 'allow', principals: [{ type: 'user', id: 'admin' }] }] }));
  await f.metadata.put(context, { kind: 'dataset', id: 'dataset' }, { definition: { DataSet: { DataSetId: 'dataset' } }, sources: [{ kind: 'source', id: source.id, ownerId: 'admin' }] });
  await f.metadata.put(context, { kind: 'dashboard', id: 'dashboard' }, { definition: assetDefinition(), datasets: [{ kind: 'dataset', id: 'dataset' }], folderId: null });
  context = await f.metadata.authenticate(null, async () => ({ namespaceId: 'one', userId: 'admin' })); f.contexts[0] = context;
  await f.put(); await f.store.enqueue(context, 'report'); await f.jobs.run(await f.event('job-execute'));
  const storage = objectStorage();
  const deliver = envelope => new InvocationScope(Date.now() + 28000).run(async scope => {
    const budgets = new TenantBudgets(f.budgets, c => f.metadata.assertContext(c));
    const work = new ServerlessWork(f.coordinator, f.manifests, f.dispatch, new ObjectLedger(f.metadata, 'test'), storage.transfer(scope), budgets, scope, async () => {});
    const data = new HostedData(sources, undefined, budgets, work.cache, work);
    const content = new EmbedContent(new HostedData(new EmbedSources(f.metadata, key, []), undefined, budgets, work.cache, work));
    const renderer = new JobRenderer(data, content), jobs = new DurableJobs(f.store, renderer, f.mail);
    try { await jobs.run(envelope); } finally { await work.finish(); }
  });
  await deliver(await f.event('job-deliver'));
  assert.equal(f.mail.messages.length, 1, JSON.stringify(await f.rows('h7_deliveries')));
  assert.match(f.mail.messages[0].html, />40</); assert.doesNotMatch(f.mail.messages[0].html, />60</);
  const admissions = await f.rows('sr_admission'); assert.equal(admissions.length, 1); assert.equal(admissions[0].owner_id, 'other'); assert.equal(admissions[0].state, 'released');
  const stored = await f.metadata.get(context, { kind: 'source', id: source.id, ownerId: 'admin' });
  await f.metadata.put(context, { kind: 'source', id: source.id, ownerId: 'admin' }, { ...stored.body, policy: { ...stored.body.policy,
    protectedColumns: ['private', 'amount'], columnGrants: [...stored.body.policy.columnGrants, { id: 'owner-amount', column: 'amount', effect: 'allow', principals: [{ type: 'user', id: 'admin' }] }] } }, stored.version);
  context = await f.metadata.authenticate(null, async () => ({ namespaceId: 'one', userId: 'admin' }));
  await f.store.enqueue(context, 'report'); await f.jobs.run(await f.event('job-execute')); await deliver(await f.event('job-deliver'));
  assert.equal(f.mail.messages.length, 1); assert.equal((await f.rows('h7_deliveries')).at(-1).error_code, 'COLUMN_ACCESS_DENIED');
});
