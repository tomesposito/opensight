import test from 'node:test';
import assert from 'node:assert/strict';
import { h8Fixture, serveH8 } from './h8-helpers.mjs';
import { upload } from './source-helpers.mjs';
import { budgetConfig } from './budget-helpers.mjs';
import { entitlementConfig, initializeUsage, HostedUsage } from '../dist/hosted-usage.js';
import { billingConfig } from '../dist/hosted-billing.js';
import { TenantMetadata } from '../dist/metadata.js';
import { HostedSources } from '../dist/hosted-sources.js';
import { HostedData } from '../dist/hosted-data.js';
import { TenantBudgets } from '../dist/budgets.js';
import { appendOperatorAudit, readOperatorAudit } from '../dist/operator-audit.js';
import { drainHostedServer } from '../dist/hosted-server.js';

// Issue #215: the #165 open-economics guard only scanned prose. These tests
// exercise the executable side of the rule — the entitlement records and the
// governance capabilities themselves — under every billing tier. Tiers may
// differ only in quantity: each tier below carries a sufficient allowance,
// and the governance behavior must be identical on all of them.

// Distinct, sufficient quantitative allowances per tier (never zero: a zero
// allowance is a quantity denial, which is allowed; what must never happen
// is a feature denial).
const TIERS = {
  free: { apiCalls: 1000, storageBytes: 1000000, computeAttempts: 1000 },
  light: { apiCalls: 5000, storageBytes: 5000000, computeAttempts: 5000 },
  regular: { apiCalls: 20000, storageBytes: 20000000, computeAttempts: 20000 },
  heavy: { apiCalls: 100000, storageBytes: 100000000, computeAttempts: 100000 },
};
const QUANTITATIVE_KEYS = ['aiCallsPerMonth', 'aiCostCentsPerMillionTokens', 'aiSpendCapCents', 'aiWarnPct', 'apiCalls', 'computeAttempts', 'egressBytes', 'storageBytes'];
// Fields that would turn an entitlement into a governance paywall if the
// parsers ever accepted them.
const GOVERNANCE_FLAGS = ['sso', 'singleSignOn', 'rowLevelSecurity', 'rls', 'auditLog', 'audit', 'embedding', 'embed', 'features', 'featureFlags'];

const billingEnv = (tierEntitlements) => ({
  OPENSIGHT_STRIPE_SECRET_KEY: 'sk_test_placeholder', OPENSIGHT_STRIPE_WEBHOOK_SECRET: 'whsec_test_placeholder',
  OPENSIGHT_STRIPE_PRICE_LIGHT: 'price_light', OPENSIGHT_STRIPE_PRICE_REGULAR: 'price_regular', OPENSIGHT_STRIPE_PRICE_HEAVY: 'price_heavy',
  OPENSIGHT_BILLING_TIER_ENTITLEMENTS: JSON.stringify(tierEntitlements),
});

test('215 entitlements carry quantities only: every tier parses, and no parser accepts a governance feature flag', () => {
  const config = billingConfig(billingEnv(TIERS));
  for (const [tier, expected] of Object.entries(TIERS)) {
    assert.deepEqual(config.tierEntitlements[tier], expected, `${tier} tier entitlement must round-trip unchanged`);
    assert.ok(Object.keys(config.tierEntitlements[tier]).every(key => QUANTITATIVE_KEYS.includes(key)),
      `${tier} tier entitlement must contain quantitative fields only`);
  }
  // The trial entitlement goes through the same parser and the same rule.
  const trial = billingConfig({ ...billingEnv(TIERS), OPENSIGHT_TRIAL_ENTITLEMENT: JSON.stringify(TIERS.light) });
  assert.deepEqual(trial.trialEntitlement, TIERS.light);
  for (const flag of GOVERNANCE_FLAGS) {
    assert.throws(() => entitlementConfig(JSON.stringify({ defaults: { ...TIERS.free, [flag]: true }, tenants: {} })),
      { code: 'ENTITLEMENT_UNRESOLVED' }, `operator entitlement must reject the ${flag} feature flag`);
    assert.throws(() => billingConfig(billingEnv({ free: { ...TIERS.free, [flag]: true } })),
      { code: 'BILLING_CONFIG_INVALID' }, `tier entitlement must reject the ${flag} feature flag`);
    assert.throws(() => billingConfig({ ...billingEnv(TIERS), OPENSIGHT_TRIAL_ENTITLEMENT: JSON.stringify({ ...TIERS.light, [flag]: true }) }),
      { code: 'BILLING_CONFIG_INVALID' }, `trial entitlement must reject the ${flag} feature flag`);
  }
});

const protectedPolicy = { rowLevel: true, rowRules: [{ id: 'east', principals: [{ type: 'user', id: 'admin' }], predicate: { column: 'region', operator: 'eq', value: 'east' } }], protectedColumns: ['private'], columnGrants: [] };
const sumQuery = { dimensions: [], measures: [{ fieldId: 'total', columnName: 'amount', aggregation: 'SUM' }], filters: [] };

for (const [tier, allowance] of Object.entries(TIERS)) {
  test(`215 governance under the ${tier} tier: RLS/CLS queries filter and deny identically, and the audit log records and reads back`, async t => {
    const f = await h8Fixture(t); await initializeUsage(f.db);
    let now = Date.UTC(2026, 10, 7);
    const usage = new HostedUsage(f.db, { defaults: null, tenants: {} }, () => now);
    // The billing tier is the only entitlement source, exactly as the hosted
    // server wires HostedBilling.tierEntitlement into HostedUsage.
    usage.tierEntitlement = () => allowance;
    const metadata = new TenantMetadata(f.db, f.db, usage);
    const context = await metadata.authenticate(null, async () => ({ namespaceId: 'one', userId: 'admin' }));
    assert.deepEqual(usage.entitlement(context), allowance);

    // Quantitative admission works with the tier's allowance.
    await usage.consume(metadata, context, 'apiCalls');
    await usage.consume(metadata, context, 'computeAttempts');

    // Row- and column-level security: the protected upload is stored under
    // the tier's storage allowance, preview shows only the rows the policy
    // grants this user, the aggregate matches, and the protected column is
    // denied — the same behavior on every tier.
    const sources = new HostedSources(metadata, f.env.OPENSIGHT_AUTH_ENCRYPTION_KEY, []);
    const budgets = new TenantBudgets(budgetConfig, c => metadata.assertContext(c)); t.after(() => budgets.close());
    const data = new HostedData(sources, undefined, budgets);
    const uploaded = await sources.upload(context, upload(protectedPolicy));
    const preview = await data.execute(context, uploaded.id, 'preview', { mode: 'DIRECT_QUERY' });
    assert.deepEqual(preview.rows, [{ region: 'east', amount: 10 }, { region: 'east', amount: 30 }]);
    assert.deepEqual((await data.execute(context, uploaded.id, 'query', { mode: 'DIRECT_QUERY', query: sumQuery })).rows, [{ total: 40 }]);
    await assert.rejects(data.execute(context, uploaded.id, 'preview', { mode: 'DIRECT_QUERY', columns: ['private'] }), { code: 'COLUMN_ACCESS_DENIED' });

    // The audit log: an entry scoped to this tenant is recorded and read
    // back through the same store the operator audit route serves.
    await f.db.transaction(c => appendOperatorAudit(c, { action: 'governance.check', tenantId: context.tenantId, detail: { tier } }, now));
    const entries = (await readOperatorAudit(f.db, { limit: 200 })).filter(e => e.tenantId === context.tenantId && e.action === 'governance.check');
    assert.equal(entries.length, 1);
    assert.deepEqual(entries[0].detail, { tier });
  });

  test(`215 governance under the ${tier} tier: identity seam session and basic embedding serve over HTTP`, async t => {
    const { sessionFixture } = await import('./embed-session-helpers.mjs');
    const { seedEmbedContent } = await import('./embed-content-helpers.mjs');
    const { serverEnvironment } = await import('./embed-http-helpers.mjs');
    const f = await sessionFixture(t); await seedEmbedContent(f); await initializeUsage(f.db);
    const issued = await f.issue(), redeemed = await f.redeem(issued);
    const env = serverEnvironment(f, { OPENSIGHT_ENTITLEMENTS: JSON.stringify({ defaults: allowance, tenants: {} }) });
    const { server, request } = await serveH8(t, { ...f, env }, { security: { authenticate: f.auth.authenticate } });
    // The identity verifier seam (the seam external SSO plugs into, per
    // HQ-3) issues a session under this tier's quantitative allowance.
    const api = `Bearer ${(await f.login()).token}`;
    assert.equal((await request('/api/session', { headers: { authorization: api } })).status, 200);
    // Basic embedding: the issued session's status and governed content
    // serve under the same allowance, with no feature denial.
    const embed = { authorization: `Embed ${redeemed.credential}` };
    assert.equal((await request(`/api/embed/sessions/${issued.sessionId}/status`, { headers: embed })).status, 200);
    const content = await request(`/api/embed/sessions/${issued.sessionId}/content`, { headers: embed });
    assert.equal(content.status, 200, JSON.stringify(content.body));
    assert.ok(Array.isArray(content.body.visuals) && content.body.visuals.length > 0);
    await drainHostedServer(server);
  });
}
