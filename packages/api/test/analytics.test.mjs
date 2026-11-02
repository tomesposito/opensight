import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Analytics, analyticsFromEnvironment, rowCountBucket } from '../dist/analytics.js';
import { fixture } from './analytics-helpers.mjs';
import { initializeAnalytics } from '../dist/analytics-store.js';

test('analytics disabled or unconfigured: no log rows, delivery, or caller errors', async () => {
  const f = await fixture(); let calls = 0;
  try {
    for (const options of [{}, { enabled: true }, { vendorKey: 'test-only' }, { enabled: true, vendorKey: 'test-only', vendorHost: 'http://invalid' }]) {
      const analytics = new Analytics(f.store, { ...options, transport: async () => { calls++; return { ok: true }; } });
      assert.doesNotThrow(() => analytics.track(f.a, { name: 'tenant_provisioned' })); await analytics.close();
    }
    assert.equal(calls, 0); assert.deepEqual(await f.store.read(f.metadata, f.a), []);
    assert.equal(analyticsFromEnvironment({}).enabled, false); assert.equal(analyticsFromEnvironment({ ANALYTICS_ENABLED: 'true' }).enabled, false);
  } finally { await f.db.close(); }
});
test('analytics door rejects content, unknown fields, malformed values and executable properties', async () => {
  const f = await fixture(), analytics = new Analytics(f.store, { enabled: true, vendorKey: 'test-only', transport: async () => ({ ok: true }) });
  try {
    const invalid = [
      { name: 'unknown' }, { name: 'user_invited', props: { email: 'private' } }, { name: 'analysis_created', props: { name: 'private' } },
      { name: 'dataset_uploaded', props: { sourceType: 'file', rowCountBucket: '1-99', rowCount: 3 } },
      { name: 'dataset_uploaded', props: { sourceType: 'private file', rowCountBucket: '1-99' } },
      { name: 'dataset_uploaded', props: { sourceType: 'file', rowCountBucket: 3 } },
      { name: 'ask_o_asked', props: { count: 1, question: 'private' } }, { name: 'ask_o_asked', props: { count: NaN } },
      { name: 'ask_o_asked', props: { count: -1 } }, { name: 'ask_o_asked', props: { count: 1.5 } },
      { name: 'data_source_connected', props: { sourceType: 'file' } },
      { name: 'data_source_connected', props: { sourceType: 'postgresql', endpoint: 'private' } },
      { name: 'dashboard_saved', props: { first: 'true' } }, { name: 'dashboard_saved', props: {} },
      { name: 'dashboard_saved', props: { first: true, name: 'private' } },
      { name: 'dashboard_edited', props: { first: false } },
      { name: 'analysis_created', userId: 'private' }, { name: 'analysis_created', props: { toJSON() { throw Error(); } } },
      { get name() { throw Error(); } }, { name: 'analysis_created', props: { [Symbol('private')]: 'secret' } },
    ];
    for (const event of invalid) assert.doesNotThrow(() => analytics.track(f.a, event));
    const event = { name: 'ask_o_asked', props: { count: 1 } }; analytics.track(f.a, event); event.props.question = 'late content';
    await analytics.close(); assert.equal(analytics.stats.invalid, invalid.length);
    assert.deepEqual((await f.store.read(f.metadata, f.a)).map(r => [r.name, r.props]), [['ask_o_asked', { count: 1 }]]);
  } finally { await f.db.close(); }
});
test('analytics log isolates tenant reads and refuses crossed tenant/namespace writes and forged contexts', async () => {
  const f = await fixture(), analytics = new Analytics(f.store, { enabled: true, vendorKey: 'test-only', transport: async () => ({ ok: true }) });
  try {
    analytics.track(f.a, { name: 'analysis_created' }); analytics.track(f.b, { name: 'user_invited' });
    analytics.track({ tenantId: 'b', namespaceId: 'one' }, { name: 'dashboard_shared' }); await analytics.close();
    assert.deepEqual((await f.store.read(f.metadata, f.a)).map(r => r.name), ['analysis_created']);
    assert.deepEqual((await f.store.read(f.metadata, f.b)).map(r => r.name), ['user_invited']); assert.equal(analytics.stats.failed, 1);
    await assert.rejects(f.store.read(f.metadata, { ...f.a, tenantId: 'b' }), { code: 'TENANT_CONTEXT_REQUIRED' });
    await assert.rejects(f.store.read(f.metadata, { ...f.a }), { code: 'TENANT_CONTEXT_REQUIRED' });
  } finally { await f.db.close(); }
});
test('Issue #179: the three capture events record only their fixed properties', async () => {
  const f = await fixture(), analytics = new Analytics(f.store, { enabled: true, vendorKey: 'test-only', transport: async () => ({ ok: true }) });
  try {
    analytics.track(f.a, { name: 'data_source_connected', props: { sourceType: 'postgresql' } });
    analytics.track(f.a, { name: 'dashboard_saved', props: { first: true } });
    analytics.track(f.a, { name: 'dashboard_saved', props: { first: false } });
    analytics.track(f.a, { name: 'dashboard_edited' });
    await analytics.close(); assert.equal(analytics.stats.invalid, 0);
    assert.deepEqual((await f.store.read(f.metadata, f.a)).map(r => [r.name, r.props]), [
      ['data_source_connected', { sourceType: 'postgresql' }],
      ['dashboard_saved', { first: true }],
      ['dashboard_saved', { first: false }],
      ['dashboard_edited', {}],
    ]);
  } finally { await f.db.close(); }
});
test('analytics row buckets expose only fixed ranges', () => {
  assert.deepEqual([0, 1, 99, 100, 999, 1000, 9999, 10000, 123456].map(rowCountBucket), ['0', '1-99', '1-99', '100-999', '100-999', '1000-9999', '1000-9999', '10000+', '10000+']);
});
test('PostHog capture identifies only tenants, includes no caller content, and keeps the own copy on failure', async () => {
  const f = await fixture(), calls = [];
  const analytics = new Analytics(f.store, { enabled: true, vendorKey: 'test-only', vendorHost: 'https://analytics.example.test', transport: async (url, init) => {
    calls.push({ url, init }); throw Error('transport failure');
  } });
  try {
    analytics.track(f.a, { name: 'dataset_uploaded', props: { sourceType: 'file', rowCountBucket: '1-99' } });
    await analytics.flush();
    assert.equal(calls.length, 1); assert.equal(calls[0].url, 'https://analytics.example.test/capture/');
    assert.equal(calls[0].init.method, 'POST'); assert.equal(calls[0].init.redirect, 'error');
    const body = JSON.parse(calls[0].init.body);
    assert.deepEqual(Object.keys(body).sort(), ['api_key', 'event', 'properties', 'timestamp', 'uuid']);
    assert.deepEqual(body.properties, { sourceType: 'file', rowCountBucket: '1-99', distinct_id: 'a', $groups: { tenant: 'a' }, $process_person_profile: false });
    assert.equal(JSON.stringify(body).includes('admin'), false); assert.equal(JSON.stringify(body).includes('one'), false);
    assert.equal(analytics.stats.failed, 1); assert.equal((await f.store.read(f.metadata, f.a)).length, 1);
  } finally { await analytics.close(); await f.db.close(); }
});
test('analytics buffer is bounded, timeouts drain, close refuses new events, and non-2xx never escapes', async () => {
  const f = await fixture();
  try {
    const analytics = new Analytics(f.store, { enabled: true, vendorKey: 'test-only', maxBuffered: 2, timeoutMs: 5, transport: () => new Promise(() => {}) });
    for (let i = 0; i < 20; i++) analytics.track(f.a, { name: 'dashboard_viewed' });
    await analytics.close(); assert.equal(analytics.stats.dropped, 18); assert.equal(analytics.stats.failed, 2);
    analytics.track(f.a, { name: 'dashboard_viewed' }); assert.equal(analytics.stats.recorded, 2);
    const rejected = new Analytics(f.store, { enabled: true, vendorKey: 'test-only', transport: async () => ({ ok: false }) });
    rejected.track(f.b, { name: 'dashboard_viewed' }); await rejected.close(); assert.equal(rejected.stats.failed, 1);
  } finally { await f.db.close(); }
});
test('local composition defaults off and preserves opaque tenant IDs across server restarts', async () => {
  const { localAnalytics } = await import('../dist/analytics-local.js');
  const { mkdtemp, rm } = await import('node:fs/promises'); const { join } = await import('node:path'); const { tmpdir } = await import('node:os');
  const dir = await mkdtemp(join(tmpdir(), 'analytics-'));
  try {
    const path = join(dir, 'events.sqlite'), first = await localAnalytics(['local'], path, {});
    assert.equal(first.analytics.defaultEnabled, false); assert.equal(first.analytics.configured, false);
    const tenant = first.scope('local').tenantId; assert.notEqual(tenant, 'local');
    await first.close();
    const next = await localAnalytics(['local'], path, { ANALYTICS_ENABLED: '1', ANALYTICS_VENDOR_KEY: 'test-only' });
    assert.equal(next.analytics.configured, true); assert.equal(next.scope('local').tenantId, tenant); await next.close();
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('Issue #175: analytics migration preserves legacy rows and is idempotent with direct and nested databases', async () => {
  for (const nested of [false, true]) {
    const f = await fixture();
    try {
      await f.store.append({ ...f.a, id: 'legacy', name: 'dashboard_viewed', props: {}, createdAt: '2026-10-01T00:00:00.000Z' }, true);
      const before = await f.store.read(f.metadata, f.a);
      await f.db.transaction(c => c.query('ALTER TABLE analytics_events DROP COLUMN delivered_at'));
      const migrate = () => nested
        ? f.db.transaction(c => initializeAnalytics({ transaction: work => work(c), close: async () => {} }))
        : initializeAnalytics(f.db);
      await migrate(); await migrate();
      assert.deepEqual(await f.store.read(f.metadata, f.a), before);
      assert.deepEqual(await f.store.undelivered(), before);
      assert.equal((await f.db.transaction(c => c.query('SELECT delivered_at FROM analytics_events')))[0].delivered_at, null);
      await f.store.markDelivered('legacy');
      await migrate();
      assert.deepEqual(await f.store.undelivered(), []);
      assert.deepEqual(await f.store.read(f.metadata, f.a), before);
    } finally { await f.db.close(); }
  }
});
test('Issue #175: private analytics outbox is ordered, bounded and excludes acknowledged rows', async () => {
  const f = await fixture();
  try {
    for (const [scope, id, createdAt] of [[f.a, 'new', '2026-10-02'], [f.b, 'old-b', '2026-10-01'], [f.a, 'old-a', '2026-10-01']]) {
      await f.store.append({ ...scope, id, createdAt, name: 'dashboard_viewed', props: {} }, true);
    }
    assert.deepEqual((await f.store.undelivered(2)).map(r => r.id), ['old-a', 'old-b']);
    await f.store.markDelivered('old-a');
    assert.deepEqual((await f.store.undelivered(2)).map(r => r.id), ['old-b', 'new']);
    assert.equal(Object.hasOwn((await f.store.read(f.metadata, f.a))[0], 'delivered_at'), false);
    for (const limit of [0, -1, 1.5, NaN, Infinity]) await assert.rejects(f.store.undelivered(limit), { code: 'ANALYTICS_DRAIN_LIMIT_INVALID' });
  } finally { await f.db.close(); }
});

async function promptly(work) {
  let timer;
  try {
    return await Promise.race([work, new Promise((_, reject) => {
      timer = setTimeout(() => reject(Error('analytics completion waited for vendor delivery')), 250);
    })]);
  } finally { clearTimeout(timer); }
}
test('Issue #175: deferred flush and close persist a bounded queue without awaiting a hanging vendor', async () => {
  const f = await fixture(), started = Promise.withResolvers();
  let calls = 0;
  const analytics = new Analytics(f.store, { enabled: true, vendorKey: 'test-only', deliveryMode: 'deferred', maxBuffered: 1,
    timeoutMs: 1000, transport: () => { calls++; started.resolve(); return new Promise(() => {}); } });
  try {
    analytics.track(f.a, { name: 'dashboard_viewed', props: { secret: 'refused' } });
    for (let i = 0; i < 4; i++) analytics.track(f.a, { name: 'dashboard_viewed' });
    await promptly(analytics.flush());
    await promptly(started.promise); // Piggyback started without an explicit drain.
    await promptly(analytics.close());
    analytics.track(f.a, { name: 'dashboard_shared' });
    assert.equal((await f.store.read(f.metadata, f.a)).length, 1);
    assert.deepEqual(analytics.stats, { invalid: 1, dropped: 3, failed: 0, recorded: 1 });
    assert.equal(calls, 1);
    assert.equal(await analytics.drainDeferred(), 0);
    assert.equal(analytics.stats.failed, 1);
    assert.equal((await f.store.undelivered()).length, 1);
  } finally { await analytics.close(); await f.db.close(); }
});
test('Issue #175: deferred capture shares one drain and acknowledges only successful deliveries', async () => {
  const f = await fixture(), started = Promise.withResolvers(), response = Promise.withResolvers(), calls = [];
  const analytics = new Analytics(f.store, { enabled: true, vendorKey: 'test-only', vendorHost: 'https://analytics.example.test', deliveryMode: 'deferred',
    transport: async (url, init) => { calls.push({ url, init }); started.resolve(); return calls.length === 1 ? response.promise : { ok: true }; } });
  try {
    analytics.track(f.a, { name: 'dataset_uploaded', props: { sourceType: 'file', rowCountBucket: '1-99' } });
    await analytics.flush(); await promptly(started.promise);
    const [row] = await f.store.read(f.metadata, f.a), drain = analytics.drainDeferred();
    assert.equal(analytics.drainDeferred(), drain);
    assert.equal(calls[0].url, 'https://analytics.example.test/capture/');
    assert.equal(calls[0].init.method, 'POST'); assert.equal(calls[0].init.redirect, 'error');
    assert.deepEqual(JSON.parse(calls[0].init.body), {
      api_key: 'test-only', event: row.name, timestamp: row.createdAt, uuid: row.id,
      properties: { sourceType: 'file', rowCountBucket: '1-99', distinct_id: 'a', $groups: { tenant: 'a' }, $process_person_profile: false },
    });
    assert.equal((await f.store.undelivered()).length, 1);
    // A second persistence completion must share the in-flight piggyback batch.
    analytics.track(f.b, { name: 'dashboard_shared' }); await analytics.flush();
    assert.equal(analytics.drainDeferred(), drain); assert.equal(calls.length, 1);
    response.resolve({ ok: true }); assert.equal(await drain, 1);
    assert.equal(await analytics.drainDeferred(), 1);
    assert.equal(await analytics.drainDeferred(), 0); assert.equal(calls.length, 2);
    assert.deepEqual(await f.store.undelivered(), []);
    assert.match((await f.db.transaction(c => c.query('SELECT delivered_at FROM analytics_events WHERE event_id = ?', [row.id])))[0].delivered_at, /^\d{4}-/);
  } finally { response.resolve({ ok: true }); await analytics.close(); await analytics.drainDeferred(); await f.db.close(); }
});
test('Issue #175: a new Analytics instance retries failed durable rows with the same event UUIDs', async () => {
  const f = await fixture(), attempts = [], delivered = [];
  const first = new Analytics(f.store, { enabled: true, vendorKey: 'test-only', deliveryMode: 'deferred', transport: async (_url, init) => {
    attempts.push(JSON.parse(init.body)); if (attempts.length === 1) throw Error('offline'); return { ok: false };
  } });
  const next = new Analytics(f.store, { enabled: true, vendorKey: 'test-only', deliveryMode: 'deferred', transport: async (_url, init) => {
    delivered.push(JSON.parse(init.body)); return { ok: true };
  } });
  try {
    first.track(f.a, { name: 'dashboard_viewed' }); first.track(f.b, { name: 'dashboard_shared' });
    await first.close(); assert.equal(await first.drainDeferred(), 0);
    assert.equal(first.stats.failed, 2); assert.equal((await f.store.undelivered()).length, 2);
    assert.equal(await next.drainDeferred(), 2);
    assert.deepEqual(delivered, attempts);
    assert.equal(await next.drainDeferred(), 0);
    assert.deepEqual(next.stats, { invalid: 0, dropped: 0, failed: 0, recorded: 0 });
  } finally { await first.close(); await next.close(); await f.db.close(); }
});
test('Issue #175: disabling a tenant after persistence suppresses later deferred delivery', async t => {
  const f = await fixture(), check = Promise.withResolvers(); let calls = 0;
  const enabled = f.store.enabled.bind(f.store);
  t.mock.method(f.store, 'enabled', async (...args) => { await check.promise; return enabled(...args); });
  const analytics = new Analytics(f.store, { enabled: true, vendorKey: 'test-only', deliveryMode: 'deferred', transport: async () => { calls++; return { ok: true }; } });
  try {
    analytics.track(f.a, { name: 'dashboard_viewed' }); await analytics.flush();
    assert.equal((await f.store.read(f.metadata, f.a)).length, 1);
    await analytics.setEnabled(f.a, false); check.resolve();
    assert.equal(await analytics.drainDeferred(), 0); assert.equal(calls, 0);
    assert.equal((await f.store.undelivered()).length, 1);
    assert.equal(analytics.stats.failed, 0);
  } finally { check.resolve(); await analytics.close(); await analytics.drainDeferred(); await f.db.close(); }
});
test('Issue #175: deferred drains use a bounded oldest-first batch and honor each tenant setting', async () => {
  const f = await fixture(), ids = [];
  const analytics = new Analytics(f.store, { enabled: false, vendorKey: 'test-only', deliveryMode: 'deferred', transport: async (_url, init) => {
    ids.push(JSON.parse(init.body).uuid); return { ok: true };
  } });
  try {
    for (let i = 0; i < 35; i++) await f.store.append({ ...f.a, id: `event-${String(i).padStart(2, '0')}`, createdAt: '2026-10-01', name: 'dashboard_viewed', props: {} }, true);
    assert.equal(await analytics.drainDeferred(), 0); assert.equal(ids.length, 0);
    await analytics.setEnabled(f.a, true);
    assert.equal(await analytics.drainDeferred(), 32);
    assert.deepEqual(ids, Array.from({ length: 32 }, (_, i) => `event-${String(i).padStart(2, '0')}`));
    assert.equal(await analytics.drainDeferred(2), 2); assert.equal(await analytics.drainDeferred(2), 1);
    assert.equal(await analytics.drainDeferred(), 0);
  } finally { await analytics.close(); await f.db.close(); }
});
test('Issue #175: inline success is acknowledged and inline failure can later be drained', async () => {
  const f = await fixture(); let calls = 0;
  const inline = new Analytics(f.store, { enabled: true, vendorKey: 'test-only', transport: async () => ({ ok: ++calls === 1 }) });
  const deferred = new Analytics(f.store, { enabled: true, vendorKey: 'test-only', deliveryMode: 'deferred', transport: async () => ({ ok: true }) });
  try {
    inline.track(f.a, { name: 'dashboard_viewed' }); inline.track(f.a, { name: 'dashboard_shared' }); await inline.close();
    assert.equal(calls, 2); assert.equal(inline.stats.failed, 1);
    assert.deepEqual((await f.store.undelivered()).map(r => r.name), ['dashboard_shared']);
    assert.equal(await deferred.drainDeferred(), 1); assert.equal(await deferred.drainDeferred(), 0);
    assert.equal((await f.store.read(f.metadata, f.a)).length, 2);
  } finally { await inline.close(); await deferred.close(); await f.db.close(); }
});

test('Issue #175: built-in hosted invocation completion persists analytics without waiting for a hanging vendor or running DDL', async t => {
  const { h8Fixture } = await import('./h8-helpers.mjs');
  const { HostedAuth } = await import('../dist/hosted-auth.js');
  const { hostedConfig } = await import('../dist/hosted-config.js');
  const { createBuiltinHostedServer, finishHostedInvocation, drainHostedServer } = await import('../dist/hosted-server.js');
  const f = await h8Fixture(t), started = Promise.withResolvers(), queries = [];
  await initializeAnalytics(f.db); await HostedAuth.create(f.db, hostedConfig(f.env));
  t.mock.method(globalThis, 'fetch', () => { started.resolve(); return new Promise(() => {}); });
  const db = { durable: true, transaction: work => f.db.transaction(c => work({ query(sql, values) { queries.push(sql); return c.query(sql, values); } })) };
  let analytics, finished = 0;
  const server = await createBuiltinHostedServer({ membershipDatabase: db, tenantDatabase: db,
    env: { ...f.env, ANALYTICS_ENABLED: '1', ANALYTICS_VENDOR_KEY: 'test-only' },
    invocation: { signal: new AbortController().signal, compose: (_metadata, budgets, _auth, _meter, created) => {
      analytics = created;
      return { allows: () => true, capabilities: {}, route: async () => false, finish: async () => { finished++; await budgets.shutdown(); } };
    } },
  });
  try {
    analytics.track({ tenantId: 'tenant-one', namespaceId: 'one' }, { name: 'dashboard_viewed' });
    await promptly(finishHostedInvocation(server));
    assert.equal(finished, 1); assert.equal(analytics.stats.recorded, 1);
    await promptly(started.promise);
    assert.equal((await analytics.store.undelivered()).length, 1);
    await promptly(drainHostedServer(server));
    assert.equal(analytics.stats.failed, 0);
    assert.ok(!queries.some(sql => /^\s*(?:CREATE|ALTER|PRAGMA|SAVEPOINT)\b/.test(sql)), 'serverless composition must not initialize or migrate analytics');
    assert.equal(await analytics.drainDeferred(), 0);
  } finally { await drainHostedServer(server); await analytics.drainDeferred(); }
});
test('Issue #175: hosted invocation preserves an injected inline Analytics instance', async t => {
  const { h8Fixture } = await import('./h8-helpers.mjs');
  const { AnalyticsStore } = await import('../dist/analytics-store.js');
  const { HostedAuth } = await import('../dist/hosted-auth.js');
  const { hostedConfig } = await import('../dist/hosted-config.js');
  const { createBuiltinHostedServer, finishHostedInvocation, drainHostedServer } = await import('../dist/hosted-server.js');
  const f = await h8Fixture(t), started = Promise.withResolvers(), response = Promise.withResolvers();
  await initializeAnalytics(f.db); await HostedAuth.create(f.db, hostedConfig(f.env));
  const injected = new Analytics(new AnalyticsStore(f.db), { enabled: true, vendorKey: 'test-only', transport: () => { started.resolve(); return response.promise; } });
  let finished = false;
  const server = await createBuiltinHostedServer({ membershipDatabase: f.db, tenantDatabase: f.db, env: f.env, analytics: injected,
    invocation: { signal: new AbortController().signal, compose: (_metadata, budgets, _auth, _meter, created) => {
      assert.equal(created, injected);
      return { allows: () => true, capabilities: {}, route: async () => false, finish: async () => { finished = true; await budgets.shutdown(); } };
    } },
  });
  try {
    injected.track({ tenantId: 'tenant-one', namespaceId: 'one' }, { name: 'dashboard_viewed' });
    const completion = finishHostedInvocation(server);
    await promptly(started.promise); await new Promise(resolve => setImmediate(resolve));
    assert.equal(finished, false);
    response.resolve({ ok: true }); await completion;
    assert.equal(finished, true); assert.deepEqual(await injected.store.undelivered(), []);
  } finally { response.resolve({ ok: true }); await drainHostedServer(server); }
});
