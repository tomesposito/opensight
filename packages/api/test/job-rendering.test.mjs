import test from 'node:test';
import assert from 'node:assert/strict';
import { sessionFixture } from './embed-session-helpers.mjs';
import { readerMember, seedEmbedContent, assetDefinition } from './embed-content-helpers.mjs';
import { HostedData } from '../dist/hosted-data.js';
import { JobRenderer } from '../dist/job-renderer.js';
import { JobStore } from '../dist/job-store.js';
import { JobRunner } from '../dist/job-runner.js';
import { schedule } from './job-helpers.mjs';
import { StubMailTransport } from '../dist/mail.js';
import { HostedPrep } from '../dist/hosted-prep.js';
import { upload } from './source-helpers.mjs';

async function fixture(t) {
  const f = await sessionFixture(t), reader = await readerMember(f), data = await seedEmbedContent(f, reader);
  t.after(() => data.budgets.close());
  const renderer = new JobRenderer(new HostedData(data.sources, undefined, data.budgets), data.content), store = new JobStore(f.db, f.metadata, () => new Date(f.clock())), mail = new StubMailTransport();
  const runner = new JobRunner(store, renderer, mail), spec = { kind: 'report', dashboardId: 'dashboard', recipients: [reader.identity.userId], enabled: true, schedule };
  const put = (id, spec) => f.context().then(c => store.put(c, id, spec, 0, (c, s) => renderer.authorize(c, s)));
  return { ...f, ...data, reader, renderer, store, runner, mail, spec, put };
}
test('H7 real report rendering uses recipient RLS, CLS and dashboard/folder grants', async t => {
  const f = await fixture(t); await f.put('report', f.spec);
  await f.store.enqueue(await f.context(), 'report'); await f.runner.tick();
  assert.equal(f.mail.messages.length, 1, JSON.stringify(await f.db.transaction(c => c.query('SELECT * FROM h7_occurrences'))) + JSON.stringify(await f.db.transaction(c => c.query('SELECT * FROM h7_deliveries')))); assert.deepEqual(f.mail.messages[0].to, ['reader@example.test']);
  assert.match(f.mail.messages[0].html, />40</); assert.doesNotMatch(f.mail.messages[0].html, />60</);
  const d = await f.metadata.get(await f.context(), { kind: 'dashboard', id: 'dashboard' });
  await f.metadata.put(await f.context(), { kind: 'dashboard', id: 'dashboard' }, { ...d.body, definition: assetDefinition('dashboard', 'dashboard', 'private') }, d.version);
  await assert.rejects(f.renderer.authorize(await f.reader.context(), f.spec), { code: 'COLUMN_ACCESS_DENIED' });
  await f.metadata.put(await f.context(), { kind: 'folder', id: 'closed' }, { name: 'Closed', grants: [] });
  await f.metadata.put(await f.context(), { kind: 'dashboard', id: 'dashboard' }, { ...d.body, folderId: 'closed' }, d.version + 1);
  await assert.rejects(f.renderer.authorize(await f.reader.context(), f.spec), { code: 'RESOURCE_NOT_FOUND' });
});
test('H7 real refresh triggers tenant alert transitions once and renders only recipient metrics', async t => {
  const f = await fixture(t), alert = { kind: 'alert', enabled: true, datasetId: 'dataset', dashboardId: 'dashboard', visualId: 'total', fieldId: 'amount', dimensions: {}, condition: { kind: 'above', threshold: 30 }, recipients: f.spec.recipients };
  await f.put('alert', alert); await f.put('refresh', { kind: 'refresh', target: { kind: 'dataset', id: 'dataset' }, enabled: true, schedule });
  await f.store.enqueue(await f.context(), 'refresh'); await f.runner.tick();
  assert.equal(f.mail.messages.length, 1, JSON.stringify(await f.db.transaction(c => c.query('SELECT * FROM h7_occurrences'))) + JSON.stringify(await f.db.transaction(c => c.query('SELECT * FROM h7_deliveries')))); assert.match(f.mail.messages[0].html, /amount = 40/); assert.doesNotMatch(f.mail.messages[0].html, /60/);
  assert.equal((await f.store.get(await f.context(), 'alert')).alertState, 'triggered');
  await f.store.enqueue(await f.context(), 'refresh'); await f.runner.tick(); assert.equal(f.mail.messages.length, 1);
  assert.equal((await f.store.history(await f.context(), 'alert')).length, 2);
});
test('H7 recipient revocation while rendering suppresses delivery and a tenant suspension blocks queued work', async t => {
  const f = await fixture(t); await f.put('report', f.spec); const run = await f.store.enqueue(await f.context(), 'report'); await f.runner.execute(run);
  const original = f.renderer.render.bind(f.renderer);
  f.renderer.render = async (...args) => { const result = await original(...args); await f.provisioning.removeMember(f.tenant.tenantId, f.reader.identity.userId); return result; };
  await f.runner.deliver(); assert.equal(f.mail.messages.length, 0);
  assert.equal((await f.store.deliveries(await f.context(), 'report'))[0].state, 'cancelled');
  const current = await f.provisioning.operator.tenant(f.tenant.tenantId);
  const queued = await f.store.enqueue(await f.context(), 'report');
  await f.provisioning.transition('suspend-jobs', f.tenant.tenantId, 'suspend', current.version);
  await f.runner.execute(queued); assert.equal(f.mail.messages.length, 0);
  const rows = await f.db.transaction(c => c.query('SELECT error_code FROM h7_occurrences WHERE occurrence_id = ?', [queued.id])); assert.equal(rows[0].error_code, 'TENANT_UNAVAILABLE');
});
test('H7 percent-change alerts compare completed UTC periods under recipient row permissions', async t => {
  const f = await fixture(t), policy = { rowLevel: true, rowRules: [{ id: 'reader', principals: [{ type: 'user', id: f.reader.identity.userId }, { type: 'user', id: f.identity.userId }], predicate: { column: 'region', operator: 'eq', value: 'east' } }] };
  const source = await f.sources.upload(await f.context(), { ...upload(policy), base64: Buffer.from('region,amount,day\neast,20,2026-10-01\neast,40,2026-10-02\nwest,900,2026-10-02\n').toString('base64') });
  await f.metadata.put(await f.context(), { kind: 'dataset', id: 'dataset' }, { ...f.dataset, sources: [{ kind: 'source', id: source.id, ownerId: f.identity.userId }] }, 1);
  const spec = { kind: 'alert', enabled: true, datasetId: 'dataset', dashboardId: 'dashboard', visualId: 'total', fieldId: 'amount', dimensions: {}, condition: { kind: 'percent-change', threshold: 50, comparison: 'above', period: { columnName: 'day', unit: 'day' } }, recipients: f.spec.recipients };
  const message = await f.renderer.render(await f.reader.context(), spec, new Date('2026-10-03T12:00:00Z'));
  assert.match(message.html, /amount = 40/); assert.match(message.html, /Previous: 20; change: 100%/); assert.doesNotMatch(message.html, /900/);
});
test('H7 prepared interval configuration creates one durable owner job and stops on direct mode', async t => {
  const f = await fixture(t), source = await f.sources.upload(await f.context(), upload()), prep = new HostedPrep(f.renderer.data, f.store);
  await prep.save(await f.context(), 'prepared', { name: 'Prepared', pipeline: { version: 1, input: source.id, steps: [] }, expectedVersion: 0 });
  await prep.configure(await f.context(), 'prepared', { mode: 'BLAZE', intervalMinutes: 1, expectedVersion: 1 });
  const [job] = await f.store.list(await f.context()); assert.equal(job.spec.target.kind, 'prepared-dataset');
  await f.store.enqueue(await f.context(), job.id); await f.runner.tick();
  assert.equal((await f.store.history(await f.context(), job.id))[0].state, 'succeeded');
  await assert.rejects(f.renderer.authorize(await f.reader.context(), job.spec), { code: 'SOURCE_ACCESS_DENIED' });
  await prep.configure(await f.context(), 'prepared', { mode: 'DIRECT_QUERY', intervalMinutes: null, expectedVersion: 2 });
  assert.equal((await f.store.get(await f.context(), job.id)).stopped, true);
});
