import { type Database, MetadataError } from './metadata-db.js';
import { sourceBody } from './source-schema.js';
import { insertLinks, resourceLinks } from './metadata-resources.js';
import { appendMetadataEvent } from './metadata-outbox.js';

/** Bootstrap never interprets legacy startup assertions as hosted authorization. */
export async function assertHostedSourcesReady(database: Database): Promise<void> {
  await database.transaction(async c => {
    for (const r of await c.query("SELECT owner_id, body FROM h1_resources WHERE kind = 'source'")) {
      if (!r.owner_id) throw new MetadataError('SOURCE_MIGRATION_REQUIRED', 503);
      sourceBody(JSON.parse(String(r.body)));
    }
    if ((await c.query("SELECT migration_id FROM h1_migrations WHERE migration_id LIKE 'h3_%' AND state = 'committed'")).length) throw new MetadataError('SOURCE_MIGRATION_UNSEALED', 503);
  });
}
/** Expired payloads are deleted at startup and every minute, including suspended tenants.
 * Every read independently checks expiry; a failed sweep cannot admit expired data. */
export async function expireUploads(database: Database, now = Date.now()): Promise<void> {
  await database.transaction(async c => {
    const namespaces = await c.query('SELECT tenant_id, namespace_id FROM h1_namespaces ORDER BY tenant_id');
    for (const ns of namespaces) {
      const scope = { tenantId: String(ns.tenant_id), namespaceId: String(ns.namespace_id) };
      await c.query('UPDATE h1_tenants SET version = version WHERE tenant_id = ?', [scope.tenantId]);
      let changed = false;
      for (const r of await c.query("SELECT * FROM h1_resources WHERE tenant_id = ? AND namespace_id = ? AND kind = 'source'", [scope.tenantId, scope.namespaceId])) {
        const body = sourceBody(JSON.parse(String(r.body)));
        if (body.binding.connectorId !== 'file' || body.binding.state !== 'active' || Date.parse(body.binding.expiresAt!) > now) continue;
        const key = { kind: 'source' as const, id: String(r.resource_id), ownerId: String(r.owner_id) };
        const values = [scope.tenantId, scope.namespaceId, 'source', key.ownerId, key.id], predicate = 'tenant_id = ? AND namespace_id = ? AND kind = ? AND owner_id = ? AND resource_id = ?';
        const retired = { binding: { ...body.binding, state: 'expired' }, policy: body.policy };
        await c.query(`DELETE FROM h1_links WHERE ${predicate}`, values);
        await c.query(`UPDATE h1_resources SET body = ?, version = version + 1 WHERE ${predicate}`, [JSON.stringify(retired), ...values]);
        await insertLinks(c, scope, key, resourceLinks(key, retired));
        await c.query(`DELETE FROM h1_resources WHERE ${predicate}`, [scope.tenantId, scope.namespaceId, 'secret', key.ownerId, body.secretId!]);
        changed = true;
      }
      if (changed) {
        await c.query('UPDATE h1_revisions SET configuration = configuration + 1 WHERE tenant_id = ? AND namespace_id = ?', [scope.tenantId, scope.namespaceId]);
        await appendMetadataEvent(c, scope, 'uploads.expired');
      }
    }
  });
}
