import test from 'node:test';
import assert from 'node:assert/strict';
import { sr3Fixture } from './sr3-helpers.mjs';
import { report, refresh, executor } from './job-helpers.mjs';
import { MailError } from '../dist/mail.js';
import { MetadataError } from '../dist/metadata-db.js';

async function delivery(t, options) {
  const f = await sr3Fixture(t, options); await f.put();
  await f.store.enqueue(f.contexts[0], 'report'); await f.jobs.run(await f.event('job-execute'));
  return { ...f, envelope: await f.event('job-deliver') };
}
test('SR3 due hints coalesce missed intervals, arm the next one-shot, render per recipient and tolerate duplicate ack', async t => {
  const f = await sr3Fixture(t); await f.put(); const due = await f.event('job-due');
  await assert.rejects(f.jobs.run(due), { code: 'DISPATCH_EVENT_EARLY' });
  f.time.now += 600000;
  await f.jobs.run(due); await f.jobs.run(due);
  assert.equal((await f.rows('h7_occurrences')).length, 1);
  assert.equal((await f.rows('sr_job_due')).length, 2);
  const execute = await f.event('job-execute'); await f.jobs.run(execute); await f.jobs.run(execute);
  const send = await f.event('job-deliver'); await f.jobs.run(send); await f.jobs.run(send);
  assert.equal(f.mail.messages.length, 1); assert.equal(f.mail.messages[0].html, '<p>one/other</p>');
  assert.equal((await f.rows('h7_occurrences'))[0].state, 'succeeded');
});
test('SR3 refresh schedules next due from success or terminal failure and preserves bounded attempts', async t => {
  for (const fail of [false, true]) {
    const renderer = executor(); if (fail) renderer.execute = async () => { throw new MetadataError('SOURCE_DENIED', 403); };
    const f = await sr3Fixture(t, { executor: renderer }); await f.put('refresh', refresh);
    f.time.now += 60000; await f.jobs.run(await f.event('job-due'));
    assert.equal((await f.rows('h7_jobs'))[0].next_run, null);
    f.time.now += 5000;
    await f.jobs.run(await f.event('job-execute'));
    await f.jobs.run(await f.event('job-execute'));
    assert.equal(Date.parse((await f.rows('h7_jobs'))[0].next_run), f.time.now + 60000);
    assert.equal((await f.rows('h7_occurrences'))[0].state, fail ? 'failed' : 'succeeded');
  }
});
test('SR3 job commits cannot precede recovery ack and failed business commits leave no obligations', async t => {
  const f = await sr3Fixture(t);
  f.transport.recover = async () => { throw Error('lost recovery acknowledgement'); };
  await assert.rejects(f.put()); assert.equal((await f.rows('h7_jobs')).length, 0);
  f.transport.recover = async envelope => { f.calls.push({ envelope }); };
  f.faults.query = sql => { if (sql.startsWith('INSERT INTO sr_outbox')) throw Error('before commit'); };
  await assert.rejects(f.put()); assert.equal((await f.rows('h7_jobs')).length, 0);
  f.faults.query = undefined;
  await f.put(); assert.equal((await f.rows('h7_jobs')).length, 1);
});
test('SR3 accepted job commit survives lost immediate dispatch; recovery preserves the original event ID', async t => {
  const f = await sr3Fixture(t); f.transport.dispatch = async () => { throw Error('send lost'); };
  await f.put(); assert.equal((await f.rows('sr_outbox'))[0].state, 'pending');
  const original = (await f.rows('sr_outbox'))[0].event_id;
  f.transport.dispatch = async (envelope, event) => { f.calls.push({ envelope, event }); };
  await f.dispatch.recover(f.calls[0].envelope);
  assert.equal(f.calls[1].envelope.eventId, original);
});
test('SR3 crash after execution commit and before child dispatch is recovered by the parent receipt', async t => {
  const f = await sr3Fixture(t); await f.put(); await f.store.enqueue(f.contexts[0], 'report');
  const event = await f.event('job-execute');
  const send = f.transport.dispatch; f.transport.dispatch = async () => { throw Error('child send lost'); };
  await assert.rejects(f.jobs.run(event));
  assert.equal((await f.rows('h7_deliveries')).length, 1);
  assert.equal((await f.rows('h7_occurrences'))[0].state, 'delivering');
  f.transport.dispatch = send; await f.jobs.run(event);
  assert.equal((await f.rows('h7_deliveries')).length, 1);
  assert.ok((await f.rows('sr_outbox')).filter(r => r.kind === 'job-deliver').every(r => r.state === 'dispatched'));
});
test('SR3 every mail attempt rejects revoked recipient, owner, tenant and changed revisions before DATA', async t => {
  for (const sql of ["UPDATE h2_memberships SET status = 'removed' WHERE user_id = 'other'", "UPDATE h2_memberships SET status = 'removed' WHERE user_id = 'admin'", "UPDATE h1_tenants SET state = 'suspended'", 'UPDATE h1_revisions SET policy = policy + 1']) {
    const f = await delivery(t);
    const send = f.mail.send.bind(f.mail); f.mail.send = async (...args) => { await f.sql(sql); return send(...args); };
    await f.jobs.run(f.envelope); assert.equal(f.mail.messages.length, 0);
  }
});
test('SR3 editing/stopping queued or rendering jobs prevents obsolete mail and operator replay', async t => {
  for (const stop of [false, true]) {
    const f = await delivery(t);
    f.executor.render = async () => {
      if (stop) await f.store.stop(f.contexts[0], 'report', 1);
      else await f.put('report', { ...report, dashboardId: 'changed' }, 1);
      return { subject: 'obsolete', html: 'must not send' };
    };
    await f.jobs.run(f.envelope); assert.equal(f.mail.messages.length, 0);
    await assert.rejects(f.jobs.replay(f.envelope), { code: 'DISPATCH_REPLAY_DENIED' });
  }
});
test('SR3 SMTP acceptance with lost receipt stays ambiguous; only explicit reauthorized replay can resend', async t => {
  const messages = [], mail = { configured: true, async send(message, authorize) { await authorize(); messages.push(structuredClone(message)); } };
  const f = await delivery(t, { mail });
  f.faults.query = sql => { if (sql.includes("SET state = 'sent'")) throw Error('receipt store unavailable'); };
  await assert.rejects(f.jobs.run(f.envelope)); assert.equal(messages.length, 1);
  f.faults.query = undefined; f.time.now += 110001;
  await assert.rejects(f.jobs.run(f.envelope), { code: 'DELIVERY_AMBIGUOUS' });
  await assert.rejects(f.jobs.replay(f.envelope), { code: 'DELIVERY_AMBIGUOUS' });
  await f.jobs.replay(f.envelope, true); await f.jobs.run(f.envelope);
  assert.equal(messages.length, 2); assert.equal(messages[0].dedupeKey, messages[1].dedupeKey);
  assert.equal((await f.rows('h7_deliveries'))[0].message, null);
});
test('SR3 unconfigured SMTP fails closed, terminates after five attempts and never caches a body', async t => {
  const f = await delivery(t, { mail: { configured: false, send: async () => assert.fail('not configured') } });
  for (let i = 0; i < 4; i++) await assert.rejects(f.jobs.run(f.envelope), { code: 'SMTP_NOT_CONFIGURED' });
  await f.jobs.run(f.envelope); await f.jobs.run(f.envelope);
  const row = (await f.rows('h7_deliveries'))[0]; assert.equal(row.state, 'cancelled'); assert.equal(row.message, null);
  assert.equal((await f.rows('h7_occurrences'))[0].state, 'failed');
});
test('SR3 construction and idle time create zero background SQL queries or heartbeat timers', async t => {
  const f = await sr3Fixture(t); const count = f.queries.length;
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'] });
  t.mock.timers.tick(86400000); await Promise.resolve();
  assert.equal(f.queries.length, count); assert.equal(f.calls.length, 0);
  t.mock.timers.reset();
});

test('SR3 repeated manual requests coalesce and an administrator keeps the job owner as execution authority', async t => {
  const f = await sr3Fixture(t); await f.put();
  const first = await f.store.enqueue(f.contexts[0], 'report'), duplicate = await f.store.enqueue(f.contexts[0], 'report');
  assert.equal(first.id, duplicate.id); assert.equal((await f.rows('sr_outbox')).filter(r => r.kind === 'job-execute').length, 1);
  await f.sql("UPDATE h1_resources SET body = ? WHERE namespace_id = 'one' AND kind = 'user' AND resource_id = 'other'", [JSON.stringify({ name: 'Other', role: 'administrator' })]);
  await f.sql("UPDATE h7_jobs SET owner_id = 'other' WHERE job_id = 'report'");
  await f.sql("UPDATE h7_occurrences SET state = 'cancelled'");
  const run = await f.store.enqueue(f.contexts[0], 'report');
  assert.equal(run.ownerId, 'other'); assert.equal(run.initiatedBy, 'admin');
  const row = (await f.rows('sr_outbox')).find(r => r.aggregate_id === run.id);
  assert.equal(row.owner_id, 'other'); await f.jobs.run(await f.event('job-execute'));
});
test('SR3 lost business COMMIT acknowledgement is resolved by the already armed recovery event', async t => {
  const f = await sr3Fixture(t); let committed = false;
  f.faults.query = sql => { if (sql.includes("SET state = 'committed'")) committed = true; };
  f.faults.afterCommit = () => { if (committed) { f.faults.afterCommit = undefined; throw Error('commit acknowledgement lost'); } };
  await assert.rejects(f.put()); f.faults.query = undefined;
  assert.equal((await f.rows('h7_jobs')).length, 1);
  assert.equal((await f.rows('sr_outbox'))[0].state, 'pending');
  await f.dispatch.recover(f.calls[0].envelope);
  assert.equal((await f.rows('sr_outbox'))[0].state, 'dispatched');
});
test('SR3 lost outbox receipt safely republishes the same event and lost outcome commit does not duplicate children', async t => {
  const f = await sr3Fixture(t);
  f.faults.query = sql => { if (sql.includes("SET state = 'dispatched'")) throw Error('outbox receipt lost'); };
  await f.put(); const sent = f.calls.find(r => r.event).envelope;
  f.faults.query = undefined; await f.dispatch.recover(f.calls[0].envelope);
  assert.equal(f.calls.at(-1).envelope.eventId, sent.eventId);
  await f.store.enqueue(f.contexts[0], 'report'); const event = await f.event('job-execute');
  let outcome = false;
  f.faults.query = sql => { if (sql.includes("SET state = 'completed'")) outcome = true; };
  f.faults.afterCommit = () => { if (outcome) { f.faults.afterCommit = undefined; throw Error('outcome COMMIT acknowledgement lost'); } };
  await assert.rejects(f.jobs.run(event)); f.faults.query = undefined;
  await f.jobs.run(event); assert.equal((await f.rows('h7_deliveries')).length, 1);
  assert.equal((await f.rows('sr_outbox')).filter(r => r.kind === 'job-deliver').length, 1);
});
test('SR3 a failed fifth refresh attempt publishes its next obligation before acknowledging terminal failure', async t => {
  const renderer = executor(); renderer.execute = async () => { throw new MetadataError('WORKER_EXECUTION_FAILED', 503); };
  const f = await sr3Fixture(t, { executor: renderer }); await f.put('refresh', refresh); f.time.now += 60000;
  await f.jobs.run(await f.event('job-due')); const event = await f.event('job-execute');
  for (let attempt = 1; attempt < 5; attempt++) await assert.rejects(f.jobs.run(event), { code: 'WORKER_EXECUTION_FAILED' });
  await f.jobs.run(event);
  const next = (await f.rows('sr_outbox')).findLast(r => r.kind === 'job-due');
  assert.equal(next.state, 'dispatched'); assert.equal((await f.rows('h7_occurrences'))[0].state, 'failed');
});
test('SR3 expired due work stops that revision with named failure, without stopping an edited job', async t => {
  const f = await sr3Fixture(t); await f.put(); const old = await f.event('job-due');
  await f.put('report', report, 1); f.time.now += 86460001;
  await f.jobs.run(old);
  assert.equal((await f.rows('h7_jobs'))[0].stopped, 0);
  await f.jobs.run(await f.event('job-due'));
  assert.equal((await f.rows('h7_jobs'))[0].stopped, 1);
  assert.ok((await f.rows('sr_execution')).every(r => r.error_code === 'DISPATCH_EVENT_EXPIRED'));
});

test('SR3 cancellation after SMTP authorization records the accepted external effect without reviving the occurrence', async t => {
  const f = await delivery(t);
  const send = f.mail.send.bind(f.mail);
  f.mail.send = async (...args) => { await send(...args); await f.store.stop(f.contexts[0], 'report', 1); };
  await f.jobs.run(f.envelope);
  assert.equal(f.mail.messages.length, 1);
  const row = (await f.rows('h7_deliveries'))[0]; assert.equal(row.state, 'sent'); assert.equal(row.error_code, 'DELIVERY_ACCEPTED_AFTER_CANCEL');
  assert.equal((await f.rows('h7_occurrences'))[0].state, 'cancelled');
});

test('SR3 final-attempt SMTP ambiguity remains evidence after retry/expiry bounds and can never be replayed', async t => {
  const f = await delivery(t);
  // Four claimed attempts failed before SMTP. The fifth has an unknown DATA result.
  for (let i = 0; i < 4; i++) {
    const handle = await f.jobs.execution.claim(f.envelope); await f.jobs.execution.failed(handle, new MailError('SMTP_NOT_CONFIGURED'));
  }
  f.mail.send = async () => { throw new MailError('SMTP_SEND_FAILED'); };
  await assert.rejects(f.jobs.run(f.envelope), { code: 'SMTP_SEND_FAILED' });
  f.time.now += 86400001;
  await assert.rejects(f.jobs.run(f.envelope), { code: 'DELIVERY_AMBIGUOUS' });
  assert.equal((await f.rows('sr_execution')).find(r => r.event_id === f.envelope.eventId).state, 'ambiguous');
  assert.equal((await f.rows('h7_deliveries'))[0].error_code, 'DELIVERY_AMBIGUOUS');
  await assert.rejects(f.jobs.replay(f.envelope, true), { code: 'DISPATCH_REPLAY_DENIED' });
});
test('SR3 operator replay prearms before mutation and an uncertain recovery receipt never reopens ambiguous mail', async t => {
  const f = await delivery(t);
  const handle = await f.jobs.execution.claim(f.envelope); await f.jobs.execution.failed(handle, new MailError('SMTP_SEND_FAILED'), true);
  f.transport.recover = async () => { throw new MetadataError('RECOVERY_ACK_LOST', 503); };
  await assert.rejects(f.jobs.replay(f.envelope, true), { code: 'RECOVERY_ACK_LOST' });
  assert.equal((await f.rows('sr_execution')).find(r => r.event_id === f.envelope.eventId).state, 'ambiguous');
});

test('SR3 delivery rechecks the rendered artifact certificate before SMTP DATA', async t => {
  const f = await delivery(t);
  f.executor.verifyDelivery = async () => { throw new MetadataError('BLAZE_INVALIDATED', 409); };
  await f.jobs.run(f.envelope);
  assert.equal(f.mail.messages.length, 0);
  assert.equal((await f.rows('h7_deliveries'))[0].error_code, 'BLAZE_INVALIDATED');
});
