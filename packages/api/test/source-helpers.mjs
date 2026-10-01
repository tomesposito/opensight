import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { SqliteMetadataDatabase } from '../dist/metadata-db.js';
import { initializeMetadata } from '../dist/metadata-schema.js';
import { insertResource } from '../dist/metadata-resources.js';
import { TenantMetadata } from '../dist/metadata.js';
import { HostedSources } from '../dist/hosted-sources.js';
export const policy = { rowLevel: false, rowRules: [] };
export const columns = [{ name: 'region', type: 'STRING' }, { name: 'amount', type: 'INTEGER' }, { name: 'private', type: 'STRING' }];
export const endpoints = [{ id: 'reference', host: 'localhost', port: 5433, database: 'opensight', tls: false }];
export const credentials = () => ({ username: 'synthetic', password: randomBytes(24).toString('base64') });
export const registration = () => ({ connectorId: 'postgresql', endpointId: 'reference', schema: 'public', table: 'synthetic', columns, credentials: credentials(), policy });
export const upload = (p = policy, expiry = '2099-01-01T00:00:00.000Z') => ({ config: { format: 'csv' }, base64: Buffer.from('region,amount,private\neast,10,a\nwest,20,b\neast,30,c\n').toString('base64'), policy: p, expiresAt: expiry });
export async function seedSources(db) {
  for (const [tenantId, namespaceId] of [['tenant-one', 'one'], ['tenant-two', 'two']]) await db.transaction(async c => {
    await c.query("INSERT INTO h1_tenants VALUES (?,'active',1,NULL,NULL,NULL)", [tenantId]);
    await c.query('INSERT INTO h1_namespaces VALUES (?,?,?)', [namespaceId, tenantId, namespaceId]);
    await c.query('INSERT INTO h1_revisions VALUES (?,?,1,1,1)', [tenantId, namespaceId]);
    for (const id of ['admin', 'other']) await insertResource(c, { tenantId, namespaceId }, { kind: 'user', id }, { name: id, role: 'administrator' });
  });
}
export async function sourceFixture(t, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'opensight-h3-')), path = join(dir, 'metadata.sqlite'), key = randomBytes(32).toString('base64');
  let db = new SqliteMetadataDatabase(path), now = Date.now();
  await initializeMetadata(db); await seedSources(db);
  const f = { path, key, get db() { return db; }, advance(ms) { now += ms; }, endpoints: options.endpoints ?? endpoints,
    async restart() { await db.close(); db = new SqliteMetadataDatabase(path); setup(); } };
  function setup() {
    f.metadata = new TenantMetadata(db, db); f.sources = new HostedSources(f.metadata, key, f.endpoints, () => now);
    f.login = (namespaceId = 'one', userId = 'admin') => f.metadata.authenticate(null, async () => ({ namespaceId, userId }));
  }
  setup(); t.after(async () => { await db.close(); await rm(dir, { recursive: true, force: true }); }); return f;
}
