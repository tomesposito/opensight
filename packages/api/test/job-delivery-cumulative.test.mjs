import test from 'node:test';
import assert from 'node:assert/strict';
import { JobRunner } from '../dist/job-runner.js';
import { DurableJobs } from '../dist/durable-jobs.js';
import { MailError } from '../dist/mail.js';
import { MAX_DELIVERY_TOTAL_ATTEMPTS } from '../dist/digest-delivery.js';
import { jobFixture, migrateLegacyDeliveryAttempts } from './job-helpers.mjs';
import { sr3Fixture } from './sr3-helpers.mjs';

for (const durable of [false, true]) for (const outcome of ['success', 'SMTP failure', 'receipt crash']) {
  test(`#296 ${durable ? 'SR3' : 'H7'} migrated 29 attempts allows only one more after retry and restart: ${outcome}`, async t => {
    const f = durable ? await sr3Fixture(t) : await jobFixture(t);
    const jobId = 'report', context = durable ? f.contexts[0] : await f.login();
    await f.put(jobId);
    const run = await f.store.enqueue(context, jobId);
    if (durable) await f.jobs.run(await f.event('job-execute'));
    else await f.runner.execute(run);
    const envelope = durable ? await f.event('job-deliver') : undefined;
    const deliver = () => durable ? f.jobs.run(envelope) : f.runner.deliver();

    await migrateLegacyDeliveryAttempts(f.db, MAX_DELIVERY_TOTAL_ATTEMPTS - 1);
    const migrated = (await f.store.deliveries(context, jobId))[0];
    assert.equal(Number(migrated.attempts), 29); assert.equal(Number(migrated.total_attempts), 29);
    assert.equal(Number(migrated.retry_sequences), 0);
    const send = t.mock.method(f.mail, 'send', async (message, authorize) => {
      await authorize();
      assert.equal(message.dedupeKey, migrated.delivery_id);
      if (outcome === 'SMTP failure') throw new MailError('SMTP_SEND_FAILED');
    });
    await deliver();
    assert.equal((await f.store.deliveries(context, jobId))[0].state, 'dead');
    assert.equal(send.mock.callCount(), 0);
    const retried = await f.store.retryDelivery(context, jobId, migrated.delivery_id);
    assert.equal(retried.state, 'pending'); assert.equal(retried.attempts, 0);
    assert.equal(retried.total_attempts, 29); assert.equal(retried.retry_sequences, 1);

    // A crash after SMTP acceptance also loses the H7 terminal write. Leave
    // the committed attempt in sending so a new runner must recover it.
    const transaction = f.db.transaction.bind(f.db);
    const fault = t.mock.method(f.db, 'transaction', work => transaction(c => work({ query(sql, args) {
      if (outcome === 'receipt crash' && (sql.includes("SET state = 'sent'")
        || !durable && sql.startsWith('UPDATE h7_deliveries SET state = ?'))) throw new Error('receipt unavailable');
      return c.query(sql, args);
    } })));
    if (outcome === 'receipt crash') await assert.rejects(deliver(), durable ? { code: 'COORDINATION_UNAVAILABLE' } : /receipt unavailable/);
    else if (durable && outcome === 'SMTP failure') await assert.rejects(deliver(), { code: 'SMTP_SEND_FAILED' });
    else await deliver();
    fault.mock.restore();
    const attempted = (await f.store.deliveries(context, jobId))[0];
    assert.equal(Number(attempted.attempts), 1); assert.equal(Number(attempted.total_attempts), 30);
    assert.equal(attempted.state, outcome === 'receipt crash' ? 'sending' : outcome === 'success' ? 'sent' : 'dead');

    if (durable) {
      f.time.now += 110001;
      const restarted = new DurableJobs(f.store, f.executor, f.mail);
      if (outcome === 'receipt crash') await assert.rejects(restarted.run(envelope), { code: 'DELIVERY_AMBIGUOUS' });
      await restarted.run(envelope); await restarted.run(envelope);
      await assert.rejects(restarted.replay(envelope, true), { code: 'DISPATCH_REPLAY_DENIED' });
      assert.equal((await f.rows('sr_outbox')).find(r => r.event_id === envelope.eventId).state, 'terminal');
    } else {
      const restarted = new JobRunner(f.store, f.executor, f.mail);
      await restarted.recover(); await restarted.deliver(); await restarted.tick();
    }
    const final = (await f.store.deliveries(context, jobId))[0], history = await f.store.history(context, jobId);
    assert.equal(final.state, outcome === 'success' ? 'sent' : 'dead');
    assert.equal(Number(final.attempts), 1); assert.equal(Number(final.total_attempts), 30);
    assert.equal(Number(final.retry_sequences), 1); assert.equal(final.delivery_id, migrated.delivery_id);
    assert.equal(send.mock.callCount(), 1); assert.equal(history.length, 1); assert.equal(history[0].id, run.id);
    assert.equal(history[0].state, outcome === 'success' ? 'succeeded' : 'failed');
    assert.equal(history[0].errorCode, outcome === 'success' ? null : 'JOB_DELIVERY_EXHAUSTED');
    await assert.rejects(f.store.retryDelivery(context, jobId, final.delivery_id), {
      code: outcome === 'success' ? 'DELIVERY_NOT_DEAD' : 'DELIVERY_RETRY_BUDGET_EXHAUSTED',
    });
    assert.deepEqual(await f.store.deliveries(context, jobId), [final]);
  });
}
