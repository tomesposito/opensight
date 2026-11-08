import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { database } from './hosted-helpers.mjs';
import { h8Fixture, serveH8 } from './h8-helpers.mjs';
import { hostedConfig } from '../dist/hosted-config.js';
import { StubMailTransport } from '../dist/mail.js';
import { HostedProvisioning, operatorOperationId } from '../dist/hosted-provisioning.js';
import { HostedBilling, initializeBilling } from '../dist/hosted-billing.js';
import { HostedSignup, initializeSignups, normalizeSignupEmail, SIGNUP_ACCEPTED } from '../dist/hosted-signup.js';
import { readOperatorAudit } from '../dist/operator-audit.js';
const input = (email = 'jane.doe+trial@gmail.com') => ({ displayName: 'Example reports', slug: 'example-reports', adminName: 'Jane', adminEmail: email, challengeToken: 'stub-ok' });
const token = mail => mail.messages.at(-1).html.match(/#signup=([\w-]+)/)[1];
async function fixture(t) {
  const f = await database(t); await initializeBilling(f.db); await initializeSignups(f.db);
  let now = Date.UTC(2026, 10, 6); const clock = () => now;
  const mail = new StubMailTransport(), blocklistFile = join(dirname(f.path), 'blocked.txt'); await writeFile(blocklistFile, 'disposable.test\n');
  const config = { enabled: true, origin: f.config.origin, encryptionKey: f.config.encryptionKey, blocklistFile, volumeCap: 25 };
  const billing = new HostedBilling(f.db, { apiKey: '', webhookSecret: '', priceIds: { light: 'pl', regular: 'pr', heavy: 'ph' }, tierEntitlements: {}, trialEntitlement: { apiCalls: 30000, storageBytes: 10000000000, computeAttempts: 1500 } }, { clock });
  const provisioning = new HostedProvisioning(f.db, f.config, mail, clock);
  const signup = new HostedSignup(f.db, provisioning, billing, mail, config, async v => v === 'stub-ok', clock);
  return { ...f, signup, billing, mail, config, advance: n => now += n };
}
test('197 signup: known provider normalization only', () => {
  assert.equal(normalizeSignupEmail('Jane.Doe+test@googlemail.com'), 'janedoe@gmail.com');
  assert.equal(normalizeSignupEmail('Jane.Doe+test@example.test'), 'jane.doe+test@example.test');
});
test('197 signup: concurrent verification uses existing operation once; trial starts on verify; consumed token cannot be reused', async t => {
  const f = await fixture(t); assert.deepEqual(await f.signup.request(input(), 'ip'), SIGNUP_ACCEPTED);
  const secret = token(f.mail); f.advance(3600000);
  const outcomes = await Promise.allSettled([f.signup.verify(secret), f.signup.verify(secret)]);
  assert.ok(outcomes.some(r => r.status === 'fulfilled'));
  const result = outcomes.find(r => r.status === 'fulfilled').value; assert.equal(result.invitationToken.length, 43);
  const rows = await f.db.transaction(c => c.query('SELECT * FROM h10_signups'));
  const tenants = await f.db.transaction(c => c.query('SELECT * FROM h1_tenants')); assert.equal(tenants.length, 1);
  const ops = await f.db.transaction(c => c.query('SELECT * FROM h2_onboarding')); assert.equal(ops.length, 1); assert.equal(ops[0].operation_id, operatorOperationId(`signup-${rows[0].id}`));
  assert.equal((await f.billing.state(result.tenantId)).trialEndsAt, new Date(Date.UTC(2026, 10, 20, 1)).toISOString());
  await assert.rejects(f.signup.verify(secret), { code: 'SIGNUP_ALREADY_VERIFIED' });
  const audits = await readOperatorAudit(f.db, { limit: 100 }); assert.equal(audits.find(a => a.action === 'tenant.provisioned').detail.via, 'self_serve_signup');
  assert.deepEqual(await f.signup.request({ ...input('janedoe@gmail.com'), slug: 'another' }, 'other-ip'), SIGNUP_ACCEPTED);
  assert.equal((await f.db.transaction(c => c.query('SELECT * FROM h10_signups'))).length, 1);
});
test('197 signup: expired and rotated tokens deny provisioning; resend and unknown replies match', async t => {
  const f = await fixture(t); await f.signup.request(input(), 'ip'); const first = token(f.mail);
  f.advance(86400000); await assert.rejects(f.signup.verify(first), { code: 'SIGNUP_TOKEN_EXPIRED' });
  assert.deepEqual(await f.signup.resend('unknown@example.test', 'ip'), await f.signup.resend(input().adminEmail, 'ip'));
  const next = token(f.mail); assert.notEqual(next, first);
  await assert.rejects(f.signup.verify(first), { code: 'SIGNUP_TOKEN_INVALID' });
  await f.signup.verify(next);
});
test('197 signup: blocklist, challenge and rate refusals create nothing and mail nothing', async t => {
  const f = await fixture(t);
  await assert.rejects(f.signup.request(input('test@sub.disposable.test'), 'ip'), { code: 'SIGNUP_PERMANENT_EMAIL_REQUIRED' });
  await assert.rejects(f.signup.request({ ...input(), challengeToken: 'forged' }, 'ip'), { code: 'SIGNUP_CHALLENGE_REQUIRED' });
  for (let n = 0; n < 5; n++) await assert.rejects(f.signup.request({ ...input(), challengeToken: '' }, 'limited'), { code: 'SIGNUP_CHALLENGE_REQUIRED' });
  await assert.rejects(f.signup.request(input(), 'limited'), { code: 'SIGNUP_RATE_LIMITED' });
  assert.equal(f.mail.messages.length, 0); assert.equal((await f.db.transaction(c => c.query('SELECT * FROM h10_signups'))).length, 0);
  for (let n = 0; n < 30; n++) await f.signup.slug('available', 'slug-ip');
  await assert.rejects(f.signup.slug('available', 'slug-ip'), { code: 'SIGNUP_RATE_LIMITED' });
  for (let n = 0; n < 3; n++) await f.signup.resend('unknown@example.test', 'resend-ip');
  await assert.rejects(f.signup.resend('unknown@example.test', 'resend-ip'), { code: 'SIGNUP_RATE_LIMITED' });
});
test('197 signup: disabled verify preserves pending signup', async t => {
  const f = await fixture(t); await f.signup.request(input(), 'ip'); const secret = token(f.mail);
  f.config.enabled = false; await assert.rejects(f.signup.verify(secret), { code: 'RESOURCE_NOT_FOUND' });
  assert.equal((await f.db.transaction(c => c.query('SELECT state FROM h10_signups')))[0].state, 'pending');
  f.config.enabled = true; await f.signup.verify(secret);
});
test('197 signup HTTP: default off is 404; enabled routes enforce site origin and enumerate safely', async t => {
  const off = await h8Fixture(t); const disabled = await serveH8(t, off);
  for (const path of ['/api/signup', '/api/signup/slug?slug=hello', '/api/signup/verify', '/api/signup/resend', '/api/signup/checkout']) assert.equal((await disabled.request(path, { method: path.includes('/slug') ? 'GET' : 'POST', headers: { origin: 'https://getopensight.org' }, body: path.includes('/slug') ? undefined : {} })).status, 404);
  const f = await h8Fixture(t), blocklist = join(dirname(f.path), 'blocked.txt'); await writeFile(blocklist, 'disposable.test');
  Object.assign(f.env, { OPENSIGHT_SIGNUP_ENABLED: 'true', OPENSIGHT_SIGNUP_BLOCKLIST_FILE: blocklist, OPENSIGHT_TRIAL_ENTITLEMENT: JSON.stringify({ apiCalls: 30000, storageBytes: 10000000000, computeAttempts: 1500 }), OPENSIGHT_STRIPE_SECRET_KEY: 'sk_test', OPENSIGHT_STRIPE_WEBHOOK_SECRET: 'whsec_test', OPENSIGHT_STRIPE_PRICE_LIGHT: 'price_l', OPENSIGHT_STRIPE_PRICE_REGULAR: 'price_r', OPENSIGHT_STRIPE_PRICE_HEAVY: 'price_h' });
  const mail = new StubMailTransport(), { request } = await serveH8(t, f, { mailTransport: mail, signupChallengeVerifier: async () => true });
  assert.equal((await request('/api/signup', { method: 'POST', body: input(), headers: { origin: 'https://evil.test' } })).status, 403);
  const headers = { origin: 'https://getopensight.org' };
  const unknown = await request('/api/signup', { method: 'POST', body: input(), headers });
  const known = await request('/api/signup', { method: 'POST', body: input('one@example.test'), headers });
  assert.equal(unknown.status, 202); assert.deepEqual(unknown, known);
  assert.deepEqual((await request('/api/signup/slug?slug=available', { headers })).body, { available: true });
});

test('197 operator: cap queues verified signups, preserves tokens, resumes later and audits switch', async t => {
  const { SignupOperator } = await import('../dist/hosted-signup-operator.js');
  const f = await fixture(t); f.config.volumeCap = 1;
  let now = Date.UTC(2026, 10, 6); const ops = new SignupOperator(f.db, f.signup, f.billing, () => now);
  await f.signup.request(input('first@example.test'), 'first-ip'); const first = token(f.mail);
  await f.signup.request({ ...input('second@example.test'), slug: 'second' }, 'second-ip'); const second = token(f.mail);
  await f.signup.verify(first); const queued = await f.signup.verify(second); assert.equal(queued.queued, true);
  let status = await ops.status(); assert.equal(status.trialsToday, 1); assert.equal(status.trialsLast24h, 1); assert.equal(status.queued, 1); assert.equal(status.pausedAtCap, true);
  await ops.setPaused(true); now += 86400001; f.advance(86400001);
  await ops.drain(); assert.equal((await ops.status()).queued, 1);
  f.config.enabled = false; await ops.setPaused(false); assert.equal((await ops.status()).queued, 1);
  f.config.enabled = true; await ops.drain(); status = await ops.status(); assert.equal(status.queued, 0); assert.equal(status.trialsLast24h, 1);
  assert.equal((await f.db.transaction(c => c.query('SELECT * FROM h1_tenants'))).length, 2);
  const audits = await readOperatorAudit(f.db, { limit: 100 }); assert.ok(audits.some(a => a.action === 'signup.paused')); assert.ok(audits.some(a => a.action === 'signup.resumed'));
});
test('197 operator: IP soft cap queues fourth trial and durable erasure keeps hashed lifetime identity', async t => {
  const { SignupOperator } = await import('../dist/hosted-signup-operator.js');
  const { purgeTenantRows, tenantDeletionInventory } = await import('../dist/tenant-erasure.js');
  const { migrateReference } = await import('../dist/single-node.js');
  const { referenceEnv } = await import('./h8-helpers.mjs');
  const f = await fixture(t); await migrateReference(f.db, referenceEnv, 'sqlite');
  const ops = new SignupOperator(f.db, f.signup, f.billing, () => Date.UTC(2026, 10, 6)); let firstTenant;
  for (let n = 0; n < 4; n++) {
    await f.signup.request({ ...input(`person${n}@example.test`), slug: `workspace-${n}` }, 'shared-ip');
    const result = await f.signup.verify(token(f.mail));
    if (!n) firstTenant = result.tenantId;
    assert.equal('queued' in result, n === 3);
  }
  assert.equal((await ops.status()).queued, 1);
  await f.db.transaction(c => purgeTenantRows(c, firstTenant));
  const remaining = await f.db.transaction(c => tenantDeletionInventory(c, firstTenant));
  assert.equal(remaining.filter(r => ['delete', 'scrub'].includes(r.action)).reduce((n, r) => n + r.count, 0), 0);
  const ledger = (await f.db.transaction(c => c.query('SELECT * FROM h10_signups WHERE tenant_id = ?', [firstTenant])))[0];
  assert.match(ledger.normalized_email, /^[a-f0-9]{64}$/); assert.equal(ledger.email, '');
  const before = (await f.db.transaction(c => c.query('SELECT * FROM h10_signups'))).length;
  assert.deepEqual(await f.signup.request(input('person0@example.test'), 'new-ip'), SIGNUP_ACCEPTED);
  assert.equal((await f.db.transaction(c => c.query('SELECT * FROM h10_signups'))).length, before);
});

test('197 HTTP: expired identity still signs in; only admins can checkout/export/close; operator switch requires credential', async t => {
  const { billingConfig } = await import('../dist/hosted-billing.js');
  const f = await h8Fixture(t); await initializeBilling(f.db);
  const now = Date.UTC(2026, 10, 6), clock = () => now + 15 * 86400000;
  Object.assign(f.env, { OPENSIGHT_SIGNUP_ENABLED: 'true', OPENSIGHT_TRIAL_ENTITLEMENT: JSON.stringify({ apiCalls: 30000, storageBytes: 10000000000, computeAttempts: 1500 }), OPENSIGHT_STRIPE_SECRET_KEY: 'sk_test', OPENSIGHT_STRIPE_WEBHOOK_SECRET: 'whsec_test', OPENSIGHT_STRIPE_PRICE_LIGHT: 'price_l', OPENSIGHT_STRIPE_PRICE_REGULAR: 'price_r', OPENSIGHT_STRIPE_PRICE_HEAVY: 'price_h' });
  const billing = new HostedBilling(f.db, billingConfig(f.env), { clock: () => now }); await billing.startTrial('tenant-one');
  const { request, operator } = await serveH8(t, f, { clock, signupChallengeVerifier: async () => true, stripeFetcher: async () => ({ ok: true, status: 200, json: async () => ({ id: 'cs_trial', url: 'https://checkout.stripe.com/c/pay/trial' }) }) });
  const headers = { authorization: 'one', origin: f.env.OPENSIGHT_PUBLIC_ORIGIN };
  const session = await request('/api/session', { headers }); assert.equal(session.status, 200); assert.equal(session.body.trial.daysRemaining, 0); assert.equal(session.body.billingPaused, true);
  assert.equal((await request('/api/users', { headers })).body.errorCode, 'TRIAL_EXPIRED');
  assert.equal((await request('/api/signup/checkout', { method: 'POST', headers, body: { tier: 'light' } })).status, 201);
  assert.equal((await request('/api/host/signups', { method: 'PATCH', headers, body: { paused: true } })).status, 403);
  assert.equal((await request('/api/host/signups', { method: 'PATCH', headers: { ...operator, origin: f.env.OPENSIGHT_PUBLIC_ORIGIN }, body: { paused: true } })).body.paused, true);
  await f.db.transaction(c => c.query(`UPDATE h1_resources SET body = ? WHERE tenant_id = 'tenant-one' AND resource_id = 'admin' AND kind = 'user'`, [JSON.stringify({ name: 'Reader', role: 'reader' })]));
  for (const [path, method, body] of [['/api/signup/checkout', 'POST', { tier: 'light' }], ['/api/workspace/export', 'GET', undefined], ['/api/workspace/close', 'POST', { confirmTenantId: 'tenant-one' }]]) assert.equal((await request(path, { headers, method, body })).body.errorCode, 'SECURITY_ADMIN_REQUIRED');
});

test('216 HTTP: dark signup flag also closes the namespace-scoped checkout route', async t => {
  const { billingConfig } = await import('../dist/hosted-billing.js');
  const f = await h8Fixture(t); await initializeBilling(f.db);
  const now = Date.UTC(2026, 10, 6), clock = () => now;
  // Billing is configured (a checkout session could be created), but
  // OPENSIGHT_SIGNUP_ENABLED is deliberately absent: signup stays dark.
  Object.assign(f.env, { OPENSIGHT_TRIAL_ENTITLEMENT: JSON.stringify({ apiCalls: 30000, storageBytes: 10000000000, computeAttempts: 1500 }), OPENSIGHT_STRIPE_SECRET_KEY: 'sk_test', OPENSIGHT_STRIPE_WEBHOOK_SECRET: 'whsec_test', OPENSIGHT_STRIPE_PRICE_LIGHT: 'price_l', OPENSIGHT_STRIPE_PRICE_REGULAR: 'price_r', OPENSIGHT_STRIPE_PRICE_HEAVY: 'price_h' });
  const billing = new HostedBilling(f.db, billingConfig(f.env), { clock }); await billing.startTrial('tenant-one');
  const { request } = await serveH8(t, f, { clock, signupChallengeVerifier: async () => true, stripeFetcher: async () => ({ ok: true, status: 200, json: async () => ({ id: 'cs_dark', url: 'https://checkout.stripe.com/c/pay/dark' }) }) });
  const headers = { authorization: 'one', origin: f.env.OPENSIGHT_PUBLIC_ORIGIN };
  for (const path of ['/api/signup/checkout', '/api/namespaces/one/signup/checkout']) {
    const res = await request(path, { method: 'POST', headers, body: { tier: 'light' } });
    assert.equal(res.status, 404, path); assert.equal(res.body.errorCode, 'RESOURCE_NOT_FOUND', path);
  }
  // Billing state stays readable on both routes while dark; only checkout closes.
  for (const path of ['/api/billing', '/api/namespaces/one/billing']) {
    const res = await request(path, { headers });
    assert.equal(res.status, 200, path); assert.equal(res.body.checkoutEnabled, false, path);
  }
});

test('197 durability: encrypted reference backup preserves trial, queue settings and lifetime signup identity', async t => {
  const { migrateReference } = await import('../dist/single-node.js');
  const { ReferenceMaintenance } = await import('../dist/single-node-maintenance.js');
  const { referenceEnv } = await import('./h8-helpers.mjs');
  const f = await fixture(t); await migrateReference(f.db, referenceEnv, 'sqlite');
  await f.signup.request(input(), 'ip'); await f.signup.verify(token(f.mail));
  await f.db.transaction(c => c.query('UPDATE h10_signup_settings SET paused = 1'));
  const directory = join(dirname(f.path), 'backups');
  const source = await ReferenceMaintenance.open(f.db, directory, f.config.encryptionKey, 'frozen'); const backup = await source.backup();
  const target = await database(t); await migrateReference(target.db, referenceEnv, 'sqlite');
  const restore = await ReferenceMaintenance.open(target.db, directory, f.config.encryptionKey, 'frozen'); await restore.restore(backup.id);
  assert.equal((await target.db.transaction(c => c.query('SELECT paused FROM h10_signup_settings')))[0].paused, 1);
  assert.deepEqual(await target.db.transaction(c => c.query('SELECT * FROM h10_signups')), await f.db.transaction(c => c.query('SELECT * FROM h10_signups')));
  assert.deepEqual(await target.db.transaction(c => c.query('SELECT * FROM h9_billing')), await f.db.transaction(c => c.query('SELECT * FROM h9_billing')));
});

test('197 operator: daily expired count survives same-day conversion', async t => {
  const { SignupOperator } = await import('../dist/hosted-signup-operator.js');
  const f = await fixture(t); let now = Date.UTC(2026, 10, 6);
  const ops = new SignupOperator(f.db, f.signup, f.billing, () => now);
  await f.signup.request(input(), 'ip'); const result = await f.signup.verify(token(f.mail));
  f.advance(14 * 86400000); now += 14 * 86400000;
  assert.equal((await ops.status()).expiredToday, 1);
  await f.billing.handleEvent({ id: 'evt_funnel', created: 1, type: 'checkout.session.completed', object: { subscription: 'sub_funnel', customer: 'cus_fixture', metadata: { tenant_id: result.tenantId, tier: 'light' }, payment_status: 'paid' } });
  const status = await ops.status(); assert.equal(status.expiredToday, 1); assert.equal(status.convertedToday, 1);
});

test('197 erasure inventory fails closed on permission errors for optional stores', async () => {
  const { hasErasureTable } = await import('../dist/tenant-erasure.js');
  await assert.rejects(hasErasureTable({ query: async sql => {
    if (sql.startsWith('SELECT')) throw Object.assign(new Error('permission denied'), { code: '42501' });
    return [];
  } }, 'h10_signups'), { code: '42501' });
});
