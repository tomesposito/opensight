import test from 'node:test';
import assert from 'node:assert/strict';
import { h8Fixture, serveH8 } from './h8-helpers.mjs';
import { HostedUsage, initializeUsage, entitlementConfig } from '../dist/hosted-usage.js';
import { drainHostedServer } from '../dist/hosted-server.js';

const base = { apiCalls: 1000, storageBytes: 100000, computeAttempts: 100 };
const one = { tenantId: 'tenant-one', namespaceId: 'one' };
const two = { tenantId: 'tenant-two', namespaceId: 'two' };
const exceeded = { code: 'USAGE_LIMIT_EXCEEDED', status: 429 };
const unresolved = { code: 'ENTITLEMENT_UNRESOLVED', status: 503 };

async function setup(t, entitlement) {
  const f = await h8Fixture(t); await initializeUsage(f.db);
  let now = Date.UTC(2026, 9, 3);
  const usage = new HostedUsage(f.db, { defaults: entitlement, tenants: {} }, () => now);
  return { ...f, usage, at: time => { now = Date.parse(time); } };
}

test('entitlementConfig parses egressBytes for defaults and tenant overrides, rejects invalid values, and round-trips', () => {
  const parsed = entitlementConfig(JSON.stringify({
    defaults: { ...base, egressBytes: 5000 },
    tenants: { 'tenant-one': { ...base, egressBytes: 0 } },
  }));
  assert.equal(parsed.defaults.egressBytes, 5000);
  assert.equal(parsed.tenants['tenant-one'].egressBytes, 0);
  // Round-trip through the JSON serialization used by coordination/runtime code.
  assert.deepEqual(entitlementConfig(JSON.stringify(parsed)), parsed);
  // Absent stays absent: existing operator configs remain valid and uncapped.
  assert.equal(entitlementConfig(JSON.stringify({ defaults: base, tenants: {} })).defaults.egressBytes, undefined);
  for (const bad of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, '100', null, NaN]) {
    assert.throws(() => entitlementConfig(JSON.stringify({ defaults: { ...base, egressBytes: bad }, tenants: {} })),
      { code: 'ENTITLEMENT_UNRESOLVED' }, String(bad));
    assert.throws(() => entitlementConfig(JSON.stringify({ defaults: base, tenants: { 'tenant-one': { ...base, egressBytes: bad } } })),
      { code: 'ENTITLEMENT_UNRESOLVED' }, String(bad));
  }
});

test('egress gate admits under the cap and denies exactly at the cap', async t => {
  const f = await setup(t, { ...base, egressBytes: 100 });
  await f.usage.checkEgress(one);
  await f.usage.recordEgressBytes(one, 99);
  await f.usage.checkEgress(one);
  await f.usage.recordEgressBytes(one, 1);
  await assert.rejects(f.usage.checkEgress(one), exceeded);
});

test('a recording that crosses the cap is admitted and the next gate check denies', async t => {
  const f = await setup(t, { ...base, egressBytes: 100 });
  await f.usage.recordEgressBytes(one, 90);
  await f.usage.checkEgress(one);
  await f.usage.recordEgressBytes(one, 25);
  await assert.rejects(f.usage.checkEgress(one), exceeded);
  // Denied checks record no admitted bytes: the monthly rollup is undistorted.
  await assert.rejects(f.usage.checkEgress(one), exceeded);
  assert.equal((await f.usage.rollupMonthlyUsage(one, '2026-10')).egressBytes, 115);
});

test('egress gate resets at the UTC month boundary', async t => {
  const f = await setup(t, { ...base, egressBytes: 10 });
  f.at('2026-10-31T23:59:59.999Z');
  await f.usage.recordEgressBytes(one, 10);
  await assert.rejects(f.usage.checkEgress(one), exceeded);
  f.at('2026-11-01T00:00:00.000Z');
  await f.usage.checkEgress(one);
  await f.usage.recordEgressBytes(one, 10);
  await assert.rejects(f.usage.checkEgress(one), exceeded);
  assert.equal((await f.usage.rollupMonthlyUsage(one, '2026-10')).egressBytes, 10);
  assert.equal((await f.usage.rollupMonthlyUsage(one, '2026-11')).egressBytes, 10);
});

test('egress gate isolates tenants and namespaces', async t => {
  const f = await setup(t, { ...base, egressBytes: 10 });
  await f.usage.recordEgressBytes(one, 10);
  await assert.rejects(f.usage.checkEgress(one), exceeded);
  await f.usage.checkEgress(two);
  await f.usage.recordEgressBytes(two, 9);
  await f.usage.checkEgress(two);
  await assert.rejects(f.usage.checkEgress({ ...one, namespaceId: two.namespaceId }), unresolved);
});

test('zero egress cap denies immediately and an absent cap never denies', async t => {
  const capped = await setup(t, { ...base, egressBytes: 0 });
  await assert.rejects(capped.usage.checkEgress(one), exceeded);
  const uncapped = await setup(t, base);
  await uncapped.usage.recordEgressBytes(one, Number.MAX_SAFE_INTEGER - 1);
  await uncapped.usage.checkEgress(one);
  assert.equal((await uncapped.usage.rollupMonthlyUsage(one, '2026-10')).egressBytes, Number.MAX_SAFE_INTEGER - 1);
});

test('tenant overrides enforce egress independently of the default cap', async t => {
  const f = await h8Fixture(t); await initializeUsage(f.db);
  const usage = new HostedUsage(f.db, {
    defaults: { ...base, egressBytes: 0 },
    tenants: { 'tenant-two': { ...base, egressBytes: 100 } },
  }, () => Date.UTC(2026, 9, 3));
  await assert.rejects(usage.checkEgress(one), exceeded);
  await usage.checkEgress(two);
});

test('corrupt or unsafe monthly egress counters fail the gate closed', async t => {
  const f = await setup(t, { ...base, egressBytes: 100 });
  await f.db.transaction(c => c.query('INSERT INTO h8_usage VALUES (?,?,?,?,?,?)',
    [one.tenantId, one.namespaceId, '2026-10-01', 'egressBytes', -1, 0]));
  await assert.rejects(f.usage.checkEgress(one), unresolved);
  await f.db.transaction(c => c.query('DELETE FROM h8_usage'));
  await f.db.transaction(async c => {
    await c.query('INSERT INTO h8_usage VALUES (?,?,?,?,?,?)', [one.tenantId, one.namespaceId, '2026-10-01', 'egressBytes', Number.MAX_SAFE_INTEGER, 0]);
    await c.query('INSERT INTO h8_usage VALUES (?,?,?,?,?,?)', [one.tenantId, one.namespaceId, '2026-10-02', 'egressBytes', 1, 0]);
  });
  await assert.rejects(f.usage.checkEgress(one), unresolved);
  await f.db.transaction(c => c.query("UPDATE h1_tenants SET state = 'suspended' WHERE tenant_id = ?", [one.tenantId]));
  await assert.rejects(f.usage.checkEgress(one), { code: 'TENANT_UNAVAILABLE' });
});

test('hosted HTTP hard-stops authenticated tenant responses at the egress cap and rolls up real response bytes', async t => {
  const f = await h8Fixture(t); await initializeUsage(f.db);
  const entitlements = {
    defaults: { ...base, egressBytes: 1 },
    tenants: { 'tenant-two': { ...base } },
  };
  f.env = { ...f.env, OPENSIGHT_REFERENCE: 'single-node', OPENSIGHT_REFERENCE_LOCATION: 'local',
    OPENSIGHT_ENTITLEMENTS: JSON.stringify(entitlements) };
  const { server, request, operator } = await serveH8(t, f);
  const admittedBytes = { 'tenant-one': 0, 'tenant-two': 0 };
  const call = async authorization => {
    const result = await request('/api/session', { headers: { authorization } });
    return result;
  };
  let denied;
  for (let i = 0; i < 10 && !denied; i++) {
    const result = await call('one');
    if (result.status === 429) denied = result;
    else {
      assert.equal(result.status, 200);
      admittedBytes['tenant-one'] += Buffer.byteLength(JSON.stringify(result.body));
    }
  }
  assert.ok(denied, 'expected an egress denial within ten requests');
  assert.equal(denied.body.errorCode, 'USAGE_LIMIT_EXCEEDED');
  // Further requests stay denied and add no admitted egress.
  assert.equal((await call('one')).status, 429);
  // A tenant whose entitlement has no egress cap is unaffected.
  for (let i = 0; i < 3; i++) {
    const result = await call('two');
    assert.equal(result.status, 200);
    admittedBytes['tenant-two'] += Buffer.byteLength(JSON.stringify(result.body));
  }
  // Recording settles after each response is sent; wait for the durable
  // daily totals to reach the exact real bytes the client received.
  const month = new Date().toISOString().slice(0, 7);
  const dailyTotal = async tenantId => {
    const rows = await f.db.transaction(c => c.query(
      "SELECT admitted FROM h8_usage WHERE tenant_id = ? AND metric = 'egressBytes'", [tenantId]));
    return rows.reduce((sum, row) => sum + Number(row.admitted), 0);
  };
  for (let i = 0; i < 100 && ((await dailyTotal('tenant-one')) !== admittedBytes['tenant-one']
    || (await dailyTotal('tenant-two')) !== admittedBytes['tenant-two']); i++)
    await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(await dailyTotal('tenant-one'), admittedBytes['tenant-one']);
  assert.equal(await dailyTotal('tenant-two'), admittedBytes['tenant-two']);
  assert.ok(admittedBytes['tenant-one'] > 0);
  const rolled = await request(`/api/host/usage/${month}`, { headers: operator, method: 'POST', body: {} });
  assert.equal(rolled.status, 200);
  const records = Object.fromEntries(rolled.body.records.map(record => [record.tenantId, record]));
  assert.equal(records['tenant-one'].egressBytes, admittedBytes['tenant-one']);
  assert.ok(records['tenant-two'].egressBytes > 0);
  await drainHostedServer(server);
});
