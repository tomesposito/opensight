import test from 'node:test';
import assert from 'node:assert/strict';
import { JobRunner } from '../dist/job-runner.js';
import { MailError, StubMailTransport } from '../dist/mail.js';
import { MAX_DELIVERY_ATTEMPTS } from '../dist/digest-delivery.js';
import { jobFixture, executor, report } from './job-helpers.mjs';

const failingMail = () => { const mail = new StubMailTransport(); mail.send = async () => { throw new MailError('SMTP_SEND_FAILED'); }; return mail; };
/** One attempt per tick; the advance keeps every backoff (capped at 1h) due. */
const attemptTicks = async (f, runner, n) => { for (let i = 0; i < n; i++) { await runner.tick(); f.advance(3700000); } };

test('H7 a retryable delivery dead-letters at the attempt cap and its occurrence settles exhausted', async t => {
  const f = await jobFixture(t, executor(), failingMail()); await f.put('job');
  const c = await f.login(), run = await f.store.enqueue(c, 'job');
  await attemptTicks(f, f.runner, MAX_DELIVERY_ATTEMPTS - 1);
  let delivery = (await f.store.deliveries(c, 'job'))[0];
  assert.equal(delivery.state, 'pending'); assert.equal(delivery.attempts, MAX_DELIVERY_ATTEMPTS - 1);
  assert.equal((await f.store.history(c, 'job'))[0].state, 'delivering');
  await attemptTicks(f, f.runner, 1);
  delivery = (await f.store.deliveries(c, 'job'))[0];
  assert.equal(delivery.state, 'dead'); assert.equal(delivery.attempts, MAX_DELIVERY_ATTEMPTS);
  assert.equal(delivery.error_code, 'SMTP_SEND_FAILED');
  const history = await f.store.history(c, 'job');
  assert.equal(history.length, 1); assert.equal(history[0].id, run.id);
  assert.equal(history[0].state, 'failed'); assert.equal(history[0].errorCode, 'JOB_DELIVERY_EXHAUSTED');
});

test('H7 after dead-lettering, claim admits the next period as a new occurrence', async t => {
  const f = await jobFixture(t, executor(), failingMail()); await f.put('job');
  const c = await f.login(), first = await f.store.enqueue(c, 'job');
  await attemptTicks(f, f.runner, MAX_DELIVERY_ATTEMPTS);
  assert.equal((await f.store.deliveries(c, 'job'))[0].state, 'dead');
  const second = await f.store.enqueue(c, 'job');
  assert.notEqual(second.id, first.id); assert.equal(second.state, 'queued');
  await f.runner.tick();
  const deliveries = await f.store.deliveries(c, 'job');
  assert.equal(deliveries.length, 2);
  const current = deliveries.find(d => d.occurrence_id === second.id);
  assert.equal(current.state, 'pending'); assert.equal(current.attempts, 1);
  assert.equal((await f.store.history(c, 'job')).length, 2);
});

test('H7 restart recovery never resurrects a dead delivery and a recovered sending delivery at the cap dead-letters on its next failure', async t => {
  let sends = 0; const mail = new StubMailTransport();
  mail.send = async () => { sends++; throw new MailError('SMTP_SEND_FAILED'); };
  const f = await jobFixture(t, executor(), mail); await f.put('job');
  const c = await f.login(), run = await f.store.enqueue(c, 'job'); await f.runner.execute(run);
  await f.db.transaction(c => c.query("UPDATE h7_deliveries SET state = 'sending', attempts = ? WHERE job_id = 'job'", [MAX_DELIVERY_ATTEMPTS - 1]));
  const restarted = new JobRunner(f.store, f.executor, mail); await restarted.recover();
  assert.equal((await f.store.deliveries(c, 'job'))[0].state, 'pending');
  await restarted.deliver(); assert.equal(sends, 1);
  const delivery = (await f.store.deliveries(c, 'job'))[0];
  assert.equal(delivery.state, 'dead'); assert.equal(delivery.attempts, MAX_DELIVERY_ATTEMPTS);
  await restarted.recover(); await restarted.deliver(); assert.equal(sends, 1);
  assert.equal((await f.store.deliveries(c, 'job'))[0].state, 'dead');
});

test('H7 operator retry restarts a dead delivery in place and the occurrence can still succeed', async t => {
  const mail = failingMail(), f = await jobFixture(t, executor(), mail); await f.put('job');
  const c = await f.login(), run = await f.store.enqueue(c, 'job');
  await attemptTicks(f, f.runner, MAX_DELIVERY_ATTEMPTS);
  const dead = (await f.store.deliveries(c, 'job'))[0]; assert.equal(dead.state, 'dead');
  const retried = await f.store.retryDelivery(c, 'job', dead.delivery_id);
  assert.equal(retried.delivery_id, dead.delivery_id); assert.equal(retried.state, 'pending'); assert.equal(retried.attempts, 0);
  assert.equal((await f.store.deliveries(c, 'job')).length, 1);
  assert.equal((await f.store.history(c, 'job'))[0].state, 'delivering');
  await assert.rejects(f.store.retryDelivery(c, 'job', dead.delivery_id), { code: 'DELIVERY_NOT_DEAD' });
  const stub = new StubMailTransport(); mail.send = stub.send.bind(stub); await f.runner.tick();
  const sent = (await f.store.deliveries(c, 'job'))[0];
  assert.equal(sent.state, 'sent'); assert.equal(sent.delivery_id, dead.delivery_id); assert.equal(sent.attempts, 1);
  const history = await f.store.history(c, 'job');
  assert.equal(history[0].id, run.id); assert.equal(history[0].state, 'succeeded'); assert.equal(history[0].errorCode, null);
  await assert.rejects(f.store.retryDelivery(c, 'job', dead.delivery_id), { code: 'DELIVERY_NOT_DEAD' });
});

test('H7 delivery retry is owner/administrator only and refuses stopped or revised jobs', async t => {
  const f = await jobFixture(t, executor(), failingMail()); await f.put('job');
  const c = await f.login(); await f.store.enqueue(c, 'job');
  await attemptTicks(f, f.runner, MAX_DELIVERY_ATTEMPTS);
  const dead = (await f.store.deliveries(c, 'job'))[0]; assert.equal(dead.state, 'dead');
  // Both fixture users start as administrators; demote 'other' to a plain
  // author so the owner/administrator visibility rule is what refuses it.
  await f.metadata.put(c, { kind: 'user', id: 'other' }, { name: 'Other', role: 'author' }, 1);
  await assert.rejects(f.store.retryDelivery(await f.login('one', 'other'), 'job', dead.delivery_id), { code: 'RESOURCE_NOT_FOUND' });
  const admin = await f.login();
  await assert.rejects(f.store.retryDelivery(admin, 'job', 'missing-delivery'), { code: 'RESOURCE_NOT_FOUND' });
  await f.store.stop(admin, 'job', 1);
  await assert.rejects(f.store.retryDelivery(admin, 'job', dead.delivery_id), { code: 'JOB_STOPPED' });
  // An administrator may retry another owner's dead delivery on a live job.
  const g = await jobFixture(t, executor(), failingMail()); await g.put('job', report, 'one', 'other');
  const owner = await g.login('one', 'other'); await g.store.enqueue(owner, 'job');
  await attemptTicks(g, g.runner, MAX_DELIVERY_ATTEMPTS);
  const foreign = (await g.store.deliveries(owner, 'job'))[0]; assert.equal(foreign.state, 'dead');
  const retried = await g.store.retryDelivery(await g.login(), 'job', foreign.delivery_id);
  assert.equal(retried.state, 'pending'); assert.equal(retried.delivery_id, foreign.delivery_id);
  // Revising the job after dead-lettering fences the retry out.
  const h = await jobFixture(t, executor(), failingMail()); await h.put('job');
  const hc = await h.login(); await h.store.enqueue(hc, 'job');
  await attemptTicks(h, h.runner, MAX_DELIVERY_ATTEMPTS);
  const stale = (await h.store.deliveries(hc, 'job'))[0]; assert.equal(stale.state, 'dead');
  await h.put('job', { ...report, dashboardId: 'changed' }, 'one', 'admin', 1);
  await assert.rejects(h.store.retryDelivery(hc, 'job', stale.delivery_id), { code: 'JOB_REVISED' });
});

test('H7 mixed outcomes settle by the worst terminal state: dead beats cancelled beats sent', async t => {
  const two = { ...report, recipients: ['admin', 'other'] };
  for (const [code, expected] of [['SMTP_SEND_FAILED', 'JOB_DELIVERY_EXHAUSTED'], ['SMTP_SEND_INVALID', 'JOB_DELIVERY_CANCELLED']]) {
    const mail = new StubMailTransport(), original = mail.send.bind(mail);
    mail.send = async (message, ...rest) => { if (message.to?.includes('one-other@example.test')) throw new MailError(code); return original(message, ...rest); };
    const f = await jobFixture(t, executor(), mail); await f.put('job', two);
    const c = await f.login(); await f.store.enqueue(c, 'job');
    await attemptTicks(f, f.runner, MAX_DELIVERY_ATTEMPTS);
    const deliveries = await f.store.deliveries(c, 'job');
    assert.equal(deliveries.find(d => d.recipient_id === 'admin').state, 'sent');
    assert.equal(deliveries.find(d => d.recipient_id === 'other').state, expected === 'JOB_DELIVERY_EXHAUSTED' ? 'dead' : 'cancelled');
    const history = await f.store.history(c, 'job');
    assert.equal(history[0].state, 'failed'); assert.equal(history[0].errorCode, expected);
  }
});
