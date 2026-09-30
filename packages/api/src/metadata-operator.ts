import { createHash, randomUUID } from 'node:crypto';
import { MetadataError, missing, type Database, type SqlConnection, type SqlRow } from './metadata-db.js';
import { identifier, insertResource } from './metadata-resources.js';
import { appendMetadataEvent } from './metadata-outbox.js';

/** Canonical serialization makes idempotency independent of object property order. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  const text = JSON.stringify(value); if (text === undefined) throw new MetadataError('METADATA_INVALID', 400); return text;
}
export const checksum = (value: unknown): string => createHash('sha256').update(canonical(value)).digest('hex');
export interface ProvisionRequest { namespaceId: string; name: string; administrator: { id: string; name: string } }
export interface TenantOperation {
  operationId: string; tenantId: string; namespaceId: string;
  action: 'provision' | 'suspend' | 'resume' | 'delete'; status: 'pending' | 'complete'; step: string;
}
function operation(row: SqlRow): TenantOperation {
  return { operationId: String(row.operation_id), tenantId: String(row.tenant_id), namespaceId: String(row.namespace_id), action: row.action as TenantOperation['action'], status: row.status as TenantOperation['status'], step: String(row.step) };
}
async function existing(c: SqlConnection, id: string, hash: string): Promise<TenantOperation | undefined> {
  const rows = await c.query('SELECT * FROM h1_operations WHERE operation_id = ?', [identifier(id)]);
  if (!rows[0]) return undefined;
  if (rows[0].request_hash !== hash) throw new MetadataError('OPERATION_ID_REUSED');
  return operation(rows[0]);
}
async function read(c: SqlConnection, id: string): Promise<TenantOperation> {
  const rows = await c.query('SELECT * FROM h1_operations WHERE operation_id = ?', [identifier(id)]);
  return rows[0] ? operation(rows[0]) : missing();
}

/** Trusted operator-plane records only. Never hand this object or its DB credentials to tenant routes. */
export class MetadataOperator {
  constructor(private readonly database: Database) {}
  async tenant(tenantId: string): Promise<{ tenantId: string; namespaceId: string; state: string; version: number; tombstone: string | null }> {
    return this.database.transaction(async c => {
      const rows = await c.query('SELECT t.*, n.namespace_id FROM h1_tenants t JOIN h1_namespaces n ON n.tenant_id = t.tenant_id WHERE t.tenant_id = ?', [identifier(tenantId)]);
      const t = rows[0]; if (!t) missing();
      return { tenantId, namespaceId: String(t.namespace_id), state: String(t.state), version: Number(t.version), tombstone: t.tombstone === null ? null : String(t.tombstone) };
    });
  }
  async inspect(operationId: string): Promise<TenantOperation> { return this.database.transaction(c => read(c, operationId)); }
  async provision(operationId: string, request: ProvisionRequest): Promise<TenantOperation> {
    const input = structuredClone(request), hash = checksum({ action: 'provision', input });
    identifier(operationId); identifier(input.namespaceId); identifier(input.administrator.id);
    if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 512) throw new MetadataError('METADATA_INVALID', 400);
    return this.database.transaction(async c => {
      const prior = await existing(c, operationId, hash); if (prior) return prior;
      const tenantId = randomUUID();
      await c.query("INSERT INTO h1_tenants VALUES (?, 'provisioning', 1, NULL, NULL, NULL)", [tenantId]);
      await c.query('INSERT INTO h1_namespaces VALUES (?,?,?)', [input.namespaceId, tenantId, input.name]);
      await c.query('INSERT INTO h1_revisions VALUES (?,?,1,1,1)', [tenantId, input.namespaceId]);
      await insertResource(c, { tenantId, namespaceId: input.namespaceId }, { kind: 'user', id: input.administrator.id }, { name: input.administrator.name, role: 'administrator' });
      await c.query("INSERT INTO h1_operations VALUES (?,?,?,'provision',?,'pending','created')", [operationId, tenantId, input.namespaceId, hash]);
      await appendMetadataEvent(c, { tenantId, namespaceId: input.namespaceId }, 'tenant.provisioning');
      return read(c, operationId);
    });
  }
  async checkpoint(operationId: string, expectedStep: string, nextStep: string): Promise<TenantOperation> {
    return this.database.transaction(async c => {
      const op = await read(c, operationId);
      if (op.step === nextStep) return op;
      const allowed = op.action === 'provision' ? [['created', 'configured'], ['configured', 'verified']] : op.action === 'delete' ? [['revoked', 'artifacts-removed']] : [];
      if (op.status !== 'pending' || !allowed.some(([from, to]) => from === expectedStep && to === nextStep)) throw new MetadataError('OPERATION_TRANSITION_INVALID');
      const rows = await c.query('UPDATE h1_operations SET step = ? WHERE operation_id = ? AND step = ? RETURNING operation_id', [nextStep, operationId, expectedStep]);
      if (!rows.length) throw new MetadataError('METADATA_CONFLICT');
      await appendMetadataEvent(c, op, 'operation.checkpoint');
      return read(c, operationId);
    });
  }
  async activate(operationId: string): Promise<TenantOperation> {
    return this.database.transaction(async c => {
      const op = await read(c, operationId);
      if (op.action !== 'provision') throw new MetadataError('OPERATION_TRANSITION_INVALID');
      if (op.status === 'complete') return op;
      if (op.step !== 'verified') throw new MetadataError('OPERATION_TRANSITION_INVALID');
      const users = await c.query("SELECT body FROM h1_resources WHERE tenant_id = ? AND namespace_id = ? AND kind = 'user'", [op.tenantId, op.namespaceId]);
      if (!users.some(u => (JSON.parse(String(u.body)) as { role?: string }).role === 'administrator')) throw new MetadataError('TENANT_ADMINISTRATOR_REQUIRED');
      const changed = await c.query("UPDATE h1_tenants SET state = 'active', version = version + 1 WHERE tenant_id = ? AND state = 'provisioning' RETURNING version", [op.tenantId]);
      if (!changed.length) throw new MetadataError('OPERATION_TRANSITION_INVALID');
      await c.query("UPDATE h1_operations SET status = 'complete', step = 'active' WHERE operation_id = ?", [operationId]);
      await appendMetadataEvent(c, op, 'tenant.active');
      return read(c, operationId);
    });
  }
  async transition(operationId: string, tenantId: string, action: 'suspend' | 'resume' | 'delete', expectedVersion: number): Promise<TenantOperation> {
    identifier(operationId); identifier(tenantId);
    if (!['suspend', 'resume', 'delete'].includes(action) || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1) throw new MetadataError('METADATA_INVALID', 400);
    const hash = checksum({ tenantId, action, expectedVersion });
    return this.database.transaction(async c => {
      const prior = await existing(c, operationId, hash); if (prior) return prior;
      const rows = await c.query('SELECT t.*, n.namespace_id FROM h1_tenants t JOIN h1_namespaces n ON n.tenant_id = t.tenant_id WHERE t.tenant_id = ?', [tenantId]);
      const tenant = rows[0]; if (!tenant) missing();
      const target = action === 'suspend' ? 'suspended' : action === 'resume' ? 'active' : 'deleting';
      if (tenant.state === 'deleted' || action === 'resume' && tenant.state !== 'suspended' || action === 'suspend' && tenant.state !== 'active' || action === 'delete' && !['active', 'suspended', 'provisioning'].includes(String(tenant.state))) throw new MetadataError('OPERATION_TRANSITION_INVALID');
      const changed = await c.query('UPDATE h1_tenants SET state = ?, version = version + 1 WHERE tenant_id = ? AND version = ? RETURNING version', [target, tenantId, expectedVersion]);
      if (!changed.length) throw new MetadataError('METADATA_CONFLICT');
      const namespaceId = String(tenant.namespace_id);
      await c.query('UPDATE h1_revisions SET "authorization" = "authorization" + 1 WHERE tenant_id = ? AND namespace_id = ?', [tenantId, namespaceId]);
      await c.query('INSERT INTO h1_operations VALUES (?,?,?,?,?,?,?)', [operationId, tenantId, namespaceId, action, hash, action === 'delete' ? 'pending' : 'complete', action === 'delete' ? 'revoked' : target]);
      await appendMetadataEvent(c, { tenantId, namespaceId }, `tenant.${target}`);
      return read(c, operationId);
    });
  }
  async finishDeletion(operationId: string): Promise<TenantOperation> {
    return this.database.transaction(async c => {
      const op = await read(c, operationId);
      if (op.action !== 'delete') throw new MetadataError('OPERATION_TRANSITION_INVALID');
      if (op.status === 'complete') return op;
      if (op.step !== 'artifacts-removed') throw new MetadataError('OPERATION_TRANSITION_INVALID');
      const rows = await c.query("UPDATE h1_tenants SET state = 'deleted', tombstone = ?, version = version + 1 WHERE tenant_id = ? AND state = 'deleting' RETURNING version", [new Date().toISOString(), op.tenantId]);
      if (!rows.length) throw new MetadataError('OPERATION_TRANSITION_INVALID');
      await c.query('DELETE FROM h1_links WHERE tenant_id = ? AND namespace_id = ?', [op.tenantId, op.namespaceId]);
      await c.query('DELETE FROM h1_resources WHERE tenant_id = ? AND namespace_id = ?', [op.tenantId, op.namespaceId]);
      await c.query("UPDATE h1_operations SET status = 'complete', step = 'deleted' WHERE operation_id = ?", [operationId]);
      await appendMetadataEvent(c, op, 'tenant.deleted');
      return read(c, operationId);
    });
  }
}
