import test from 'node:test';
import assert from 'node:assert/strict';
import { h8Fixture } from './h8-helpers.mjs';
import { HostedBilling, initializeBilling } from '../dist/hosted-billing.js';
import { TenantMailTransport, initializeTenantMail, MONTHLY_EMAILS } from '../dist/hosted-mail.js';
import { StubMailTransport } from '../dist/mail.js';

async function fixture(t) {
  const f = await h8Fixture(t); await initializeBilling(f.db); await initializeTenantMail(f.db);
  let now = Date.UTC(2026, 10, 28);
  const billing = new HostedBilling(f.db, { apiKey: '', webhookSecret: '', priceIds: { light: 'price_l', regular: 'price_r', heavy: 'price_h' }, tierEntitlements: {}, trialEntitlement: { apiCalls: 30000, storageBytes: 10000000000, computeAttempts: 1500 } }, { clock: () => now });
  const stub = new StubMailTransport(); const mail = new TenantMailTransport(f.db, billing, stub, () => now);
  return { ...f, billing, stub, mail, advance: n => now += n, send: (n, key) => mail.send({ tenantId: 'tenant-one', to: Array.from({ length: n }, (_, i) => `person${i}@example.test`), subject: 'Test', html: '<p>Test</p>', dedupeKey: key }) };
}
test('197 mail: trial is 25 total across month boundary, recipient-counted, retry-idempotent; operator excluded', async t => {
  const f = await fixture(t); await f.billing.startTrial('tenant-one');
  await f.send(24, 'first'); await f.send(24, 'first');
  f.advance(4 * 86400000); await f.send(1, 'last');
  await assert.rejects(f.send(1, 'overflow'), { code: 'EMAIL_LIMIT_EXCEEDED' });
  await f.mail.send({ to: ['admin@example.test'], subject: 'Operator', html: '' });
  assert.equal(f.stub.messages.length, 3);
  f.advance(11 * 86400000); await assert.rejects(f.send(1, 'expired'), { code: 'TRIAL_EXPIRED' });
});
test('197 mail: paid D-82 allowance resets monthly and concurrent sends cannot exceed it', async t => {
  const f = await fixture(t);
  assert.deepEqual(MONTHLY_EMAILS, { free: 100, light: 500, regular: 5000, heavy: 25000 });
  await f.billing.handleEvent({ id: 'evt_paidmail', created: 1, type: 'checkout.session.completed', object: { subscription: 'sub_mail', customer: 'cus_fixture', metadata: { tenant_id: 'tenant-one', tier: 'light' }, payment_status: 'paid' } });
  await f.send(499, 'start');
  const results = await Promise.allSettled([f.send(1, 'a'), f.send(1, 'b')]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.find(r => r.status === 'rejected').reason.code, 'EMAIL_LIMIT_EXCEEDED');
  f.advance(4 * 86400000); await f.send(500, 'new-month');
  await assert.rejects(f.send(1, 'over-new-month'), { code: 'EMAIL_LIMIT_EXCEEDED' });
});
test('197 mail: failed authorization does not charge or send; absent billing preserves operator tenants', async t => {
  const f = await fixture(t); await f.billing.startTrial('tenant-one');
  await assert.rejects(f.mail.send({ tenantId: 'tenant-one', to: ['test@example.test'], subject: 'Test', html: '' }, async () => { throw new Error('revoked'); }), /revoked/);
  assert.equal(f.stub.messages.length, 0); await f.send(25, 'all');
});
