import { randomUUID } from 'node:crypto';
import { open, readFile, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { digest, seal, unseal } from './auth-crypto.js';
import { MetadataError, type Database, type SqlConnection, type SqlRow } from './metadata-db.js';
import { secretKey } from './hosted-config.js';
import { identifier } from './metadata-resources.js';
import { appendAudit } from './hosted-events.js';
import { assertReferenceSchema, referenceSchemaVersion } from './reference-schema.js';

// Dependency order is explicit. Snapshot content can never choose a SQL table.
export const recoveryTables = [
  'h1_tenants', 'h1_namespaces', 'h1_revisions', 'h1_resources', 'h1_links', 'h1_operations', 'h1_outbox', 'h1_migrations',
  'h2_control', 'h2_identities', 'h2_memberships', 'h2_invitations', 'h2_keys', 'h2_sessions', 'h2_attempts', 'h2_onboarding', 'h2_requests',
  'h4_budget_config', 'h5_embedding_config', 'h6_keys', 'h6_sessions', 'h7_jobs', 'h7_occurrences', 'h7_deliveries', 'h7_migrations',
  'h8_encryption', 'h8_audit', 'h8_hooks', 'h8_restore_holds',
] as const;
type Table = typeof recoveryTables[number];
export interface RecoverySnapshot {
  schemaRevision: number; backupId: string; createdAt: string; encryptionFingerprint: string;
  artifacts: 'encrypted-inline-uploads'; tables: Record<Table, SqlRow[]>;
}
const fail = (code = 'BACKUP_INVALID'): never => { throw new MetadataError(code, 503); };
const frozen = (maintenance?: string) => { if (maintenance !== 'frozen') fail('REFERENCE_MAINTENANCE_REQUIRED'); };
export async function captureBackup(db: Database, encryptionKey: string, maintenance?: string, maxBytes = 256 * 1024 * 1024): Promise<RecoverySnapshot> {
  frozen(maintenance); await assertReferenceSchema(db);
  const fingerprint = digest(secretKey(encryptionKey));
  return db.transaction(async c => {
    const current = (await c.query('SELECT fingerprint FROM h8_encryption WHERE id = 1'))[0];
    if (current?.fingerprint !== fingerprint) fail('ENCRYPTION_KEY_VERSION_MISMATCH');
    const tables = {} as Record<Table, SqlRow[]>; let bytes = 0;
    for (const table of recoveryTables) {
      const rows = await c.query(`SELECT * FROM ${table} LIMIT 100001`);
      if (rows.length > 100000) fail('BACKUP_LIMIT_EXCEEDED');
      bytes += Buffer.byteLength(JSON.stringify(rows)); if (bytes > maxBytes) fail('BACKUP_LIMIT_EXCEEDED');
      tables[table] = rows.map(row => ({ ...row }));
    }
    await appendAudit(c, { operation: 'backup', outcome: 'succeeded', resourceRevision: referenceSchemaVersion });
    return { schemaRevision: referenceSchemaVersion, backupId: randomUUID(), createdAt: new Date().toISOString(), encryptionFingerprint: fingerprint,
      artifacts: 'encrypted-inline-uploads', tables };
  });
}
export function validateBackup(value: unknown): RecoverySnapshot {
  if (!value || typeof value !== 'object') fail();
  const v = value as Partial<RecoverySnapshot>;
  if (v.schemaRevision !== referenceSchemaVersion || typeof v.backupId !== 'string' || typeof v.createdAt !== 'string'
    || !Number.isFinite(Date.parse(v.createdAt)) || !/^[a-f0-9]{64}$/.test(v.encryptionFingerprint ?? '') || v.artifacts !== 'encrypted-inline-uploads'
    || !v.tables || Object.keys(v.tables).sort().join() !== [...recoveryTables].sort().join()) fail();
  identifier(v.backupId);
  for (const table of recoveryTables) {
    const rows = v.tables![table];
    if (!Array.isArray(rows) || rows.length > 100000) fail();
    for (const row of rows) if (!row || typeof row !== 'object' || Array.isArray(row) || !Object.keys(row).length
      || Object.entries(row).some(([key, value]) => !/^[a-z][a-z0-9_]*$/.test(key) || value !== null && typeof value !== 'string' && (typeof value !== 'number' || !Number.isFinite(value)))) fail();
  }
  return v as RecoverySnapshot;
}
export async function writeBackup(path: string, snapshot: RecoverySnapshot, backupKey: string): Promise<void> {
  validateBackup(snapshot);
  const file = await open(path, 'wx', 0o600);
  try { await file.writeFile(seal(JSON.stringify(snapshot), secretKey(backupKey), 'opensight-backup:v1')); await file.sync(); }
  finally { await file.close(); }
  const directory = await open(dirname(path), 'r'); try { await directory.sync(); } finally { await directory.close(); }
}
export async function readBackup(path: string, backupKey: string, maxBytes = 384 * 1024 * 1024): Promise<RecoverySnapshot> {
  if ((await stat(path)).size > maxBytes) fail('BACKUP_LIMIT_EXCEEDED');
  try { return validateBackup(JSON.parse(unseal(await readFile(path, 'utf8'), secretKey(backupKey), 'opensight-backup:v1'))); }
  catch { return fail(); }
}
async function insert(c: SqlConnection, table: Table, row: SqlRow, ignore = false): Promise<void> {
  const columns = Object.keys(row);
  await c.query(`INSERT INTO ${table} (${columns.map(k => `"${k}"`).join(',')}) VALUES (${columns.map(() => '?').join(',')})${ignore ? ' ON CONFLICT DO NOTHING' : ''}`, columns.map(k => row[k]!));
}
const belongs = (row: SqlRow, tenantId: string) => row.tenant_id === tenantId;
const retained = new Set<Table>(['h8_audit', 'h8_hooks']);
const scopedTables = new Set<Table>(['h1_namespaces', 'h1_revisions', 'h1_resources', 'h1_links', 'h1_operations', 'h1_outbox', 'h2_memberships', 'h2_invitations', 'h2_sessions', 'h2_onboarding', 'h5_embedding_config', 'h6_sessions', 'h7_jobs', 'h7_occurrences', 'h7_deliveries', 'h7_migrations', 'h8_restore_holds']);
/** Restores always revoke sessions, disable historical invitation tokens and put
 * live tenants on a durable hold. A lost revocation ledger cannot become access. */
export async function restoreBackup(db: Database, raw: unknown, encryptionKey: string, maintenance?: string, tenantId?: string): Promise<void> {
  frozen(maintenance); const snapshot = validateBackup(raw); await assertReferenceSchema(db);
  if (snapshot.encryptionFingerprint !== digest(secretKey(encryptionKey))) fail('ENCRYPTION_KEY_VERSION_MISMATCH');
  if (tenantId) identifier(tenantId);
  await db.transaction(async c => {
    const currentEncryption = (await c.query('SELECT fingerprint FROM h8_encryption WHERE id = 1'))[0];
    if (currentEncryption && currentEncryption.fingerprint !== snapshot.encryptionFingerprint) fail('ENCRYPTION_KEY_VERSION_MISMATCH');
    const existingTenants = await c.query('SELECT * FROM h1_tenants');
    if (!tenantId && existingTenants.length) fail('RESTORE_EMPTY_TARGET_REQUIRED');
    const selected = snapshot.tables.h1_tenants.filter(r => !tenantId || belongs(r, tenantId));
    if (tenantId && selected.length !== 1) fail('RESTORE_TENANT_NOT_FOUND');
    if (!tenantId) {
      for (const table of [...recoveryTables].reverse()) await c.query(`DELETE FROM ${table}`);
      for (const table of recoveryTables) for (const row of snapshot.tables[table]) await insert(c, table, row);
    } else {
      const current = existingTenants.find(r => belongs(r, tenantId));
      // Never reintroduce even encrypted payloads for a newer deletion.
      if (current && ['deleted', 'deleting'].includes(String(current.state))) {
        await appendAudit(c, { operation: 'restore', tenantId, outcome: 'denied', errorCode: 'RESTORE_TOMBSTONE_RETAINED' }); return;
      }
      const oldRevisions = (await c.query('SELECT * FROM h1_revisions WHERE tenant_id = ?', [tenantId]))[0];
      const currentMembers = await c.query('SELECT * FROM h2_memberships WHERE tenant_id = ?', [tenantId]);
      const namespace = (await c.query('SELECT namespace_id FROM h1_namespaces WHERE tenant_id = ?', [tenantId]))[0];
      if (namespace && snapshot.tables.h1_namespaces.find(r => belongs(r, tenantId))?.namespace_id !== namespace.namespace_id) fail('RESTORE_NAMESPACE_MISMATCH');
      for (const table of [...recoveryTables].reverse()) if (scopedTables.has(table)) await c.query(`DELETE FROM ${table} WHERE tenant_id = ?`, [tenantId]);
      if (current) await c.query('DELETE FROM h1_tenants WHERE tenant_id = ?', [tenantId]);
      const tenant = { ...selected[0]!, version: Math.max(Number(selected[0]!.version), Number(current?.version ?? 0)) + 1 };
      await insert(c, 'h1_tenants', tenant);
      const subjects = new Set(snapshot.tables.h2_memberships.filter(r => belongs(r, tenantId)).map(r => r.subject));
      for (const identity of snapshot.tables.h2_identities) if (subjects.has(identity.subject)) await insert(c, 'h2_identities', identity, true);
      for (const table of recoveryTables) {
        if (!scopedTables.has(table) && !retained.has(table)) continue;
        if (['h8_restore_holds', 'h2_sessions', 'h6_sessions'].includes(table)) continue;
        for (const saved of snapshot.tables[table].filter(r => belongs(r, tenantId))) {
          const row = { ...saved };
          if (table === 'h1_revisions' && oldRevisions) for (const key of ['authorization', 'policy', 'configuration']) row[key] = Math.max(Number(row[key]), Number(oldRevisions[key])) + 1;
          if (table === 'h2_memberships') {
            const newer = currentMembers.find(r => r.subject === row.subject);
            // A removed member remains removed even if the backup predates removal.
            if (newer?.status === 'removed') row.status = 'removed';
            row.version = Math.max(Number(row.version), Number(newer?.version ?? 0)) + 1;
          }
          await insert(c, table, row, retained.has(table));
        }
      }
      for (const newer of currentMembers) if (newer.status === 'removed' && !snapshot.tables.h2_memberships.some(r => belongs(r, tenantId) && r.subject === newer.subject)) await insert(c, 'h2_memberships', newer);
    }
    for (const row of selected) {
      const id = String(row.tenant_id);
      await c.query("UPDATE h1_tenants SET state = CASE WHEN state IN ('deleted','deleting') THEN state ELSE 'suspended' END, version = version + 1 WHERE tenant_id = ?", [id]);
      await c.query('UPDATE h1_revisions SET "authorization" = "authorization" + 1, policy = policy + 1, configuration = configuration + 1 WHERE tenant_id = ?', [id]);
      await c.query('UPDATE h2_sessions SET revoked = 1 WHERE tenant_id = ?', [id]);
      await c.query('UPDATE h6_sessions SET revoked = 1 WHERE tenant_id = ?', [id]);
      await c.query('UPDATE h2_invitations SET accepted = 1 WHERE tenant_id = ?', [id]);
      await c.query("UPDATE h7_occurrences SET state = 'cancelled', error_code = 'RESTORE_RECONCILIATION_REQUIRED' WHERE tenant_id = ? AND state IN ('queued','running','delivering')", [id]);
      await c.query("UPDATE h7_deliveries SET state = 'cancelled', message = NULL, error_code = 'RESTORE_RECONCILIATION_REQUIRED' WHERE tenant_id = ? AND state IN ('pending','sending')", [id]);
      await c.query('INSERT INTO h8_restore_holds VALUES (?,?,?) ON CONFLICT (tenant_id) DO UPDATE SET restored_at = excluded.restored_at, backup_id = excluded.backup_id', [id, new Date().toISOString(), snapshot.backupId]);
      await appendAudit(c, { operation: 'restore', tenantId: id, outcome: 'succeeded', resourceRevision: referenceSchemaVersion });
    }
  });
}
/** Operator supplies the reviewed current revocations, not a claim from a tenant.
 * Resume remains a separate existing lifecycle operation after reconciliation. */
export async function reconcileRestore(db: Database, tenantId: string, expectedVersion: number, removedUsers: string[], maintenance?: string): Promise<void> {
  frozen(maintenance); identifier(tenantId); removedUsers.forEach(identifier);
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) fail('RESTORE_RECONCILIATION_INVALID');
  await db.transaction(async c => {
    const row = (await c.query("UPDATE h1_tenants SET version = version WHERE tenant_id = ? AND state = 'suspended' AND version = ? RETURNING tenant_id", [tenantId, expectedVersion]))[0];
    if (!row || !(await c.query('SELECT tenant_id FROM h8_restore_holds WHERE tenant_id = ?', [tenantId])).length) fail('RESTORE_RECONCILIATION_INVALID');
    for (const user of removedUsers) if (!(await c.query("UPDATE h2_memberships SET status = 'removed', version = version + 1 WHERE tenant_id = ? AND user_id = ? RETURNING user_id", [tenantId, user])).length) fail('RESTORE_RECONCILIATION_INVALID');
    await c.query('UPDATE h2_sessions SET revoked = 1 WHERE tenant_id = ?', [tenantId]);
    await c.query('UPDATE h6_sessions SET revoked = 1 WHERE tenant_id = ?', [tenantId]);
    await c.query('UPDATE h1_revisions SET "authorization" = "authorization" + 1 WHERE tenant_id = ?', [tenantId]);
    await c.query('DELETE FROM h8_restore_holds WHERE tenant_id = ?', [tenantId]);
    await appendAudit(c, { operation: 'restore', tenantId, outcome: 'succeeded', resourceRevision: expectedVersion });
  });
}
