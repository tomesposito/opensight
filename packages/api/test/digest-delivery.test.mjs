import test from 'node:test';
import assert from 'node:assert/strict';
import { digestFixture, digestInput } from './digest-helpers.mjs';
import { JobRenderer } from '../dist/job-renderer.js';
import { EmbedContent } from '../dist/embed-content.js';
import { JobRunner } from '../dist/job-runner.js';
import { DigestStore } from '../dist/digest-store.js';
import { newDigest } from '../dist/digest-model.js';
import { sr3Fixture } from './sr3-helpers.mjs';
import { MailError } from '../dist/mail.js';
const monday = Date.parse('2026-11-02T09:00:00Z');
async function setup(t) {
  const time = { now: monday }, f = await digestFixture(t, undefined, undefined, () => new Date(time.now));
  const renderer = new JobRenderer(f.data, new EmbedContent(f.data), 'https://example.test');
  const runner = new JobRunner(f.store, renderer, f.mail), subscriptions = new DigestStore(f.store, renderer);
  const sub = await subscriptions.create(await f.login(), 'revenue', digestInput);
  return { ...f, runner, renderer, subscriptions, sub, time };
}

test('digests: real durable delivery sends once per subscription/period and contains links and governed values', async t => {
  const f = await setup(t), c = await f.login();
  const first = await f.store.enqueue(c, f.sub.id); await f.runner.tick();
  assert.equal(f.mail.messages.length, 1, JSON.stringify(await f.store.history(c, f.sub.id)));
  const mail = f.mail.messages[0]; assert.deepEqual(mail.to, ['one-admin@example.test']); assert.match(mail.html, /Current: 35.00/); assert.match(mail.html, /east/);
  assert.match(mail.html, /https:\/\/example.test\/#\/metrics\/revenue/); assert.match(mail.html, /metric-unsubscribe\/tenant-one\/one\/digest-/);
  const repeated = await f.store.enqueue(c, f.sub.id); assert.equal(repeated.id, first.id);
  await f.runner.tick(); assert.equal(f.mail.messages.length, 1);
  f.time.now += 7 * 86400000; await f.store.enqueue(c, f.sub.id); await f.runner.tick(); assert.equal(f.mail.messages.length, 2);
  assert.notEqual(f.mail.messages[0].dedupeKey, f.mail.messages[1].dedupeKey);
});

test('digests: delayed execution uses the queued period and retry never reuses cached data', async t => {
  const f = await setup(t), c = await f.login(), run = await f.store.enqueue(c, f.sub.id);
  await f.runner.execute(run); f.time.now += 8 * 86400000;
  const send = f.mail.send.bind(f.mail); let attempts = 0;
  f.mail.send = async (message, authorize) => { if (++attempts === 1) throw new MailError('SMTP_SEND_FAILED'); return send(message, authorize); };
  await f.runner.deliver(); assert.equal(f.mail.messages.length, 0);
  const cached = await f.db.transaction(c => c.query('SELECT message FROM h7_deliveries')); assert.equal(cached[0].message, null);
  f.time.now += 10000; await f.runner.deliver(); assert.equal(f.mail.messages.length, 1); assert.match(f.mail.messages[0].html, /Current: 35.00/);
});

test('digests: authorization and unsubscribe are rechecked at SMTP handoff', async t => {
  for (const revoke of ['unsubscribe', 'member', 'source']) {
    const f = await setup(t), c = await f.login(), run = await f.store.enqueue(c, f.sub.id); await f.runner.execute(run);
    const send = f.mail.send.bind(f.mail);
    f.mail.send = async (message, authorize) => {
      if (revoke === 'unsubscribe') { const job = await f.store.get(c, f.sub.id); await f.subscriptions.unsubscribe(c, f.sub.id, job.spec.unsubscribeToken); }
      if (revoke === 'member') await f.db.transaction(c => c.query("UPDATE h2_memberships SET status = 'removed' WHERE tenant_id = 'tenant-one' AND user_id = 'admin'"));
      if (revoke === 'source') await f.sources.retire(await f.login(), f.source.id, f.source.version);
      return send(message, authorize);
    };
    await f.runner.deliver(); assert.equal(f.mail.messages.length, 0, revoke);
    const deliveries = await f.db.transaction(c => c.query('SELECT state FROM h7_deliveries')); assert.equal(deliveries[0].state, 'cancelled');
  }
});

test('digests: serverless due/execute/deliver and duplicate receipts work for a reader subscription', async t => {
  const f = await sr3Fixture(t); f.time.now = monday;
  await f.sql("UPDATE h1_resources SET body = ? WHERE tenant_id = 'tenant-one' AND kind = 'user' AND resource_id = 'admin'", [JSON.stringify({ name: 'Reader', role: 'reader' })]);
  const spec = newDigest('revenue', 'admin', digestInput);
  await f.put('digest', spec); const due = await f.event('job-due'); f.time.now += 7 * 86400000;
  await f.jobs.run(due); await f.jobs.run(due);
  await f.jobs.run(await f.event('job-execute')); const deliver = await f.event('job-deliver'); await f.jobs.run(deliver); await f.jobs.run(deliver);
  assert.equal(f.mail.messages.length, 1); assert.equal((await f.rows('h7_occurrences')).length, 1);
  assert.equal((await f.rows('h7_occurrences'))[0].state, 'succeeded');
});
