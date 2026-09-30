import { randomUUID } from 'node:crypto';
import type { SqlConnection } from './metadata-db.js';
import type { Scope } from './metadata-resources.js';

/** Append within the metadata transaction. No external delivery happens here. */
export async function appendMetadataEvent(c: SqlConnection, scope: Scope, type: string): Promise<void> {
  const revisions = await c.query('SELECT "authorization" FROM h1_revisions WHERE tenant_id = ? AND namespace_id = ?', [scope.tenantId, scope.namespaceId]);
  await c.query('INSERT INTO h1_outbox VALUES (?,?,?,?,?,?)', [randomUUID(), scope.tenantId, scope.namespaceId, type, Number(revisions[0]!.authorization), new Date().toISOString()]);
}
