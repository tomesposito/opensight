import { mkdir, lstat, realpath, open, readFile, rename, readdir, unlink } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { MetadataError, type Database, type SqlRow } from './metadata-db.js';
import { seal, unseal, digest } from './auth-crypto.js';
import { identifier } from './metadata-resources.js';
import { MetadataOperator } from './metadata-operator.js';
import { appendOperatorAudit } from './operator-audit.js';
import { tenantDeletionInventory, assertReferenceErasureStores, purgeTenantRows, verifyTenantRows, assertNoTenantOrphans, type ErasureCount, type TenantErasureCache, type TenantDeletionOptions, type TenantDeletionReport } from './tenant-erasure.js';

// Foreign-key order; only application tables, never database roles or environment.
export const referenceTables = ['h1_tenants', 'h1_namespaces', 'h1_revisions', 'h1_resources', 'h1_links', 'h1_operations', 'h1_outbox', 'h1_migrations',
  'h2_control', 'h2_identities', 'h2_memberships', 'h2_invitations', 'h2_keys', 'h2_sessions', 'h2_attempts', 'h2_onboarding', 'h2_requests',
  'h4_budget_config', 'h5_embedding_config', 'h6_keys', 'h6_sessions', 'h7_jobs', 'h7_occurrences', 'h7_deliveries', 'h7_migrations',
  'h8_schema', 'h8_usage', 'h8_monthly_usage', 'h8_usage_events', 'h8_audit', 'h8_recovery', 'analytics_events', 'analytics_settings'] as const;
interface Registry { version: 1; backups: Record<string, string>; deleted: string[] }
interface Snapshot { version: 1; tables: Record<string, SqlRow[]> }
const maxBytes = 64 * 1024 * 1024;
const failure = (code: string): never => { throw new MetadataError(code, 503); };
async function syncDirectory(path: string): Promise<void> { const handle = await open(path, 'r'); try { await handle.sync(); } finally { await handle.close(); } }
async function privateWrite(path: string, value: string): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`, handle = await open(temporary, 'wx', 0o600);
  try { await handle.writeFile(value); await handle.sync(); } finally { await handle.close(); }
  await rename(temporary, path);
}
/** Called under the reference's exclusive lifetime/maintenance lock, with every
 * API/scheduler writer stopped. Registry is independent of database backups. */
export class ReferenceMaintenance {
  private constructor(readonly db: Database, readonly directory: string, private readonly key: Buffer, private readonly caches: readonly TenantErasureCache[]) {}
  static async open(db: Database, path: string, key: Buffer, maintenance: string | undefined, caches: readonly TenantErasureCache[] = []): Promise<ReferenceMaintenance> {
    if (maintenance !== 'frozen') failure('REFERENCE_MAINTENANCE_REQUIRED');
    // Private runtime storage must not accidentally become a public repository export.
    const absolute = resolve(path), repo = resolve(new URL('../../..', import.meta.url).pathname);
    if (absolute === repo || absolute.startsWith(`${repo}${sep}`) && !absolute.startsWith(`${repo}${sep}.opensight${sep}`)) failure('BACKUP_DIRECTORY_INVALID');
    // Opening maintenance (including a dry run) must not create directories.
    let existing = absolute;
    for (;;) {
      try {
        if (!(await lstat(existing)).isDirectory() || await realpath(existing) !== existing) failure('BACKUP_DIRECTORY_INVALID');
        break;
      } catch (error) {
        if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'ENOENT') throw error;
        existing = dirname(existing);
      }
    }
    return new ReferenceMaintenance(db, absolute, key, [...caches]);
  }
  private async registry(allowMissing = false): Promise<Registry> {
    const path = join(this.directory, 'registry');
    try {
      if (!(await lstat(path)).isFile()) failure('BACKUP_REGISTRY_INVALID');
      const r = JSON.parse(unseal(await readFile(path, 'utf8'), this.key, 'h8-registry')) as Registry;
      if (r.version !== 1 || !r.backups || !Array.isArray(r.deleted)) failure('BACKUP_REGISTRY_INVALID');
      for (const id of Object.keys(r.backups)) identifier(id);
      return r;
    } catch (error) {
      if (allowMissing && error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT' && (await this.backupFiles()).length === 0) {
        return { version: 1, backups: {}, deleted: [] };
      }
      return failure('BACKUP_REGISTRY_INVALID');
    }
  }
  private async backupFiles(): Promise<string[]> {
    try { return (await readdir(this.directory)).filter(file => file !== 'registry').sort(); }
    catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return [];
      throw error;
    }
  }
  private async saveRegistry(registry: Registry): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await privateWrite(join(this.directory, 'registry'), seal(JSON.stringify(registry), this.key, 'h8-registry')); await syncDirectory(this.directory);
  }
  async backup(): Promise<{ id: string; bytes: number; rows: number }> {
    const registry = await this.registry(true), id = randomUUID();
    await this.saveRegistry(registry);
    const snapshot: Snapshot = { version: 1, tables: {} }; let rows = 0, bytes = 0;
    await this.db.transaction(async c => {
      for (const table of referenceTables) {
        const records = await c.query(`SELECT * FROM ${table} LIMIT 100001`);
        rows += records.length; bytes += Buffer.byteLength(JSON.stringify(records));
        if (rows > 100000 || bytes > maxBytes) failure('BACKUP_LIMIT_EXCEEDED');
        snapshot.tables[table] = records;
      }
    });
    const data = seal(JSON.stringify(snapshot), this.key, `h8-backup:${id}`);
    await privateWrite(join(this.directory, `${id}.backup`), data); await syncDirectory(this.directory);
    registry.backups[id] = digest(data); await this.saveRegistry(registry);
    await this.db.transaction(c => appendOperatorAudit(c, { action: 'backup.created', detail: { backupId: id, rows } }));
    return { id, bytes: Buffer.byteLength(data), rows };
  }
  async restore(id: string): Promise<void> {
    identifier(id); const registry = await this.registry();
    if (!Object.hasOwn(registry.backups, id)) failure('BACKUP_UNREGISTERED');
    const path = join(this.directory, `${id}.backup`), stat = await lstat(path);
    if (!stat.isFile() || stat.size > maxBytes * 2) failure('BACKUP_INVALID');
    const data = await readFile(path, 'utf8'); if (digest(data) !== registry.backups[id]) failure('BACKUP_INVALID');
    let snapshot: Snapshot;
    try { snapshot = JSON.parse(unseal(data, this.key, `h8-backup:${id}`)) as Snapshot; }
    catch { return failure('BACKUP_INVALID'); }
    const sourceTables = Object.keys(snapshot.tables).sort();
    const compatibleTables = [referenceTables, referenceTables.filter(t => t !== 'h8_monthly_usage')]
      .flatMap(tables => [tables, tables.filter(t => !t.startsWith('analytics_'))]);
    if (snapshot.version !== 1 || !compatibleTables.some(tables => JSON.stringify(sourceTables) === JSON.stringify([...tables].sort()))) failure('BACKUP_INVALID');
    if (snapshot.tables.h1_tenants!.some(t => registry.deleted.includes(String(t.tenant_id)) && t.state !== 'deleted')) failure('BACKUP_DELETED_TENANT');
    await this.db.transaction(async c => {
      if ((await c.query('SELECT tenant_id FROM h1_tenants')).length) failure('RESTORE_TARGET_NOT_EMPTY');
      for (const table of [...referenceTables].reverse()) await c.query(`DELETE FROM ${table}`);
      for (const table of referenceTables) for (const row of (snapshot.tables[table] ?? [])) {
        const keys = Object.keys(row); if (keys.some(k => !/^[a-z_]+$/.test(k))) failure('BACKUP_INVALID');
        await c.query(`INSERT INTO ${table} (${keys.map(k => `"${k}"`).join(',')}) VALUES (${keys.map(() => '?').join(',')})`, Object.values(row));
      }
      // Never reissue old authority or notifications. Every surviving membership
      // requires explicit offline operator review, including formerly active ones.
      await c.query("UPDATE h1_tenants SET state = 'suspended', version = version + 1 WHERE state IN ('active','provisioning')");
      await c.query('UPDATE h1_revisions SET "authorization" = "authorization" + 1, policy = policy + 1, configuration = configuration + 1');
      await c.query("UPDATE h2_memberships SET status = 'removed', version = version + 1");
      await c.query('UPDATE h2_sessions SET revoked = 1'); await c.query('UPDATE h6_sessions SET revoked = 1');
      await c.query('DELETE FROM h2_onboarding'); await c.query('DELETE FROM h2_invitations');
      await c.query('UPDATE h7_jobs SET stopped = 1, next_run = NULL, version = version + 1');
      await c.query("UPDATE h7_occurrences SET state = 'cancelled', error_code = 'RESTORE_REVIEW_REQUIRED' WHERE state IN ('queued','running','delivering')");
      await c.query("UPDATE h7_deliveries SET state = 'cancelled', message = NULL, error_code = 'RESTORE_REVIEW_REQUIRED' WHERE state IN ('pending','sending')");
      const period = new Date().toISOString().slice(0, 10);
      for (const ns of await c.query("SELECT n.* FROM h1_namespaces n JOIN h1_tenants t ON t.tenant_id = n.tenant_id WHERE t.state = 'suspended'")) {
        await c.query('INSERT INTO h8_recovery VALUES (?) ON CONFLICT (tenant_id) DO NOTHING', [ns.tenant_id!]);
        for (const metric of ['apiCalls', 'computeAttempts']) await c.query(`INSERT INTO h8_usage VALUES (?,?,?,?,9007199254740991,0)
          ON CONFLICT (tenant_id,namespace_id,period,metric) DO UPDATE SET admitted = 9007199254740991`, [ns.tenant_id!, ns.namespace_id!, period, metric]);
      }
      await appendOperatorAudit(c, { action: 'backup.restored-held', detail: { backupId: id } });
    });
  }
  async review(tenantId: string, userIds: readonly string[]): Promise<void> {
    identifier(tenantId); userIds.forEach(identifier);
    if (!userIds.length || new Set(userIds).size !== userIds.length) failure('RESTORE_REVIEW_INVALID');
    await this.db.transaction(async c => {
      if (!(await c.query('SELECT tenant_id FROM h8_recovery WHERE tenant_id = ?', [tenantId])).length) failure('RESTORE_REVIEW_INVALID');
      let admin = false;
      for (const user of userIds) {
        const rows = await c.query(`SELECT u.body FROM h2_memberships m JOIN h2_identities i ON i.subject = m.subject
          JOIN h1_resources u ON u.tenant_id = m.tenant_id AND u.kind = 'user' AND u.resource_id = m.user_id
          WHERE m.tenant_id = ? AND m.user_id = ? AND i.status = 'active'`, [tenantId, user]);
        if (rows.length !== 1) failure('RESTORE_REVIEW_INVALID');
        if ((JSON.parse(String(rows[0]!.body)) as { role: string }).role === 'administrator') admin = true;
        await c.query("UPDATE h2_memberships SET status = 'active', version = version + 1 WHERE tenant_id = ? AND user_id = ?", [tenantId, user]);
      }
      if (!admin) failure('TENANT_ADMINISTRATOR_REQUIRED');
      await c.query('DELETE FROM h8_recovery WHERE tenant_id = ?', [tenantId]);
      await appendOperatorAudit(c, { action: 'restore.memberships-reviewed', tenantId, detail: { users: userIds.length } });
    });
  }
  async deleteTenant(operationId: string, externalCopies?: string, options: TenantDeletionOptions = {}): Promise<TenantDeletionReport> {
    if (options.dryRun !== undefined && typeof options.dryRun !== 'boolean') failure('TENANT_ERASURE_MODE_INVALID');
    const operator = new MetadataOperator(this.db), op = await operator.inspect(identifier(operationId));
    if (op.action !== 'delete' || !['revoked', 'artifacts-removed', 'deleted', 'erasure-verified'].includes(op.step)) failure('OPERATION_TRANSITION_INVALID');
    const dryRun = options.dryRun !== false;
    if (!dryRun && options.confirmTenantId !== op.tenantId) failure('TENANT_ERASURE_CONFIRMATION_REQUIRED');
    if (!dryRun && externalCopies !== 'none') failure('BACKUP_COPIES_UNRESOLVED');
    await assertReferenceErasureStores(this.db);
    const registry = await this.registry(true);
    const report: TenantDeletionReport = { tenantId: op.tenantId, operationId, dryRun, status: 'planned',
      counts: await this.db.transaction(c => tenantDeletionInventory(c, op.tenantId)) };
    const files = await this.backupFiles();
    for (const file of files) if (!(await lstat(join(this.directory, file))).isFile()) failure('BACKUP_PURGE_FAILED');
    report.counts.push({ store: 'backups.files', action: 'delete', count: files.length },
      { store: 'backups.registrations', action: 'delete', count: Object.keys(registry.backups).length },
      { store: 'backups.deleted-tenants', action: 'fence', count: registry.deleted.includes(op.tenantId) ? 0 : 1 });
    const cached = this.caches.map(cache => cache.countTenant(op.tenantId));
    if (cached.some(count => !Number.isSafeInteger(count) || count < 0)) failure('TENANT_ERASURE_INVENTORY_INVALID');
    report.counts.push({ store: 'blaze.memory', action: 'delete', count: cached.reduce((a, b) => a + b, 0) });
    if (dryRun) return report;
    const workRemains = report.counts.some(entry => entry.action !== 'retain' && entry.count > 0);
    if (op.step === 'erasure-verified' && !workRemains) {
      await this.verifyExternalErasure(op.tenantId);
      await this.db.transaction(c => verifyTenantRows(c, op.tenantId));
      return { ...report, status: 'noop' };
    }
    // Fence old snapshots before removing bytes. Do not rewrite an unchanged
    // registry on retries; a crash cannot make old snapshots restorable again.
    if (!registry.deleted.includes(op.tenantId) || Object.keys(registry.backups).length) {
      if (!registry.deleted.includes(op.tenantId)) registry.deleted.push(op.tenantId);
      registry.backups = {}; await this.saveRegistry(registry);
    }
    for (const file of files) await unlink(join(this.directory, file));
    if (files.length) await syncDirectory(this.directory);
    for (const cache of this.caches) cache.purgeTenant(op.tenantId);
    await this.verifyExternalErasure(op.tenantId);
    await this.db.transaction(async c => {
      const subjects = await purgeTenantRows(c, op.tenantId);
      await verifyTenantRows(c, op.tenantId, subjects);
      // Metadata finalization and its audit receipt share the purge transaction.
      const atomic = new MetadataOperator({ transaction: work => work(c), close: async () => {} });
      if (op.step === 'revoked') await atomic.checkpoint(operationId, 'revoked', 'artifacts-removed');
      await atomic.finishDeletion(operationId);
      await verifyTenantRows(c, op.tenantId, subjects);
      if (op.step !== 'erasure-verified') {
        // Older finalizers may already have appended the receipt. Preserve it.
        if (!(await c.query("SELECT event_id FROM h8_audit WHERE tenant_id = ? AND action = 'tenant.deletion-completed'", [op.tenantId])).length) {
          await appendOperatorAudit(c, { action: 'tenant.deletion-completed', tenantId: op.tenantId });
        }
        // Durable idempotency marker, independent of the audit retention window.
        await c.query("UPDATE h1_operations SET step = 'erasure-verified' WHERE operation_id = ?", [operationId]);
      }
    });
    return { ...report, status: 'deleted' };
  }
  private async verifyExternalErasure(tenantId: string): Promise<void> {
    const registry = await this.registry(), remaining: ErasureCount[] = [];
    const files = (await this.backupFiles()).length, registrations = Object.keys(registry.backups).length;
    if (files) remaining.push({ store: 'backups.files', action: 'delete', count: files });
    if (registrations) remaining.push({ store: 'backups.registrations', action: 'delete', count: registrations });
    if (!registry.deleted.includes(tenantId)) remaining.push({ store: 'backups.deleted-tenants', action: 'fence', count: 1 });
    const counts = this.caches.map(cache => cache.countTenant(tenantId));
    if (counts.some(count => !Number.isSafeInteger(count) || count < 0)) failure('TENANT_ERASURE_INVENTORY_INVALID');
    const cached = counts.reduce((a, b) => a + b, 0);
    if (cached) remaining.push({ store: 'blaze.memory', action: 'delete', count: cached });
    assertNoTenantOrphans(remaining);
  }

  async retain(auditDays: number, usageDays: number, now = Date.now()): Promise<void> {
    if (!Number.isSafeInteger(auditDays) || auditDays < 0 || !Number.isSafeInteger(usageDays) || usageDays < 1) failure('REFERENCE_CONFIG_INVALID');
    await this.db.transaction(async c => {
      const usageBefore = new Date(now - usageDays * 86400000).toISOString();
      // Monthly billing snapshots outlive daily retention; erase only with the tenant.
      await c.query('DELETE FROM h8_usage_events WHERE created_at < ?', [usageBefore]);
      await c.query('DELETE FROM h8_usage WHERE period < ?', [usageBefore.slice(0, 10)]);
      await c.query("DELETE FROM h1_outbox WHERE event_type LIKE 'usage.storage.bytes:%' AND created_at < ?", [usageBefore]);
      if (auditDays > 0) {
        const before = new Date(now - auditDays * 86400000).toISOString();
        await c.query("DELETE FROM h1_outbox WHERE event_type NOT LIKE 'usage.storage.bytes:%' AND created_at < ?", [before]);
        await c.query('DELETE FROM h8_audit WHERE created_at < ?', [before]);
      }
      await appendOperatorAudit(c, { action: 'retention.applied', detail: { auditDays, usageDays } }, now);
    });
  }
}
