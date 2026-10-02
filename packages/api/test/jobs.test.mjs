import test from 'node:test';
import assert from 'node:assert/strict';
import { Scheduler } from '../dist/schedule.js';
import { JobRunner } from '../dist/job-runner.js';
import { MailError, StubMailTransport } from '../dist/mail.js';
import { jobFixture, executor, report, refresh } from './job-helpers.mjs';

test('H7 fake timers coalesce due/manual work and refresh cadence starts at completion', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setInterval'], now: new Date('2026-10-02T00:00:00Z') });
  let calls = 0, release, started;
  const entered = new Promise(r => { started = r; }), wait = new Promise(r => { release = r; });
  const execute = executor(); execute.execute = async () => { calls++; started(); await wait; return {}; };
  const f = await jobFixture(t, execute, undefined, () => new Date()); await f.put('refresh', refresh);
  const c = await f.login(), scheduler = new Scheduler(() => f.runner.tick()); scheduler.start(); await scheduler.idle(); t.after(() => scheduler.stop());
  t.mock.timers.tick(60000); await entered;
  const manual = await f.store.enqueue(c, 'refresh');
  t.mock.timers.tick(3600000); assert.equal(calls, 1);
  release(); await scheduler.idle();
  assert.equal((await f.store.history(c, 'refresh')).length, 1);
  assert.equal((await f.store.history(c, 'refresh'))[0].id, manual.id);
  assert.equal((await f.store.get(c, 'refresh')).nextRun, '2026-10-02T01:02:00.000Z');
  t.mock.timers.tick(59000); await scheduler.idle(); assert.equal(calls, 1);
  t.mock.timers.tick(1000); await scheduler.idle(); assert.equal(calls, 2);
});
test('H7 histories, recipients, contexts and coincident job IDs remain tenant/owner scoped', async t => {
  const f = await jobFixture(t); await f.put('same'); await f.put('same', report, 'two');
  const c = await f.login(); await f.store.enqueue(c, 'same'); await f.runner.tick();
  assert.equal((await f.store.history(c, 'same')).length, 1);
  assert.equal((await f.store.history(await f.login('two'), 'same')).length, 0);
  assert.deepEqual((await f.store.recipients(c)).map(r => r.email), ['one-admin@example.test', 'one-other@example.test']);
  await assert.rejects(f.store.list({ ...c }), { code: 'TENANT_CONTEXT_REQUIRED' });
  await f.metadata.put(c, { kind: 'user', id: 'other' }, { name: 'Other', role: 'author' }, 1);
  await assert.rejects(f.store.history(await f.login('one', 'other'), 'same'), { code: 'RESOURCE_NOT_FOUND' });
  assert.equal(f.mail.messages[0].html, '<p>one/other</p>');
});
test('H7 queued and running permission changes fail closed before publication/outbox', async t => {
  for (const phase of ['queued', 'running']) {
    const execute = executor(), f = await jobFixture(t, execute); await f.put('job'); const c = await f.login();
    const run = await f.store.enqueue(c, 'job');
    let release, started; const entered = new Promise(r => { started = r; }), wait = new Promise(r => { release = r; });
    execute.execute = async () => { started(); await wait; return {}; };
    const running = phase === 'running' ? f.runner.execute(run) : undefined;
    if (running) await entered;
    await f.metadata.put(c, { kind: 'user', id: 'admin' }, { name: 'Changed', role: 'reader' }, 1);
    release(); if (running) await running; else await f.runner.execute(run);
    await f.runner.deliver(); assert.equal(f.mail.messages.length, 0);
    const history = await f.store.history(await f.login(), 'job'); assert.equal(history[0].state, 'failed'); assert.equal(history[0].errorCode, 'JOB_AUTHORIZATION_REVISED');
  }
});
test('H7 orphaned recurring jobs stop and revoked recipients never receive queued mail', async t => {
  const f = await jobFixture(t); await f.put('orphan'); await f.put('report', report, 'two');
  const run = await f.store.enqueue(await f.login('two'), 'report'); await f.runner.execute(run);
  await f.db.transaction(async c => {
    await c.query("UPDATE h2_memberships SET status = 'removed' WHERE namespace_id = 'one' AND user_id = 'admin'");
    await c.query("UPDATE h2_memberships SET status = 'removed' WHERE namespace_id = 'two' AND user_id = 'other'");
  });
  f.advance(60000); await f.runner.tick();
  assert.equal((await f.store.get(await f.login('one', 'other'), 'orphan')).stopped, true);
  assert.equal(f.mail.messages.length, 0);
  assert.equal((await f.store.deliveries(await f.login('two'), 'report'))[0].error_code, 'JOB_PRINCIPAL_UNAVAILABLE');
});
test('H7 interrupted execution recovers one occurrence and failed mail retries with the same key', async t => {
  const receipts = new Set(), mail = new StubMailTransport(receipts), f = await jobFixture(t, executor(), mail);
  await f.put('job'); const c = await f.login(), run = await f.store.enqueue(c, 'job');
  await f.db.transaction(c => c.query("UPDATE h7_occurrences SET state = 'running'"));
  const restarted = new JobRunner(f.store, f.executor, mail); await restarted.recover();
  const original = mail.send.bind(mail); let failed = false;
  mail.send = async (...args) => { if (!failed) { failed = true; throw new MailError('SMTP_SEND_FAILED'); } return original(...args); };
  await restarted.tick(); assert.equal(mail.messages.length, 0);
  f.advance(1000); await restarted.tick(); await restarted.tick();
  assert.equal(mail.messages.length, 1); assert.equal((await f.store.history(c, 'job'))[0].id, run.id);
  assert.equal((await f.store.deliveries(c, 'job'))[0].attempts, 2);
});
test('H7 crash after mail acceptance before receipt commit retries without duplicate stub sends', async t => {
  const receipts = new Set(), mail = new StubMailTransport(receipts), f = await jobFixture(t, executor(), mail);
  await f.put('job'); const c = await f.login(), run = await f.store.enqueue(c, 'job'); await f.runner.execute(run);
  // Fault the receipt transaction after the transport has accepted the message.
  const transaction = f.db.transaction.bind(f.db); let fault = true;
  f.db.transaction = work => transaction(c => work({ query(sql, args) { if (fault && sql.includes("SET state = 'sent'")) { fault = false; throw new Error('interrupted receipt'); } return c.query(sql, args); } }));
  // Model a process death, not a completed failure handler.
  const originalSend = mail.send.bind(mail); mail.send = async (...args) => { await originalSend(...args); };
  await assert.rejects(f.runner.deliver(), /interrupted receipt/); assert.equal(mail.messages.length, 1);
  assert.equal((await f.store.deliveries(c, 'job'))[0].state, 'sending');
  const resumedMail = new StubMailTransport(receipts), restarted = new JobRunner(f.store, f.executor, resumedMail);
  await restarted.recover(); await restarted.deliver();
  assert.equal(resumedMail.messages.length, 0); assert.equal((await f.store.deliveries(c, 'job'))[0].state, 'sent');
});
