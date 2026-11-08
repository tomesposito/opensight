import test from 'node:test';
import assert from 'node:assert/strict';
import { h8Fixture, serveH8 } from './h8-helpers.mjs';
import { HostedUsage, initializeUsage, entitlementConfig } from '../dist/hosted-usage.js';
import { initializeJobs } from '../dist/job-schema.js';
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

const reservations = f => f.db.transaction(c => c.query('SELECT * FROM h8_egress_reservations ORDER BY id'));
const egressEvents = f => f.db.transaction(c => c.query("SELECT * FROM h8_usage_events WHERE metric = 'egressBytes' ORDER BY created_at"));

test('reservation claims the whole remainder, excludes usage reporting, and reconciles only actual bytes', async t => {
  const f = await setup(t, { ...base, egressBytes: 100 });
  await f.usage.recordEgressBytes(one, 20);
  const metrics = await f.usage.metrics(), events = await egressEvents(f);
  const handle = await f.usage.reserveEgress(one);
  const [row] = await reservations(f);
  assert.deepEqual({ ...row }, { id: handle.id, tenant_id: one.tenantId, namespace_id: one.namespaceId,
    period: '2026-10', reserved_bytes: 80, created_at: '2026-10-03T00:00:00.000Z' });
  await assert.rejects(f.usage.checkEgress(one), exceeded);
  await assert.rejects(f.usage.reserveEgress(one), exceeded);
  assert.equal((await f.usage.rollupMonthlyUsage(one, '2026-10')).egressBytes, 20);
  assert.equal(await f.usage.metrics(), metrics);
  assert.deepEqual(await egressEvents(f), events);
  await f.usage.settleEgress(handle, 5);
  await f.usage.checkEgress(one);
  assert.equal((await f.usage.rollupMonthlyUsage(one, '2026-10')).egressBytes, 25);
  const next = await f.usage.reserveEgress(one);
  assert.equal((await reservations(f))[0].reserved_bytes, 75);
  await f.usage.releaseEgress(next);
});

test('eight parallel reservations across usage instances admit exactly one capped request', async t => {
  const f = await setup(t, { ...base, egressBytes: 100 });
  const other = new HostedUsage(f.db, f.usage.config, f.usage.clock);
  const results = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => (i % 2 ? f.usage : other).reserveEgress(one)));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  const denied = results.filter(r => r.status === 'rejected');
  assert.equal(denied.length, 7);
  for (const { reason } of denied) assert.deepEqual({ code: reason.code, status: reason.status }, exceeded);
  assert.equal((await reservations(f)).length, 1);
  await f.usage.checkEgress(two);
  const otherTenant = await f.usage.reserveEgress(two);
  await f.usage.releaseEgress(otherTenant);
  await assert.rejects(f.usage.reserveEgress({ ...one, namespaceId: two.namespaceId }), unresolved);
});

test('settlement admits one full crossing response and is idempotent across instances', async t => {
  const f = await setup(t, { ...base, egressBytes: 100 });
  await f.usage.recordEgressBytes(one, 90);
  const handle = await f.usage.reserveEgress(one);
  const other = new HostedUsage(f.db, f.usage.config, f.usage.clock);
  await Promise.all([f.usage.settleEgress(handle, 25), other.settleEgress(handle, 25), f.usage.settleEgress(handle, 25)]);
  await f.usage.releaseEgress(handle);
  assert.deepEqual(await reservations(f), []);
  assert.equal((await f.usage.rollupMonthlyUsage(one, '2026-10')).egressBytes, 115);
  assert.deepEqual((await egressEvents(f)).map(e => [e.amount, e.unit, e.outcome]), [[90, 'byte', 'admitted'], [25, 'byte', 'admitted']]);
  await assert.rejects(f.usage.checkEgress(one), exceeded);
  await assert.rejects(f.usage.reserveEgress(one), exceeded);
});

test('failed settlement rolls back recording and retains a durable fail-closed claim after the fault is removed', async t => {
  const f = await setup(t, { ...base, egressBytes: 100 });
  const handle = await f.usage.reserveEgress(one), before = await reservations(f);
  await f.db.transaction(c => c.query("CREATE TRIGGER fail_egress BEFORE INSERT ON h8_usage_events BEGIN SELECT RAISE(ABORT, 'unavailable'); END"));
  await assert.rejects(f.usage.settleEgress(handle, 125), unresolved);
  assert.deepEqual(await reservations(f), before);
  assert.deepEqual(await egressEvents(f), []);
  assert.equal((await f.usage.rollupMonthlyUsage(one, '2026-10')).egressBytes, 0);
  await assert.rejects(f.usage.checkEgress(one), exceeded);
  await assert.rejects(f.usage.reserveEgress(one), exceeded);
  await f.db.transaction(c => c.query('DROP TRIGGER fail_egress'));
  const restarted = new HostedUsage(f.db, f.usage.config, f.usage.clock);
  await initializeUsage(f.db);
  await assert.rejects(restarted.checkEgress(one), exceeded);
  await assert.rejects(restarted.reserveEgress(one), exceeded);
  assert.deepEqual(await reservations(f), before);
});

test('release is idempotent, frees the allowance and never records usage', async t => {
  const f = await setup(t, { ...base, egressBytes: 100 });
  const handle = await f.usage.reserveEgress(one);
  await Promise.all([f.usage.releaseEgress(handle), f.usage.releaseEgress(handle)]);
  await f.usage.settleEgress(handle, 25);
  assert.equal((await f.usage.rollupMonthlyUsage(one, '2026-10')).egressBytes, 0);
  assert.deepEqual(await egressEvents(f), []);
  await f.usage.checkEgress(one);
  await f.usage.reserveEgress(one);
  assert.equal((await reservations(f))[0].reserved_bytes, 100);
});

test('reservations reset by admission month; settlement records its actual UTC date including zero bytes', async t => {
  const f = await setup(t, { ...base, egressBytes: 100 });
  f.at('2026-10-31T23:59:59.999Z');
  const october = await f.usage.reserveEgress(one);
  f.at('2026-11-01T00:00:00.000Z');
  await f.usage.checkEgress(one);
  const november = await f.usage.reserveEgress(one);
  assert.deepEqual((await reservations(f)).map(r => r.period).sort(), ['2026-10', '2026-11']);
  await f.usage.settleEgress(october, 5);
  await f.usage.settleEgress(november, 0);
  assert.equal((await f.usage.rollupMonthlyUsage(one, '2026-10')).egressBytes, 0);
  assert.equal((await f.usage.rollupMonthlyUsage(one, '2026-11')).egressBytes, 5);
  assert.deepEqual((await egressEvents(f)).map(e => [e.amount, e.created_at]), [[5, '2026-11-01T00:00:00.000Z'], [0, '2026-11-01T00:00:00.000Z']]);
  assert.deepEqual(await reservations(f), []);
});

test('uncapped reservations create no rows, allow concurrency and settle or release exactly once', async t => {
  const f = await setup(t, base);
  const handles = await Promise.all(Array.from({ length: 8 }, () => f.usage.reserveEgress(one)));
  assert.ok(handles.every(h => h.id === null));
  assert.deepEqual(await reservations(f), []);
  await f.usage.releaseEgress(handles[0]);
  await f.usage.settleEgress(handles[0], 100);
  await Promise.all(handles.slice(1).flatMap(h => [f.usage.settleEgress(h, 0), f.usage.settleEgress(h, 0)]));
  assert.equal((await egressEvents(f)).length, 7);
  assert.ok((await egressEvents(f)).every(e => e.amount === 0));
  assert.equal((await f.usage.rollupMonthlyUsage(one, '2026-10')).egressBytes, 0);
});

test('zero or invalid caps and reservation storage failure fail admission without recording', async t => {
  const f = await setup(t, { ...base, egressBytes: 0 });
  await assert.rejects(f.usage.reserveEgress(one), exceeded);
  for (const cap of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '2', null]) {
    f.usage.config.defaults.egressBytes = cap;
    await assert.rejects(f.usage.reserveEgress(one), unresolved);
    await assert.rejects(f.usage.checkEgress(one), unresolved);
  }
  f.usage.config.defaults.egressBytes = 100;
  await f.db.transaction(c => c.query("CREATE TRIGGER fail_reservation BEFORE INSERT ON h8_egress_reservations BEGIN SELECT RAISE(ABORT, 'UNIQUE constraint failed: h8_egress_reservations.id'); END"));
  await assert.rejects(f.usage.reserveEgress(one), unresolved);
  assert.deepEqual(await reservations(f), []);
  assert.deepEqual(await egressEvents(f), []);
});

test('corrupt reservations and combined monthly overflow fail both admission methods closed', async t => {
  const f = await setup(t, { ...base, egressBytes: 100 });
  await f.usage.reserveEgress(one);
  for (const amount of [-1, 0.5, 'bad', Number.MAX_SAFE_INTEGER + 1]) {
    await f.db.transaction(c => c.query('UPDATE h8_egress_reservations SET reserved_bytes = ?', [amount]));
    await assert.rejects(f.usage.checkEgress(one), unresolved);
    await assert.rejects(f.usage.reserveEgress(one), unresolved);
  }
  await f.db.transaction(c => c.query('UPDATE h8_egress_reservations SET reserved_bytes = ?', [Number.MAX_SAFE_INTEGER]));
  await f.usage.recordEgressBytes(one, 1);
  await assert.rejects(f.usage.checkEgress(one), unresolved);
  await assert.rejects(f.usage.reserveEgress(one), unresolved);
});

test('invalid settlements and corrupt or overflowing daily counters preserve reservations atomically', async t => {
  for (const amount of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '2', null, undefined]) {
    const f = await setup(t, { ...base, egressBytes: 100 });
    const handle = await f.usage.reserveEgress(one), before = await reservations(f);
    await assert.rejects(f.usage.settleEgress(handle, amount), unresolved);
    assert.deepEqual(await reservations(f), before);
    assert.deepEqual(await egressEvents(f), []);
  }
  for (const [admitted, denied] of [[-1, 0], [0, -1], [Number.MAX_SAFE_INTEGER, 0]]) {
    const f = await setup(t, { ...base, egressBytes: 100 });
    const handle = await f.usage.reserveEgress(one), before = await reservations(f);
    await f.db.transaction(c => c.query('INSERT INTO h8_usage VALUES (?,?,?,?,?,?)', [one.tenantId, one.namespaceId, '2026-10-03', 'egressBytes', admitted, denied]));
    await assert.rejects(f.usage.settleEgress(handle, 1), unresolved);
    assert.deepEqual(await reservations(f), before);
    assert.deepEqual(await egressEvents(f), []);
  }
});


async function serveUsage(t, f, compose) {
  await initializeJobs(f.db);
  return serveH8(t, f, { invocation: { usage: f.usage, signal: new AbortController().signal, compose } });
}
const headers = { authorization: 'one' };

test('overlapping HTTP responses admit exactly one crossing response with no charge for seven denials', { timeout: 10000 }, async t => {
  const f = await setup(t, { ...base, egressBytes: 1 });
  const entered = Promise.withResolvers(), proceed = Promise.withResolvers(), denied = Promise.withResolvers();
  let routes = 0, denials = 0;
  const { server, request } = await serveUsage(t, f, () => ({ allows: () => true, finish: async () => {},
    route: async (_request, response) => {
      routes++; entered.resolve(); await proceed.promise;
      response.setHeader('Content-Type', 'application/json');
      response.write('{"probe":'); response.end('"crossing"}'); return true;
    } }));
  // Launch all eight without waiting for a response. Hold the admitted route
  // open until the seven other HTTP requests finish their reservation denials.
  const requests = Array.from({ length: 8 }, () => request('/api/egress-probe', { headers }).then(result => {
    if (result.status === 429 && ++denials === 7) denied.resolve();
    return result;
  }));
  try {
    await entered.promise; await denied.promise;
    assert.equal(routes, 1);
    assert.equal((await reservations(f)).length, 1);
    assert.equal((await f.usage.rollupMonthlyUsage(one, '2026-10')).egressBytes, 0);
  } finally { proceed.resolve(); }
  const results = await Promise.all(requests);
  assert.equal(results.filter(r => r.status === 200).length, 1);
  assert.equal(results.filter(r => r.status === 429 && r.body.errorCode === exceeded.code).length, 7);
  assert.equal((await request('/api/egress-probe', { headers })).status, 429);
  await drainHostedServer(server);
  const record = await f.usage.rollupMonthlyUsage(one, '2026-10');
  assert.equal(record.egressBytes, Buffer.byteLength('{"probe":"crossing"}'));
  assert.equal(record.apiCallsAdmitted, 1); assert.equal(record.apiCallsDenied, 0);
  assert.equal((await egressEvents(f)).length, 1);
  assert.deepEqual(await reservations(f), []);
});

test('HTTP API quota failure releases admission before byte counting without an egress event', async t => {
  const f = await setup(t, { ...base, apiCalls: 0, egressBytes: 100 });
  const release = t.mock.method(f.usage, 'releaseEgress');
  const settle = t.mock.method(f.usage, 'settleEgress');
  const { server, request } = await serveUsage(t, f);
  assert.equal((await request('/api/session', { headers })).status, 429);
  assert.equal((await request('/api/session', { headers })).status, 429);
  await drainHostedServer(server);
  assert.equal(release.mock.callCount(), 2); assert.equal(settle.mock.callCount(), 0);
  assert.deepEqual(await reservations(f), []);
  assert.deepEqual(await egressEvents(f), []);
  const record = await f.usage.rollupMonthlyUsage(one, '2026-10');
  assert.equal(record.egressBytes, 0); assert.equal(record.apiCallsAdmitted, 0); assert.equal(record.apiCallsDenied, 2);
  await f.usage.checkEgress(one); await f.usage.reserveEgress(one);
});

test('HTTP errors after byte counting starts settle their exact response bytes once', async t => {
  const f = await setup(t, { ...base, egressBytes: 1 });
  const settle = t.mock.method(f.usage, 'settleEgress');
  const release = t.mock.method(f.usage, 'releaseEgress');
  const { server, request } = await serveUsage(t, f);
  const result = await request('/api/session', { headers, method: 'POST', body: {} });
  assert.equal(result.status, 405); assert.equal(result.body.errorCode, 'HOSTED_REQUEST_INVALID');
  assert.equal((await request('/api/session', { headers })).status, 429);
  await drainHostedServer(server);
  assert.equal(settle.mock.callCount(), 1); assert.equal(release.mock.callCount(), 0);
  assert.equal((await f.usage.rollupMonthlyUsage(one, '2026-10')).egressBytes, Buffer.byteLength(JSON.stringify(result.body)));
});

test('HTTP settlement failure logs once, retains the claim and never falls back to recording or release', async t => {
  const f = await setup(t, { ...base, egressBytes: 1 });
  await f.db.transaction(c => c.query("CREATE TRIGGER fail_http_egress BEFORE INSERT ON h8_usage_events WHEN NEW.metric = 'egressBytes' BEGIN SELECT RAISE(ABORT, 'unavailable'); END"));
  const log = t.mock.method(console, 'error', () => {});
  const release = t.mock.method(f.usage, 'releaseEgress');
  const record = t.mock.method(f.usage, 'recordEgressBytes');
  const settle = t.mock.method(f.usage, 'settleEgress');
  const { server, request } = await serveUsage(t, f);
  assert.equal((await request('/api/session', { headers })).status, 200);
  assert.equal((await request('/api/session', { headers })).status, 429);
  await f.db.transaction(c => c.query('DROP TRIGGER fail_http_egress'));
  assert.equal((await request('/api/session', { headers })).status, 429);
  await drainHostedServer(server);
  assert.equal(settle.mock.callCount(), 1); assert.equal(release.mock.callCount(), 0); assert.equal(record.mock.callCount(), 0);
  assert.deepEqual(log.mock.calls.map(c => c.arguments), [['EGRESS_RECORD_FAILED']]);
  assert.equal((await reservations(f)).length, 1);
  assert.equal((await f.usage.rollupMonthlyUsage(one, '2026-10')).egressBytes, 0);
  assert.deepEqual(await egressEvents(f), []);
});

test('HTTP reservation storage failure returns 503 before API charge or routing', async t => {
  const f = await setup(t, { ...base, egressBytes: 100 });
  await f.db.transaction(c => c.query("CREATE TRIGGER fail_http_reservation BEFORE INSERT ON h8_egress_reservations BEGIN SELECT RAISE(ABORT, 'unavailable'); END"));
  const consume = t.mock.method(f.usage, 'consume');
  const release = t.mock.method(f.usage, 'releaseEgress');
  const { server, request } = await serveUsage(t, f);
  const result = await request('/api/session', { headers });
  assert.equal(result.status, 503); assert.equal(result.body.errorCode, unresolved.code);
  await drainHostedServer(server);
  assert.equal(consume.mock.callCount(), 0); assert.equal(release.mock.callCount(), 0);
  assert.deepEqual(await reservations(f), []); assert.deepEqual(await egressEvents(f), []);
});

test('HTTP drain waits for pending settlement after response.end and finally select it once', { timeout: 10000 }, async t => {
  const f = await setup(t, { ...base, egressBytes: 1 });
  const entered = Promise.withResolvers(), proceed = Promise.withResolvers();
  const original = f.usage.settleEgress.bind(f.usage);
  const settle = t.mock.method(f.usage, 'settleEgress', async (...args) => {
    entered.resolve(); await proceed.promise; return original(...args);
  });
  const { server, request } = await serveUsage(t, f);
  const result = await request('/api/session', { headers }); await entered.promise;
  let drained = false;
  const drain = drainHostedServer(server).then(() => { drained = true; });
  try {
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(drained, false);
    assert.equal((await reservations(f)).length, 1);
  } finally { proceed.resolve(); }
  await drain;
  assert.equal(settle.mock.callCount(), 1);
  assert.deepEqual(await reservations(f), []);
  assert.equal((await f.usage.rollupMonthlyUsage(one, '2026-10')).egressBytes, Buffer.byteLength(JSON.stringify(result.body)));
});
