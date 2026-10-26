import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Analytics, analyticsFromEnvironment } from './analytics.js';
import { AnalyticsStore, initializeAnalytics } from './analytics-store.js';
import { SqliteMetadataDatabase } from './metadata-db.js';
import { initializeMetadata } from './metadata-schema.js';
import type { Scope } from './metadata-resources.js';

/** Local servers use a separate SQLite log and opaque installation tenant IDs. */
export async function localAnalytics(namespaces: readonly string[], path?: string, env: NodeJS.ProcessEnv = process.env) {
  path ??= env.ANALYTICS_STORE;
  if (path) await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const db = new SqliteMetadataDatabase(path ?? ':memory:');
  try {
    await initializeMetadata(db); await initializeAnalytics(db);
    const scopes = new Map<string, Scope>();
    for (const namespaceId of new Set(namespaces)) await db.transaction(async c => {
      let row = (await c.query('SELECT tenant_id FROM h1_namespaces WHERE namespace_id = ?', [namespaceId]))[0];
      if (!row) {
        const tenantId = randomUUID();
        await c.query("INSERT INTO h1_tenants (tenant_id,state,version) VALUES (?,'active',1)", [tenantId]);
        await c.query('INSERT INTO h1_namespaces VALUES (?,?,?)', [namespaceId, tenantId, namespaceId]); row = { tenant_id: tenantId };
      }
      scopes.set(namespaceId, { tenantId: String(row.tenant_id), namespaceId });
    });
    const analytics = new Analytics(new AnalyticsStore(db), { ...analyticsFromEnvironment(env), localScopes: scopes });
    return { analytics, scope: (namespaceId: string) => scopes.get(namespaceId), close: async () => { await analytics.close(); await db.close(); } };
  } catch (error) { await db.close(); throw error; }
}
