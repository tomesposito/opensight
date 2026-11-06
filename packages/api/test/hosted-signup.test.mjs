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
