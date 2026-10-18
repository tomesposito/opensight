import test from 'node:test';
import assert from 'node:assert/strict';
import { h8Fixture } from './h8-helpers.mjs';
import { HostedUsage, initializeUsage, entitlementConfig } from '../dist/hosted-usage.js';
import { AISettings } from '../dist/ai-settings.js';
import { providerAdapters, estimateTokens } from '../dist/ai-providers.js';
import { readOperatorAudit } from '../dist/operator-audit.js';

const base = { apiCalls: 1000, storageBytes: 100000, computeAttempts: 100 };
const one = { tenantId: 'tenant-one', namespaceId: 'one' };
const two = { tenantId: 'tenant-two', namespaceId: 'two' };
// 1 cent per token makes cap arithmetic exact in these tests.
const priced = (extra = {}) => ({ ...base, aiCostCentsPerMillionTokens: 1_000_000, ...extra });

async function setup(t, entitlement) {
  const f = await h8Fixture(t); await initializeUsage(f.db);
  let now = Date.UTC(2026, 9, 3);
  const usage = new HostedUsage(f.db, { defaults: entitlement, tenants: {} }, () => now);
  return { ...f, usage, advance: () => { now += 86_400_000; } };
}
const openAiReply = tokens => Response.json({
  output: [{ type: 'message', content: [{ type: 'output_text', text: 'OK' }] }],
  ...(tokens === undefined ? {} : { usage: { input_tokens: tokens, output_tokens: 0 } }),
});
// AISettings' environment bootstrap is default-only. Unit tests bind that
// bootstrap to a real H1 namespace; HTTP tests below use real namespace configs.
const meterFor = (usage, namespaceId = 'one') => {
  const meter = usage.aiMeter();
  return { check: () => meter.check(namespaceId), record: (_ns, tokens, estimated) => meter.record(namespaceId, tokens, estimated) };
};

test('AI spend config validation rejects negatives, non-integers and out-of-range warn percentages', () => {
  for (const bad of [
    { aiSpendCapCents: -1 }, { aiSpendCapCents: 1.5 }, { aiSpendCapCents: '100' },
    { aiWarnPct: -1 }, { aiWarnPct: 101 }, { aiWarnPct: 80.5 },
    { aiCostCentsPerMillionTokens: -1 }, { aiCostCentsPerMillionTokens: 0.5 },
    { aiSpendCapCents: Number.MAX_SAFE_INTEGER + 1 },
  ]) assert.throws(() => entitlementConfig(JSON.stringify({ defaults: { ...base, ...bad }, tenants: {} })), { code: 'ENTITLEMENT_UNRESOLVED' }, JSON.stringify(bad));
  const parsed = entitlementConfig(JSON.stringify({ defaults: priced({ aiSpendCapCents: 100, aiWarnPct: 50 }), tenants: {} }));
  assert.equal(parsed.defaults.aiSpendCapCents, 100); assert.equal(parsed.defaults.aiWarnPct, 50);
  assert.equal(parsed.defaults.aiCostCentsPerMillionTokens, 1_000_000);
  // Absent AI fields stay absent: no cap by default, existing configs keep parsing.
  assert.equal(entitlementConfig(JSON.stringify({ defaults: base, tenants: {} })).defaults.aiSpendCapCents, undefined);
});

test('cap breach denies before the provider transport is invoked, with an actionable 429', async t => {
  const f = await setup(t, priced({ aiSpendCapCents: 100 }));
  await f.usage.recordAiUsage(one, 150);
  let calls = 0;
  const metered = await AISettings.load({
    bootstrap: { provider: 'openai', model: 'test-model', key: 'test-key' },
    fetcher: async () => { calls++; return openAiReply(1); },
    aiMeter: meterFor(f.usage),
  });
  await assert.rejects(metered.complete('default', { system: 's', prompt: 'p' }),
    e => e.code === 'AI_SPEND_CAP_EXCEEDED' && e.status === 429
      && /tenant-one/.test(e.message) && /150/.test(e.message) && /100/.test(e.message) && /operator/.test(e.message));
  assert.equal(calls, 0);
  const events = await f.db.transaction(c => c.query("SELECT * FROM h8_usage_events WHERE outcome = 'denied'"));
  assert.equal(events.length, 1); assert.equal(events[0].metric, 'aiCalls'); assert.equal(events[0].tenant_id, 'tenant-one');
  const usage = await f.usage.aiUsage(one);
  assert.equal(usage.aiTokens, 150); // denied call added no tokens
});

test('successful calls meter aiCalls and aiTokens durably; provider usage wins over the estimator', async t => {
  const f = await setup(t, priced({ aiSpendCapCents: 100_000 }));
  let calls = 0;
  const ai = await AISettings.load({
    bootstrap: { provider: 'openai', model: 'test-model', key: 'test-key' },
    fetcher: async () => { calls++; return openAiReply(10); },
    aiMeter: meterFor(f.usage),
  });
  assert.equal(await ai.complete('default', { system: 'system prompt', prompt: 'a much longer prompt that would estimate to more than ten tokens' }), 'OK');
  assert.equal(calls, 1);
  const snap = await f.usage.aiUsage(one);
  assert.equal(snap.aiCalls, 1); assert.equal(snap.aiTokens, 10); assert.equal(snap.spendCents, 10);
  // Durability: a fresh HostedUsage over the same database sees the counters.
  const restarted = new HostedUsage(f.db, f.usage.config, f.usage.clock);
  const after = await restarted.aiUsage(one);
  assert.equal(after.aiCalls, 1); assert.equal(after.aiTokens, 10);
  const events = await f.db.transaction(c => c.query('SELECT metric, amount, unit, outcome FROM h8_usage_events ORDER BY metric'));
  assert.deepEqual(events.map(e => [e.metric, Number(e.amount), e.unit, e.outcome]), [['aiCalls', 1, 'call', 'admitted'], ['aiTokens', 10, 'token', 'admitted']]);
  const metrics = await f.usage.metrics();
  assert.match(metrics, /opensight_ai_tokens\{tenant="tenant-one",namespace="one",period="2026-10-03"\} 10/);
  assert.match(metrics, /opensight_ai_spend_cents\{tenant="tenant-one",namespace="one",period="2026-10-03"\} 10/);
});

test('missing provider usage falls back to the documented ceil(chars/4) estimate', async t => {
  const f = await setup(t, priced());
  const ai = await AISettings.load({
    bootstrap: { provider: 'openai', model: 'test-model', key: 'test-key' },
    fetcher: async () => openAiReply(undefined),
    aiMeter: meterFor(f.usage),
  });
  await ai.complete('default', { system: 'abcd', prompt: 'efgh' });
  const expected = estimateTokens('abcd', 'efgh', 'OK');
  assert.equal(expected, Math.ceil((4 + 4 + 2) / 4));
  assert.equal((await f.usage.aiUsage(one)).aiTokens, expected);
});

test('provider adapters surface per-provider usage shapes', async () => {
  const input = { system: 's', prompt: 'p' };
  const config = provider => ({ provider, model: 'm', ...(provider === 'openai-compatible' ? { baseUrl: 'https://example.test/v1' } : {}) });
  const openai = await providerAdapters(async () => Response.json({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'hi' }] }], usage: { input_tokens: 3, output_tokens: 4 } })).openai.complete(config('openai'), 'k', input);
  assert.deepEqual(openai, { text: 'hi', tokens: 7 });
  const anthropic = await providerAdapters(async () => Response.json({ content: [{ type: 'text', text: 'hi' }], usage: { input_tokens: 5, output_tokens: 6 } })).anthropic.complete(config('anthropic'), 'k', input);
  assert.deepEqual(anthropic, { text: 'hi', tokens: 11 });
  const compatible = await providerAdapters(async () => Response.json({ choices: [{ message: { content: 'hi' } }], usage: { prompt_tokens: 7, completion_tokens: 8 } }))['openai-compatible'].complete(config('openai-compatible'), 'k', input);
  assert.deepEqual(compatible, { text: 'hi', tokens: 15 });
  const noUsage = await providerAdapters(async () => Response.json({ content: [{ type: 'text', text: 'hi' }] })).anthropic.complete(config('anthropic'), 'k', input);
  assert.deepEqual(noUsage, { text: 'hi' });
});

test('warning audit fires exactly once per period when spend crosses aiWarnPct', async t => {
  const f = await setup(t, priced({ aiSpendCapCents: 100, aiWarnPct: 80 }));
  assert.equal((await f.usage.recordAiUsage(one, 50)).warned, false);
  assert.equal((await f.usage.recordAiUsage(one, 40)).warned, true); // 90 >= 80 threshold
  assert.equal((await f.usage.recordAiUsage(one, 5)).warned, false);
  let entries = (await readOperatorAudit(f.db, { limit: 50 })).filter(e => e.action === 'ai.spend.warning');
  assert.equal(entries.length, 1);
  assert.equal(entries[0].tenantId, 'tenant-one');
  assert.equal(entries[0].detail.spendCents, 90); assert.equal(entries[0].detail.capCents, 100); assert.equal(entries[0].detail.warnPct, 80);
  f.advance(); // next UTC period: the warning may fire again
  assert.equal((await f.usage.recordAiUsage(one, 85)).warned, true);
  entries = (await readOperatorAudit(f.db, { limit: 50 })).filter(e => e.action === 'ai.spend.warning');
  assert.equal(entries.length, 2);
});

test('per-tenant isolation: tenant A at cap never gates tenant B; default warnPct is 80', async t => {
  const f = await setup(t, priced({ aiSpendCapCents: 100 }));
  await f.usage.recordAiUsage(one, 100);
  await assert.rejects(f.usage.checkAiSpend(one), { code: 'AI_SPEND_CAP_EXCEEDED', status: 429 });
  await f.usage.checkAiSpend(two); // must not throw
  await f.usage.recordAiUsage(two, 10);
  assert.equal((await f.usage.aiUsage(two)).aiTokens, 10);
  assert.equal((await f.usage.aiUsage(one)).aiCalls, 1);
  assert.equal((await f.usage.aiUsage(one)).warnPct, 80);
});

test('unset cap records metering without denial, and no meter preserves self-hosted behaviour', async t => {
  const f = await setup(t, priced()); // price set, no cap
  for (let i = 0; i < 5; i++) await f.usage.recordAiUsage(one, 10_000);
  await f.usage.checkAiSpend(one); // must not throw despite large spend
  assert.equal((await f.usage.aiUsage(one)).aiCalls, 5);
  // Zero price means spend tracking disabled: even a zero cap never bites.
  const g = await setup(t, { ...base, aiSpendCapCents: 0 });
  await g.usage.recordAiUsage(one, 10);
  await g.usage.checkAiSpend(one);
  assert.equal((await g.usage.aiUsage(one)).spendCents, 0);
  // No aiMeter at all: AISettings completes exactly as before.
  const plain = await AISettings.load({ bootstrap: { provider: 'openai', model: 'm', key: 'k' }, fetcher: async () => openAiReply(3) });
  assert.equal(await plain.complete('default', { system: 's', prompt: 'p' }), 'OK');
});

test('hosted namespace resolution fails closed for unknown namespaces', async t => {
  const f = await setup(t, priced({ aiSpendCapCents: 100 }));
  const meter = f.usage.aiMeter(); // resolves tenant via h1_namespaces
  await meter.record('one', 100, false);
  await assert.rejects(meter.check('one'), { code: 'AI_SPEND_CAP_EXCEEDED' });
  await assert.rejects(meter.check('no-such-namespace'), { code: 'ENTITLEMENT_UNRESOLVED' });
});

test('invalid or incomplete provider usage uses the estimator, but reported zero is valid', async () => {
  for (const usage of [null, {}, { input_tokens: 1 }, { input_tokens: -1, output_tokens: 3 },
    { input_tokens: '2', output_tokens: 3 }, { input_tokens: 0.5, output_tokens: 3 },
    { input_tokens: Number.MAX_SAFE_INTEGER, output_tokens: 1 }]) {
    const adapter = providerAdapters(async () => Response.json({ content: [{ type: 'text', text: 'hi' }], usage })).anthropic;
    assert.deepEqual(await adapter.complete({ provider: 'anthropic', model: 'm' }, 'k', { system: 's', prompt: 'p' }), { text: 'hi' });
  }
  assert.equal((await providerAdapters(async () => openAiReply(0)).openai.complete({ provider: 'openai', model: 'm' }, 'k', { system: 's', prompt: 'p' })).tokens, 0);
});

test('estimated events are marked durably and key echoes stay redacted', async t => {
  const f = await setup(t, priced()), key = 'synthetic-provider-key';
  const ai = await AISettings.load({ bootstrap: { provider: 'openai', model: 'm', key }, aiMeter: meterFor(f.usage),
    fetcher: async () => Response.json({ output: [{ type: 'message', content: [{ type: 'output_text', text: `${key} ${key}` }] }] }) });
  assert.equal(await ai.complete('default', { system: 'abcd', prompt: 'efgh' }), '[redacted] [redacted]');
  const events = await f.db.transaction(c => c.query('SELECT * FROM h8_usage_events'));
  assert.equal(events.find(e => e.metric === 'aiTokens').unit, 'estimated-token');
  assert.equal(events.find(e => e.metric === 'aiTokens').amount, estimateTokens('abcd', 'efgh', `${key} ${key}`));
  assert.ok(!JSON.stringify(events).includes(key));
});

test('zero-percent warning, concurrent instances and database reopen preserve once-per-day alerts', async t => {
  const f = await setup(t, priced({ aiSpendCapCents: 100, aiWarnPct: 0 }));
  const other = new HostedUsage(f.db, f.usage.config, f.usage.clock);
  const records = await Promise.all(Array.from({ length: 20 }, (_, i) => (i % 2 ? f.usage : other).recordAiUsage(one, 1)));
  assert.equal(records.filter(r => r.warned).length, 1);
  assert.equal((await other.aiUsage(one)).aiCalls, 20);
  assert.equal((await other.aiUsage(one)).aiTokens, 20);
  const { SqliteMetadataDatabase } = await import('../dist/metadata-db.js');
  const reopened = new SqliteMetadataDatabase(f.path);
  try {
    const restarted = new HostedUsage(reopened, f.usage.config, f.usage.clock);
    assert.equal((await restarted.aiUsage(one)).aiTokens, 20);
    assert.equal((await restarted.recordAiUsage(one, 1)).warned, false);
    assert.equal((await readOperatorAudit(reopened)).filter(e => e.action === 'ai.spend.warning').length, 1);
    f.advance();
    assert.equal((await restarted.aiUsage(one)).aiTokens, 0);
    assert.equal((await restarted.recordAiUsage(one, 1)).warned, true);
  } finally { await reopened.close(); }
});

test('tenant overrides and zero cap enforce independently at exact fractional-cent boundaries', async t => {
  const f = await setup(t, base);
  const usage = new HostedUsage(f.db, { defaults: base, tenants: {
    'tenant-one': { ...base, aiSpendCapCents: 1, aiCostCentsPerMillionTokens: 10 },
    'tenant-two': priced({ aiSpendCapCents: 0 }),
  } }, f.usage.clock);
  await usage.recordAiUsage(one, 99_999);
  await usage.checkAiSpend(one);
  await usage.recordAiUsage(one, 1);
  await assert.rejects(usage.checkAiSpend(one), { code: 'AI_SPEND_CAP_EXCEEDED', status: 429 });
  await assert.rejects(usage.checkAiSpend(two), { code: 'AI_SPEND_CAP_EXCEEDED', status: 429 });
  f.advance(); await usage.checkAiSpend(one);
  assert.equal((await usage.aiUsage(one)).aiTokens, 0);
});

test('missing entitlement, corrupt counts and unavailable stores deny before transport even without a cap', async t => {
  const f = await setup(t, base);
  let calls = 0;
  const ai = usage => AISettings.load({ bootstrap: { provider: 'openai', model: 'm', key: 'key' }, aiMeter: meterFor(usage),
    fetcher: async () => { calls++; return openAiReply(1); } });
  const complete = async usage => (await ai(usage)).complete('default', { system: 's', prompt: 'p' });
  await assert.rejects(complete(new HostedUsage(f.db, { defaults: null, tenants: {} })), { code: 'ENTITLEMENT_UNRESOLVED', status: 503 });
  await f.usage.recordAiUsage(one, 1);
  for (const metric of ['aiCalls', 'aiTokens']) {
    await f.db.transaction(c => c.query('UPDATE h8_usage SET admitted = -1 WHERE metric = ?', [metric]));
    await assert.rejects(complete(f.usage), { code: 'ENTITLEMENT_UNRESOLVED', status: 503 });
    await f.db.transaction(c => c.query('UPDATE h8_usage SET admitted = 1 WHERE metric = ?', [metric]));
  }
  await f.db.transaction(c => c.query('DROP TABLE h8_usage'));
  await assert.rejects(complete(f.usage), { code: 'ENTITLEMENT_UNRESOLVED', status: 503 });
  assert.equal(calls, 0);
});

test('unknown or mismatched tenant namespaces and suspended tenants cannot spend', async t => {
  const f = await setup(t, base);
  await assert.rejects(f.usage.aiMeter().check('missing'), { code: 'ENTITLEMENT_UNRESOLVED' });
  await assert.rejects(f.usage.checkAiSpend({ ...one, namespaceId: two.namespaceId }), { code: 'ENTITLEMENT_UNRESOLVED' });
  await f.db.transaction(c => c.query("UPDATE h1_tenants SET state = 'suspended' WHERE tenant_id = ?", [one.tenantId]));
  await assert.rejects(f.usage.aiMeter().check('one'), { code: 'TENANT_UNAVAILABLE' });
  await assert.rejects(f.usage.aiMeter().record('one', 1, false), { code: 'TENANT_UNAVAILABLE' });
});

test('audit failure rolls back both usage metrics and post-call accounting errors withhold the answer', async t => {
  const f = await setup(t, priced({ aiSpendCapCents: 100, aiWarnPct: 80 }));
  await f.usage.recordAiUsage(one, 70);
  await f.db.transaction(c => c.query('DROP TABLE h8_audit'));
  const ai = await AISettings.load({ bootstrap: { provider: 'openai', model: 'm', key: 'key' }, aiMeter: meterFor(f.usage), fetcher: async () => openAiReply(10) });
  await assert.rejects(ai.complete('default', { system: 's', prompt: 'p' }), { code: 'ENTITLEMENT_UNRESOLVED', status: 503 });
  const snapshot = await f.usage.aiUsage(one);
  assert.equal(snapshot.aiCalls, 1); assert.equal(snapshot.aiTokens, 70);
  assert.equal((await f.db.transaction(c => c.query('SELECT * FROM h8_usage_events'))).length, 2);
});
