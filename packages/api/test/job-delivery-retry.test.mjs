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

for (const attempts of [MAX_DELIVERY_ATTEMPTS, MAX_DELIVERY_ATTEMPTS + 1]) {
  test(`#251 recovery dead-letters an interrupted delivery with ${attempts} attempts without another send`, async t => {
    const mail = new StubMailTransport(), send = t.mock.method(mail, 'send');
    const f = await jobFixture(t, executor(), mail); await f.put('job');
    const c = await f.login(), run = await f.store.enqueue(c, 'job'); await f.runner.execute(run);
    await f.db.transaction(c => c.query("UPDATE h7_deliveries SET state = 'sending', attempts = ?, message = 'cached' WHERE job_id = 'job'", [attempts]));
    const restarted = new JobRunner(f.store, f.executor, mail); await restarted.recover();
    const delivery = (await f.store.deliveries(c, 'job'))[0], settled = (await f.store.history(c, 'job'))[0];
    assert.equal(delivery.state, 'dead'); assert.equal(delivery.attempts, attempts);
    assert.equal(delivery.error_code, 'DELIVERY_INTERRUPTED');
    assert.equal((await f.db.transaction(c => c.query('SELECT message FROM h7_deliveries')))[0].message, null);
    assert.equal(settled.state, 'failed'); assert.equal(settled.errorCode, 'JOB_DELIVERY_EXHAUSTED');
    assert.equal(settled.finishedAt, f.store.clock().toISOString());
    for (let i = 0; i < 3; i++) { await restarted.recover(); await restarted.deliver(); await restarted.tick(); }
    assert.equal(send.mock.callCount(), 0);
    assert.deepEqual(await f.store.deliveries(c, 'job'), [delivery]);
    assert.deepEqual(await f.store.history(c, 'job'), [settled]);
  });
}

for (const attempts of [MAX_DELIVERY_ATTEMPTS, MAX_DELIVERY_ATTEMPTS + 1]) {
  test(`#251 a due pending delivery with ${attempts} attempts dead-letters without being claimed or sent`, async t => {
    const mail = new StubMailTransport(), send = t.mock.method(mail, 'send');
    const f = await jobFixture(t, executor(), mail); await f.put('job');
    const c = await f.login(), run = await f.store.enqueue(c, 'job'); await f.runner.execute(run);
    await f.db.transaction(c => c.query("UPDATE h7_deliveries SET attempts = ?, error_code = 'SMTP_SEND_FAILED', message = ? WHERE job_id = 'job'", [attempts, JSON.stringify({ subject: 'Cached report', html: '<p>Cached report</p>' })]));
    await f.runner.deliver();
    const delivery = (await f.store.deliveries(c, 'job'))[0], settled = (await f.store.history(c, 'job'))[0];
    assert.equal(delivery.state, 'dead'); assert.equal(delivery.attempts, attempts);
    assert.equal(delivery.error_code, 'SMTP_SEND_FAILED');
    assert.equal((await f.db.transaction(c => c.query('SELECT message FROM h7_deliveries')))[0].message, null);
    assert.equal(settled.state, 'failed'); assert.equal(settled.errorCode, 'JOB_DELIVERY_EXHAUSTED');
    assert.equal(settled.finishedAt, f.store.clock().toISOString());
    for (let i = 0; i < 3; i++) { await f.runner.deliver(); await f.runner.tick(); }
    assert.equal(send.mock.callCount(), 0);
    assert.deepEqual(await f.store.deliveries(c, 'job'), [delivery]);
    assert.deepEqual(await f.store.history(c, 'job'), [settled]);
  });
}

test('#251 SMTP acceptance with a lost receipt on the cap attempt dead-letters and stops resending', async t => {
  const mail = new StubMailTransport(), send = t.mock.method(mail, 'send');
  const f = await jobFixture(t, executor(), mail); await f.put('job');
  const c = await f.login(), run = await f.store.enqueue(c, 'job'); await f.runner.execute(run);
  await f.db.transaction(c => c.query("UPDATE h7_deliveries SET attempts = ? WHERE job_id = 'job'", [MAX_DELIVERY_ATTEMPTS - 1]));
  // Fail the durable receipt update after SMTP accepts, not the transport.
  const transaction = f.db.transaction.bind(f.db); let receiptFailures = 0;
  t.mock.method(f.db, 'transaction', work => transaction(c => work({ query(sql, args) {
    if (sql.includes("SET state = 'sent'")) { receiptFailures++; throw Object.assign(new Error('receipt unavailable'), { code: 'METADATA_UNAVAILABLE' }); }
    return c.query(sql, args);
  } })));
  await f.runner.deliver();
  const delivery = (await f.store.deliveries(c, 'job'))[0], settled = (await f.store.history(c, 'job'))[0];
  assert.equal(delivery.state, 'dead'); assert.equal(delivery.attempts, MAX_DELIVERY_ATTEMPTS);
  assert.equal(delivery.error_code, 'METADATA_UNAVAILABLE'); assert.equal(delivery.sent_at, null);
  assert.equal((await f.db.transaction(c => c.query('SELECT message FROM h7_deliveries')))[0].message, null);
  assert.equal(settled.state, 'failed'); assert.equal(settled.errorCode, 'JOB_DELIVERY_EXHAUSTED');
  assert.equal(settled.finishedAt, f.store.clock().toISOString());
  const restarted = new JobRunner(f.store, f.executor, mail);
  for (let i = 0; i < 3; i++) { await restarted.recover(); await restarted.deliver(); await restarted.tick(); }
  assert.equal(send.mock.callCount(), 1); assert.equal(mail.messages.length, 1); assert.equal(receiptFailures, 1);
  assert.equal(mail.messages[0].dedupeKey, delivery.delivery_id);
  assert.deepEqual(await f.store.deliveries(c, 'job'), [delivery]);
  assert.deepEqual(await f.store.history(c, 'job'), [settled]);
});

test('#251 a lost receipt below the cap stays recoverable and the next ambiguous cap attempt terminates', async t => {
  const mail = new StubMailTransport(), send = t.mock.method(mail, 'send');
  const f = await jobFixture(t, executor(), mail); await f.put('job');
  const c = await f.login(), run = await f.store.enqueue(c, 'job'); await f.runner.execute(run);
  await f.db.transaction(c => c.query('UPDATE h7_deliveries SET attempts = ?', [MAX_DELIVERY_ATTEMPTS - 2]));
  const transaction = f.db.transaction.bind(f.db);
  t.mock.method(f.db, 'transaction', work => transaction(c => work({ query(sql, args) {
    if (sql.includes("SET state = 'sent'")) throw new Error('interrupted receipt');
    return c.query(sql, args);
  } })));
  await assert.rejects(f.runner.deliver(), /interrupted receipt/);
  const ambiguous = (await f.store.deliveries(c, 'job'))[0];
  assert.equal(ambiguous.state, 'sending'); assert.equal(ambiguous.attempts, MAX_DELIVERY_ATTEMPTS - 1);
  assert.equal(ambiguous.error_code, null);
  const pending = (await f.store.history(c, 'job'))[0];
  assert.equal(pending.state, 'delivering'); assert.equal(pending.errorCode, null); assert.equal(pending.finishedAt, null);
  await f.runner.tick(); await f.runner.tick();
  const exhausted = (await f.store.deliveries(c, 'job'))[0];
  assert.equal(exhausted.state, 'dead'); assert.equal(exhausted.attempts, MAX_DELIVERY_ATTEMPTS);
  assert.equal(exhausted.error_code, 'JOB_EXECUTION_FAILED');
  assert.equal((await f.store.history(c, 'job'))[0].errorCode, 'JOB_DELIVERY_EXHAUSTED');
  assert.equal(send.mock.callCount(), 2); assert.equal(mail.messages.length, 1);
  assert.ok(send.mock.calls.every(call => call.arguments[0].dedupeKey === ambiguous.delivery_id));
});

test('#251 recovery rolls back dead-lettering and requeueing if occurrence settlement fails', async t => {
  const f = await jobFixture(t); await f.put('job'); await f.put('running');
  const c = await f.login(), run = await f.store.enqueue(c, 'job'); await f.runner.execute(run);
  await f.store.enqueue(c, 'running');
  await f.db.transaction(async c => {
    await c.query("UPDATE h7_occurrences SET state = 'running' WHERE job_id = 'running'");
    await c.query("UPDATE h7_deliveries SET state = 'sending', attempts = ? WHERE job_id = 'job'", [MAX_DELIVERY_ATTEMPTS]);
  });
  const transaction = f.db.transaction.bind(f.db);
  const fault = t.mock.method(f.db, 'transaction', work => transaction(c => work({ query(sql, args) {
    if (sql.startsWith('UPDATE h7_occurrences SET state = ?')) throw new Error('settlement unavailable');
    return c.query(sql, args);
  } })));
  await assert.rejects(f.runner.recover(), /settlement unavailable/);
  assert.equal((await f.store.deliveries(c, 'job'))[0].state, 'sending');
  assert.equal((await f.store.history(c, 'job'))[0].state, 'delivering');
  assert.equal((await f.store.history(c, 'running'))[0].state, 'running');
  fault.mock.restore(); await f.runner.recover();
  assert.equal((await f.store.deliveries(c, 'job'))[0].state, 'dead');
  assert.equal((await f.store.history(c, 'job'))[0].errorCode, 'JOB_DELIVERY_EXHAUSTED');
  assert.equal((await f.store.history(c, 'running'))[0].state, 'queued');
  assert.equal(f.mail.messages.length, 0);
});

test('#251 the atomic claim guard rejects a cap reached after the due snapshot', async t => {
  const mail = new StubMailTransport(), send = t.mock.method(mail, 'send');
  const f = await jobFixture(t, executor(), mail); await f.put('job');
  const c = await f.login(), run = await f.store.enqueue(c, 'job'); await f.runner.execute(run);
  const transaction = f.db.transaction.bind(f.db); let changed = false;
  t.mock.method(f.db, 'transaction', work => transaction(c => work({ async query(sql, args) {
    if (!changed && sql.includes('attempts = attempts + 1')) {
      changed = true; await c.query('UPDATE h7_deliveries SET attempts = ?', [MAX_DELIVERY_ATTEMPTS]);
    }
    return c.query(sql, args);
  } })));
  await f.runner.deliver(); assert.equal(changed, true);
  let delivery = (await f.store.deliveries(c, 'job'))[0];
  assert.equal(delivery.attempts, MAX_DELIVERY_ATTEMPTS); assert.equal(send.mock.callCount(), 0);
  await f.runner.deliver();
  delivery = (await f.store.deliveries(c, 'job'))[0];
  assert.equal(delivery.state, 'dead'); assert.equal(delivery.attempts, MAX_DELIVERY_ATTEMPTS);
  assert.equal(delivery.error_code, 'JOB_DELIVERY_EXHAUSTED');
  assert.equal((await f.store.history(c, 'job'))[0].errorCode, 'JOB_DELIVERY_EXHAUSTED');
  assert.equal(send.mock.callCount(), 0);
});

test('#251 accepted-send exhaustion uses the committed attempt count instead of the due snapshot', async t => {
  const f = await jobFixture(t); await f.put('job');
  const c = await f.login(), run = await f.store.enqueue(c, 'job'); await f.runner.execute(run);
  const transaction = f.db.transaction.bind(f.db);
  t.mock.method(f.db, 'transaction', work => transaction(c => work({ async query(sql, args) {
    if (sql.includes('attempts = attempts + 1')) await c.query('UPDATE h7_deliveries SET attempts = ?', [MAX_DELIVERY_ATTEMPTS - 1]);
    if (sql.includes("SET state = 'sent'")) throw new Error('interrupted receipt');
    return c.query(sql, args);
  } })));
  await f.runner.deliver();
  const delivery = (await f.store.deliveries(c, 'job'))[0];
  assert.equal(delivery.state, 'dead'); assert.equal(delivery.attempts, MAX_DELIVERY_ATTEMPTS);
  assert.equal((await f.store.history(c, 'job'))[0].errorCode, 'JOB_DELIVERY_EXHAUSTED');
  assert.equal(f.mail.messages.length, 1);
});

for (const path of ['recovery', 'claim', 'accepted receipt']) {
  test(`#251 ${path} exhaustion waits for remaining recipients before settling`, async t => {
    const f = await jobFixture(t); await f.put('job', { ...report, recipients: ['admin', 'other'] });
    const c = await f.login(), run = await f.store.enqueue(c, 'job'); await f.runner.execute(run);
    const due = new Date(f.store.clock().getTime() + 1000).toISOString();
    await f.db.transaction(async c => {
      await c.query("UPDATE h7_deliveries SET state = ?, attempts = ? WHERE recipient_id = 'admin'", [path === 'recovery' ? 'sending' : 'pending', MAX_DELIVERY_ATTEMPTS - (path === 'accepted receipt' ? 1 : 0)]);
      await c.query("UPDATE h7_deliveries SET next_attempt = ? WHERE recipient_id = 'other'", [due]);
    });
    const transaction = f.db.transaction.bind(f.db);
    const fault = t.mock.method(f.db, 'transaction', work => transaction(c => work({ query(sql, args) {
      if (path === 'accepted receipt' && sql.includes("SET state = 'sent'")) throw new Error('interrupted receipt');
      return c.query(sql, args);
    } })));
    if (path === 'recovery') await f.runner.recover(); else await f.runner.deliver();
    const deliveries = await f.store.deliveries(c, 'job');
    assert.equal(deliveries.find(d => d.recipient_id === 'admin').state, 'dead');
    assert.equal(deliveries.find(d => d.recipient_id === 'other').state, 'pending');
    const pending = (await f.store.history(c, 'job'))[0];
    assert.equal(pending.state, 'delivering'); assert.equal(pending.errorCode, null); assert.equal(pending.finishedAt, null);
    fault.mock.restore(); f.advance(1000); await f.runner.deliver();
    assert.equal((await f.store.deliveries(c, 'job')).find(d => d.recipient_id === 'other').state, 'sent');
    const settled = (await f.store.history(c, 'job'))[0];
    assert.equal(settled.state, 'failed'); assert.equal(settled.errorCode, 'JOB_DELIVERY_EXHAUSTED');
    assert.equal(settled.finishedAt, f.store.clock().toISOString());
  });
}

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
