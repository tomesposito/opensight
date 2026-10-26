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
