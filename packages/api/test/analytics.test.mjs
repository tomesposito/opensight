import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Analytics, analyticsFromEnvironment, rowCountBucket } from '../dist/analytics.js';
import { AnalyticsStore, initializeAnalytics } from '../dist/analytics-store.js';
import { SqliteMetadataDatabase } from '../dist/metadata-db.js';
import { initializeMetadata } from '../dist/metadata-schema.js';
import { TenantMetadata } from '../dist/metadata.js';
import { insertResource } from '../dist/metadata-resources.js';

export async function fixture() {
  const db = new SqliteMetadataDatabase(':memory:'); await initializeMetadata(db); await initializeAnalytics(db);
  for (const [tenantId, namespaceId] of [['a', 'one'], ['b', 'two']]) await db.transaction(async c => {
    await c.query("INSERT INTO h1_tenants (tenant_id,state,version) VALUES (?, 'active', 1)", [tenantId]);
    await c.query('INSERT INTO h1_namespaces VALUES (?,?,?)', [namespaceId, tenantId, namespaceId]);
    await c.query('INSERT INTO h1_revisions VALUES (?,?,1,1,1)', [tenantId, namespaceId]);
    await insertResource(c, { tenantId, namespaceId }, { kind: 'user', id: 'admin' }, { name: 'Synthetic admin', role: 'administrator' });
  });
  const metadata = new TenantMetadata(db, db), store = new AnalyticsStore(db);
  const a = await metadata.authenticate(null, async () => ({ namespaceId: 'one', userId: 'admin' }));
  const b = await metadata.authenticate(null, async () => ({ namespaceId: 'two', userId: 'admin' }));
  return { db, metadata, store, a, b };
}
test('analytics disabled or unconfigured: no log rows, delivery, or caller errors', async () => {
  const f = await fixture(); let calls = 0;
  try {
    for (const options of [{}, { enabled: true }, { vendorKey: 'test-only' }, { enabled: true, vendorKey: 'test-only', vendorHost: 'http://invalid' }]) {
      const analytics = new Analytics(f.store, { ...options, deliver: async () => { calls++; } });
      assert.doesNotThrow(() => analytics.track(f.a, { name: 'tenant_provisioned' })); await analytics.close();
    }
    assert.equal(calls, 0); assert.deepEqual(await f.store.read(f.metadata, f.a), []);
    assert.equal(analyticsFromEnvironment({}).enabled, false); assert.equal(analyticsFromEnvironment({ ANALYTICS_ENABLED: 'true' }).enabled, false);
  } finally { await f.db.close(); }
});
test('analytics door rejects content, unknown fields, malformed values and executable properties', async () => {
  const f = await fixture(), analytics = new Analytics(f.store, { enabled: true, vendorKey: 'test-only' });
  try {
    const invalid = [
      { name: 'unknown' }, { name: 'user_invited', props: { email: 'private' } }, { name: 'analysis_created', props: { name: 'private' } },
      { name: 'dataset_uploaded', props: { sourceType: 'file', rowCountBucket: '1-99', rowCount: 3 } },
      { name: 'dataset_uploaded', props: { sourceType: 'private file', rowCountBucket: '1-99' } },
      { name: 'dataset_uploaded', props: { sourceType: 'file', rowCountBucket: 3 } },
      { name: 'ask_o_asked', props: { count: 1, question: 'private' } }, { name: 'ask_o_asked', props: { count: NaN } },
      { name: 'ask_o_asked', props: { count: -1 } }, { name: 'ask_o_asked', props: { count: 1.5 } },
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
  const f = await fixture(), analytics = new Analytics(f.store, { enabled: true, vendorKey: 'test-only' });
  try {
    analytics.track(f.a, { name: 'analysis_created' }); analytics.track(f.b, { name: 'user_invited' });
    analytics.track({ tenantId: 'b', namespaceId: 'one' }, { name: 'dashboard_shared' }); await analytics.close();
    assert.deepEqual((await f.store.read(f.metadata, f.a)).map(r => r.name), ['analysis_created']);
    assert.deepEqual((await f.store.read(f.metadata, f.b)).map(r => r.name), ['user_invited']); assert.equal(analytics.stats.failed, 1);
    await assert.rejects(f.store.read(f.metadata, { ...f.a, tenantId: 'b' }), { code: 'TENANT_CONTEXT_REQUIRED' });
    await assert.rejects(f.store.read(f.metadata, { ...f.a }), { code: 'TENANT_CONTEXT_REQUIRED' });
  } finally { await f.db.close(); }
});
test('analytics row buckets expose only fixed ranges', () => {
  assert.deepEqual([0, 1, 99, 100, 999, 1000, 9999, 10000, 123456].map(rowCountBucket), ['0', '1-99', '1-99', '100-999', '100-999', '1000-9999', '1000-9999', '10000+', '10000+']);
});
