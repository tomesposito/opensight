import test from 'node:test';
import assert from 'node:assert/strict';
import { digestFixture, digestInput, definition } from './digest-helpers.mjs';
import { upload } from './source-helpers.mjs';
import { MetricCatalog } from '../dist/metric-model.js';
import { JobRenderer } from '../dist/job-renderer.js';
import { EmbedContent } from '../dist/embed-content.js';
import { JobRunner } from '../dist/job-runner.js';
import { DigestStore } from '../dist/digest-store.js';
import { DigestComputation } from '../dist/digest-computation.js';
import { MailError } from '../dist/mail.js';
const monday = Date.parse('2026-11-02T09:00:00Z');
const user = id => ({ type: 'user', id });
const rule = (id, region) => ({ id, principals: [user(id)], predicate: region ? { column: 'region', operator: 'eq', value: region } : { column: 'amount', operator: 'gte', value: 0 } });
async function setup(t, { adminRegion, otherRegion = 'east', denied, recipientIds = ['admin', 'other'], datasetPolicy } = {}, supplied) {
  const time = supplied?.time ?? { now: monday }, f = supplied ?? await digestFixture(t, undefined, undefined, () => new Date(time.now));
  await f.metadata.put(await f.login(), { kind: 'user', id: 'other' }, { name: 'Reader', role: 'reader' }, 1);
  const policy = { rowLevel: true, rowRules: [rule('admin', adminRegion), rule('other', otherRegion)],
    ...(denied ? { protectedColumns: [denied], columnGrants: [{ id: 'owner', column: denied, effect: 'allow', principals: [user('admin')] }] } : {}) };
  const source = await f.sources.upload(await f.login(), { ...upload(policy), base64: Buffer.from('day,region,amount\n2026-10-19,east,10\n2026-10-20,west,20\n2026-10-26,east,30\n2026-10-27,west,999999\n').toString('base64') });
  const bound = await f.sources.get(await f.login(), source.id), ref = { kind: 'dataset', id: 'shared-sales' };
  await f.metadata.put(await f.login(), ref, { definition: { DataSet: { DataSetId: ref.id, OutputColumns: bound.binding.columns.map(c => ({ Name: c.name, Type: c.type })) } },
    sources: [{ kind: 'source', id: source.id, ownerId: 'admin' }] });
  if (datasetPolicy) await f.metadata.put(await f.login(), { kind: 'policy', id: 'dataset-policy' }, { datasetId: ref.id, dataSetArn: 'urn:synthetic:shared-sales', ...datasetPolicy });
  await f.metadata.assetTransaction(await f.login(), true, a => { const c = new MetricCatalog(a); c.create('shared-revenue', ref, definition, c.schema(ref)); c.publish('shared-revenue', 1, c.schema(ref)); });
  const renderer = new JobRenderer(f.data, new EmbedContent(f.data), 'https://example.test');
  const runner = new JobRunner(f.store, renderer, f.mail), subscriptions = new DigestStore(f.store, renderer);
  const sub = await subscriptions.create(await f.login(), 'shared-revenue', { ...digestInput, destination: { kind: 'shared', recipientIds } });
  const job = await f.store.get(await f.login(), sub.id);
  return { ...f, ref, source, renderer, runner, subscriptions, sub, spec: job.spec, time,
    async queue() { const run = await f.store.enqueue(await f.login(), sub.id); await runner.execute(run); return run; },
    async deliveries() { return f.db.transaction(c => c.query('SELECT * FROM h7_deliveries')); },
    async remove(id) { await f.db.transaction(async c => { await c.query("UPDATE h2_memberships SET status = 'removed' WHERE tenant_id = 'tenant-one' AND user_id = ?", [id]); await c.query('UPDATE h1_revisions SET "authorization" = "authorization" + 1 WHERE tenant_id = ?', ['tenant-one']); }); },
  };
}

test('shared digests: one owner computation intersects principal RLS; preview matches, one message uses current emails and dedupes', async t => {
  const f = await setup(t), computation = new DigestComputation(f.data, f.store);
  const preview = await computation.compute(await f.login(), f.spec, new Date(monday));
  assert.equal(preview.current, 30); assert.equal(preview.previous, 10); assert.deepEqual(preview.drivers.map(d => d.value), ['east']);
  let renders = 0; const render = f.renderer.renderSharedDigest.bind(f.renderer);
  f.renderer.renderSharedDigest = (...args) => { renders++; return render(...args); };
  const run = await f.queue();
  await f.db.transaction(c => c.query("UPDATE h2_identities SET email = 'updated@example.test' WHERE subject = 'one-other'"));
  await f.runner.deliver(); assert.equal(f.mail.messages.length, 1); assert.equal(renders, 1);
  const message = f.mail.messages[0]; assert.deepEqual(message.to, ['one-admin@example.test', 'updated@example.test']);
  assert.match(message.html, /Current: 30.00/); assert.match(message.html, /Previous: 10.00/); assert.match(message.html, /east/); assert.doesNotMatch(message.html, /west|999,999/);
  assert.match(message.html, /Open metric/); assert.match(message.html, /Unsubscribe/);
  assert.equal((await f.deliveries()).length, 1); assert.equal((await f.deliveries())[0].message, null);
  assert.equal((await f.store.enqueue(await f.login(), f.sub.id)).id, run.id); await f.runner.tick(); assert.equal(f.mail.messages.length, 1);
});

test('shared digests: disjoint RLS and a denied time column send an explicit empty intersection without values or drivers', async t => {
  for (const options of [{ adminRegion: 'west' }, { adminRegion: 'west', count: true }, { denied: 'day' }]) {
    const f = await setup(t, options);
    if (options.count) await f.metadata.assetTransaction(await f.login(), true, a => { const c = new MetricCatalog(a); c.edit('shared-revenue', 2, { ...definition, expression: 'count({amount})' }, c.schema(f.ref)); c.publish('shared-revenue', 3, c.schema(f.ref)); });
    const preview = await new DigestComputation(f.data, f.store).compute(await f.login(), f.spec, new Date(monday));
    assert.equal(preview.emptyIntersection, true); assert.equal(preview.current, null); assert.equal(preview.previous, null); assert.deepEqual(preview.drivers, []);
    await f.queue(); await f.runner.deliver(); assert.equal(f.mail.messages.length, 1, JSON.stringify(await f.deliveries()));
    assert.deepEqual(f.mail.messages[0].to, ['one-admin@example.test', 'one-other@example.test']);
    assert.match(f.mail.messages[0].html, /No data is visible to all recipients/); assert.doesNotMatch(f.mail.messages[0].html, /Current:|Previous:|Percent change:|<li>|999,999|30.00/);
  }
});

test('shared digests: any recipient CLS withholds dimensions while sending the remaining digest', async t => {
  const f = await setup(t, { denied: 'region' }); await f.queue(); await f.runner.deliver();
  assert.equal(f.mail.messages.length, 1, JSON.stringify(await f.deliveries()));
  const message = f.mail.messages[0]; assert.match(message.html, /Current: 30.00/); assert.match(message.html, /dimension was withheld/); assert.doesNotMatch(message.html, /<li>|east|west/);
});

test('shared digests: removal, revoked dataset grants and denied measure drop recipients after enqueue', async t => {
  for (const revoke of ['member', 'grant', 'measure']) {
    const f = await setup(t); await f.queue();
    if (revoke === 'member') await f.remove('other');
    if (revoke === 'grant') {
      // Legacy dataset writes have no grant editor; exercise persisted grants
      // through the fixture DB and advance the real authorization revision.
      const saved = await f.metadata.get(await f.login(), f.ref);
      await f.db.transaction(async c => {
        await c.query("UPDATE h1_resources SET body = ? WHERE tenant_id = 'tenant-one' AND kind = 'dataset' AND resource_id = ?", [JSON.stringify({ ...saved.body, grants: [{ principal: user('admin'), role: 'co-owner' }] }), f.ref.id]);
        await c.query("UPDATE h1_revisions SET \"authorization\" = \"authorization\" + 1 WHERE tenant_id = 'tenant-one'");
      });
    }
    if (revoke === 'measure') {
      const key = { kind: 'source', id: f.source.id, ownerId: 'admin' }, saved = await f.metadata.get(await f.login(), key);
      await f.metadata.put(await f.login(), key, { ...saved.body, policy: { ...saved.body.policy, protectedColumns: ['amount'], columnGrants: [{ id: 'admin', column: 'amount', effect: 'allow', principals: [user('admin')] }] } }, saved.version);
    }
    await f.runner.deliver(); assert.equal(f.mail.messages.length, 1, `${revoke}: ${JSON.stringify(await f.deliveries())}`);
    assert.deepEqual(f.mail.messages[0].to, ['one-admin@example.test']);
  }
});

test('shared digests: no authorized audience fails closed at execute or delivery', async t => {
  for (const beforeExecute of [true, false]) {
    const f = await setup(t, { recipientIds: ['other'] }), run = await f.store.enqueue(await f.login(), f.sub.id);
    if (!beforeExecute) await f.runner.execute(run);
    await f.remove('other');
    if (beforeExecute) await f.runner.execute(run); else await f.runner.deliver();
    assert.equal(f.mail.messages.length, 0);
    const history = await f.store.history(await f.login(), f.sub.id); assert.equal(history[0].state, 'failed');
    if (beforeExecute) assert.equal(history[0].errorCode, 'DIGEST_SHARED_NO_AUTHORIZED_RECIPIENTS');
    else assert.equal((await f.deliveries())[0].error_code, 'DIGEST_SHARED_NO_AUTHORIZED_RECIPIENTS');
  }
});

test('shared digests: retries recompute one message, retain no body, and unsubscribe stops the whole list', async t => {
  const f = await setup(t); await f.queue(); const send = f.mail.send.bind(f.mail); let attempts = 0;
  f.mail.send = async (message, authorize) => { if (++attempts === 1) throw new MailError('SMTP_SEND_FAILED'); return send(message, authorize); };
  await f.runner.deliver(); assert.equal((await f.deliveries())[0].message, null); assert.equal(f.mail.messages.length, 0);
  f.time.now += 10000; await f.runner.deliver(); assert.equal(f.mail.messages.length, 1); assert.equal((await f.deliveries()).length, 1);
  await f.subscriptions.unsubscribe(await f.login(), f.sub.id, f.spec.unsubscribeToken);
  assert.equal((await f.store.get(await f.login(), f.sub.id)).stopped, true);
});

test('shared digests: SMTP handoff rechecks membership, email, policies, source and cancellation', async t => {
  for (const revoke of ['member', 'email', 'policy', 'source', 'unsubscribe']) {
    const f = await setup(t); await f.queue(); const send = f.mail.send.bind(f.mail);
    f.mail.send = async (message, authorize) => {
      if (revoke === 'member') await f.remove('other');
      if (revoke === 'email') await f.db.transaction(c => c.query("UPDATE h2_identities SET email = 'changed@example.test' WHERE subject = 'one-other'"));
      if (revoke === 'policy') { const key = { kind: 'source', id: f.source.id, ownerId: 'admin' }, saved = await f.metadata.get(await f.login(), key); await f.metadata.put(await f.login(), key, { ...saved.body, policy: { ...saved.body.policy, rowRules: [rule('admin'), rule('other', 'west')] } }, saved.version); }
      if (revoke === 'source') await f.sources.retire(await f.login(), f.source.id, f.source.version);
      if (revoke === 'unsubscribe') await f.subscriptions.unsubscribe(await f.login(), f.sub.id, f.spec.unsubscribeToken);
      return send(message, authorize);
    };
    await f.runner.deliver(); assert.equal(f.mail.messages.length, 0, revoke); assert.equal((await f.deliveries())[0].state, 'cancelled', revoke);
  }
});


test('shared digests: source and dataset policies both narrow each recipient, and the owner bounds non-owner lists', async t => {
  const f = await setup(t, { otherRegion: null, datasetPolicy: { rowLevel: true, rowRules: [rule('admin'), rule('other', 'east')] } });
  const result = await new DigestComputation(f.data, f.store).compute(await f.login(), f.spec, new Date(monday));
  assert.equal(result.current, 30); assert.deepEqual(result.drivers.map(d => d.value), ['east']);
  const ownerBound = await setup(t, { adminRegion: 'east', otherRegion: null, recipientIds: ['other'] });
  await ownerBound.queue(); await ownerBound.runner.deliver();
  assert.deepEqual(ownerBound.mail.messages[0].to, ['one-other@example.test']); assert.match(ownerBound.mail.messages[0].html, /Current: 30.00/); assert.doesNotMatch(ownerBound.mail.messages[0].html, /west/);
});

test('shared digests: serverless due/execute/deliver sends one intersected message and handles recipient revocations', async t => {
  const { sr3Fixture } = await import('./sr3-helpers.mjs'), { TenantBudgets } = await import('../dist/budgets.js');
  const { HostedData } = await import('../dist/hosted-data.js'), { DurableJobs } = await import('../dist/durable-jobs.js');
  for (const revoke of ['none', 'one', 'all', 'handoff']) {
    const base = await sr3Fixture(t); base.time.now = monday - 1000;
    const budgets = new TenantBudgets(base.budgets, c => base.metadata.assertContext(c)); t.after(() => budgets.close());
    const data = new HostedData(base.sources, undefined, budgets);
    const f = await setup(t, { recipientIds: revoke === 'all' ? ['other'] : ['admin', 'other'] }, { ...base, data,
      login: (namespaceId = 'one', userId = 'admin') => base.metadata.authenticate(null, async () => ({ namespaceId, userId })) });
    const jobs = new DurableJobs(f.store, f.renderer, f.mail); f.time.now = monday;
    const due = await f.event('job-due'); await jobs.run(due); await jobs.run(due);
    await jobs.run(await f.event('job-execute'));
    const deliver = await f.event('job-deliver');
    if (revoke === 'one' || revoke === 'all') await f.remove('other');
    if (revoke === 'handoff') { const send = f.mail.send.bind(f.mail); f.mail.send = async (message, authorize) => { await f.remove('other'); return send(message, authorize); }; }
    await jobs.run(deliver); await jobs.run(deliver);
    const deliveries = await f.deliveries(); assert.equal(deliveries.length, 1); assert.equal(deliveries[0].message, null);
    if (revoke === 'all' || revoke === 'handoff') { assert.equal(f.mail.messages.length, 0); assert.equal(deliveries[0].state, 'cancelled'); }
    else { assert.equal(f.mail.messages.length, 1); assert.deepEqual(f.mail.messages[0].to, revoke === 'one' ? ['one@example.test'] : ['one@example.test', 'one-other@example.test']); if (revoke === 'none') assert.match(f.mail.messages[0].html, /Current: 30.00/); }
  }
});
