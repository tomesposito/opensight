import test from 'node:test';
import assert from 'node:assert/strict';
import { h8Fixture } from './h8-helpers.mjs';
import { HostedUsage, initializeUsage, entitlementConfig } from '../dist/hosted-usage.js';
import { billingConfig } from '../dist/hosted-billing.js';
const base = { apiCalls: 10000, storageBytes: 1000000, computeAttempts: 100 };
const scope = { tenantId: 'tenant-one', namespaceId: 'one' };
test('#190 monthly credits span daily rows, deny at the boundary, and reset at UTC month', async t => {
  const f = await h8Fixture(t); await initializeUsage(f.db);
  let now = Date.UTC(2026, 10, 1);
  const usage = new HostedUsage(f.db, { defaults: { ...base, aiCallsPerMonth: 10 }, tenants: {} }, () => now), meter = usage.aiMeter();
  for (let i = 0; i < 10; i++) { now += 86400000; await meter.check('one', true); await meter.commit('one', 20, false); }
  assert.equal((await meter.credits('one')).remaining, 0);
  await assert.rejects(meter.check('one', true), { code: 'AI_CREDITS_EXHAUSTED' });
  // A completion admitted concurrently with the tenth cannot exceed the allowance.
  await assert.rejects(meter.commit('one', 20, false), { code: 'AI_CREDITS_EXHAUSTED' });
  assert.equal((await meter.credits('one')).used, 10);
  assert.equal((await meter.credits('two')).used, 0);
  const denied = await f.db.transaction(c => c.query("SELECT * FROM h8_usage_events WHERE outcome = 'denied'"));
  assert.equal(denied.length, 2);
  now = Date.UTC(2026, 11, 1); assert.equal((await meter.credits('one')).remaining, 10); await meter.check('one', true);
});
test('#190 managed absence and daily spend remain fail closed', async t => {
  const f = await h8Fixture(t); await initializeUsage(f.db);
  const absent = new HostedUsage(f.db, { defaults: base, tenants: {} });
  assert.equal((await absent.aiCredits(scope)).limit, null);
  await assert.rejects(absent.aiMeter().check('one', true), { code: 'AI_MANAGED_UNAVAILABLE' });
  const daily = new HostedUsage(f.db, { defaults: { ...base, aiCallsPerMonth: 50, aiSpendCapCents: 1, aiCostCentsPerMillionTokens: 1000000 }, tenants: {} });
  await daily.aiMeter().commit('one', 2, false);
  await assert.rejects(daily.aiMeter().check('one', true), { code: 'AI_SPEND_CAP_EXCEEDED' });
});
test('#190 credit entitlement validation also reaches billing tier configuration', () => {
  for (const value of [-1, 1.5, '10', null, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => entitlementConfig(JSON.stringify({ defaults: { ...base, aiCallsPerMonth: value }, tenants: {} })), { code: 'ENTITLEMENT_UNRESOLVED' });
  const env = { OPENSIGHT_STRIPE_SECRET_KEY: 'test-key', OPENSIGHT_STRIPE_WEBHOOK_SECRET: 'test-webhook', OPENSIGHT_STRIPE_PRICE_LIGHT: 'light', OPENSIGHT_STRIPE_PRICE_REGULAR: 'regular', OPENSIGHT_STRIPE_PRICE_HEAVY: 'heavy' };
  const tiers = Object.fromEntries(Object.entries({ free: 10, light: 50, regular: 500, heavy: 3000 }).map(([tier, aiCallsPerMonth]) => [tier, { ...base, aiCallsPerMonth }]));
  assert.deepEqual({ ...billingConfig({ ...env, OPENSIGHT_BILLING_TIER_ENTITLEMENTS: JSON.stringify(tiers) }).tierEntitlements }, tiers);
  assert.throws(() => billingConfig({ ...env, OPENSIGHT_BILLING_TIER_ENTITLEMENTS: JSON.stringify({ free: { ...base, aiCallsPerMonth: -1 } }) }), { code: 'BILLING_CONFIG_INVALID' });
});
