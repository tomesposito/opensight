import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, readdir, realpath, rename } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BoundColumn } from '@opensight/query-engine';
import { validateSecurityState } from './security.js';
import { validatePrepState } from './prep-routes.js';
import { validateAIState } from './ai-settings.js';
import { validateAutomationState } from './automation-state.js';
import { DefinitionStore } from './store.js';
import { MetadataError, type Database } from './metadata-db.js';
import { identifier, insertResource, object, resourceLinks, type ResourceKey, type Scope } from './metadata-resources.js';
import { canonical, checksum } from './metadata-operator.js';
import { freezeLegacy, unfreezeLegacy, maintenanceLock } from './metadata-maintenance.js';
import { migrateAISecret } from './metadata-secrets.js';
import { appendMetadataEvent } from './metadata-outbox.js';
import type { JsonObject } from './mapping.js';

export interface LegacyMigrationConfig {
  migrationId: string; maintenance: true; backupDirectory: string;
  securityPath: string; prepPath?: string; aiPath?: string; automationPath?: string;
  /** Every legacy namespace, including default, must have an explicit operator mapping. */
  namespaces: { namespaceId: string; tenantId: string; purpose: 'customer' | 'self-hosted'; dataRoot?: string }[];
  securityColumns: BoundColumn[];
  compatibleBaseUrls?: string[];
  /** Explicit trusted bindings, never inferred from fixture folders or imported ARNs. */
  datasets: { namespaceId: string; id: string; arn: string; definition: JsonObject; sources: ResourceKey[] }[];
  sources: { namespaceId: string; id: string; ownerId?: string; binding: JsonObject }[];
}
interface MigrationRow extends Scope { key: ResourceKey; body: JsonObject }
interface BackupFile { path: string; bytes: string; sha256: string }
interface MigrationPlan {
  version: 1; configurationChecksum: string; inputChecksum: string; checksum: string;
  counts: Record<string, number>; files: BackupFile[]; freezePaths: string[];
  namespaces: (Scope & { name: string })[]; rows: MigrationRow[];
}
export interface MigrationReport { migrationId: string; state: string; checksum: string; counts: Record<string, number>; backupVersion: 1 }
export type MigrationCheckpoint = 'frozen' | 'inventoried' | 'tenant-written' | 'row-written' | 'before-commit' | 'committed';
const inside = (parent: string, child: string) => { const p = relative(parent, child); return !p || !isAbsolute(p) && p !== '..' && !p.startsWith('../'); };
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const rowKey = (scope: Scope, key: ResourceKey) => canonical([scope.tenantId, scope.namespaceId, key.kind, key.ownerId ?? '', key.id]);
const operationId = (id: string, tenant: string) => `migration_${checksum([id, tenant])}`;
const absent = (e: unknown) => e instanceof Error && 'code' in e && e.code === 'ENOENT';

async function snapshot(paths: string[]): Promise<BackupFile[]> {
  const result: BackupFile[] = [];
  const visit = async (path: string): Promise<void> => {
    const stat = await lstat(path);
    if (stat.isSymbolicLink()) throw new MetadataError('MIGRATION_SYMLINK_REJECTED');
    if (stat.isDirectory()) {
      for (const name of (await readdir(path)).sort()) if (!name.startsWith('.') && name !== 'node_modules') await visit(join(path, name));
    } else if (stat.isFile()) {
      const bytes = await readFile(path); result.push({ path, bytes: bytes.toString('base64'), sha256: digest(bytes) });
    } else throw new MetadataError('MIGRATION_INPUT_INVALID');
  };
  for (const path of paths) await visit(path);
  return result;
}
function inputChecksum(files: BackupFile[]): string { return checksum(files.map(({ path, sha256 }) => ({ path, sha256 }))); }
function validatePlan(plan: MigrationPlan): void {
  const keys = new Set<string>();
  const namespaces = new Set(plan.namespaces.map(n => canonical([n.tenantId, n.namespaceId])));
  for (const row of plan.rows) {
    if (!namespaces.has(canonical([row.tenantId, row.namespaceId]))) throw new MetadataError('MIGRATION_UNRESOLVED_NAMESPACE');
    const key = rowKey(row, row.key); if (keys.has(key)) throw new MetadataError('MIGRATION_DUPLICATE_ID'); keys.add(key);
  }
  for (const row of plan.rows) for (const ref of resourceLinks(row.key, row.body)) {
    if (!keys.has(rowKey(row, ref))) throw new MetadataError('MIGRATION_UNRESOLVED_REFERENCE');
  }
  const prepared = new Map(plan.rows.filter(r => r.key.kind === 'prepared-dataset').map(r => [rowKey(r, r.key), r]));
  const visit = (key: string, active: Set<string>) => {
    if (active.has(key) || active.size >= 16) throw new MetadataError('MIGRATION_PREP_CYCLE_OR_DEPTH');
    const row = prepared.get(key)!;
    for (const ref of resourceLinks(row.key, row.body).filter(r => r.kind === 'prepared-dataset')) visit(rowKey(row, ref), new Set([...active, key]));
  };
  for (const key of prepared.keys()) visit(key, new Set());
  for (const ns of plan.namespaces) if (!plan.rows.some(r => r.tenantId === ns.tenantId && r.namespaceId === ns.namespaceId && r.key.kind === 'user' && r.body.role === 'administrator')) throw new MetadataError('TENANT_ADMINISTRATOR_REQUIRED');
}

/** Offline migration. No route wiring, background jobs, source I/O, or dual writes. */
export class MetadataMigration {
  constructor(private readonly database: Database) {}
  private async locked<T>(config: LegacyMigrationConfig, work: (config: LegacyMigrationConfig) => Promise<T>): Promise<T> {
    const copy = structuredClone(config), paths = this.paths(copy), backup = resolve(copy.backupDirectory);
    if (paths.some(path => inside(path, backup) || inside(backup, path))) throw new MetadataError('MIGRATION_BACKUP_OVERLAPS_INPUT');
    await mkdir(backup, { recursive: true, mode: 0o700 });
    if (await realpath(backup) !== backup) throw new MetadataError('MIGRATION_SYMLINK_REJECTED');
    // All migrations sharing this backup directory serialize migrate/seal/rollback, including after a crash.
    return maintenanceLock(join(backup, 'maintenance'), () => work(copy));
  }
  async migrate(config: LegacyMigrationConfig, encryptionKey?: string, checkpoint: (stage: MigrationCheckpoint) => Promise<void> = async () => {}): Promise<MigrationReport> {
    return this.locked(config, copy => this.migrateLocked(copy, encryptionKey, checkpoint));
  }
  async seal(config: LegacyMigrationConfig): Promise<MigrationReport> { return this.locked(config, copy => this.sealLocked(copy)); }
  async rollback(config: LegacyMigrationConfig): Promise<void> { return this.locked(config, copy => this.rollbackLocked(copy)); }
  private paths(config: LegacyMigrationConfig): string[] {
    if (config.maintenance !== true) throw new MetadataError('MIGRATION_MAINTENANCE_REQUIRED');
    identifier(config.migrationId);
    return [config.securityPath, config.prepPath, config.aiPath, config.automationPath, ...config.namespaces.map(n => n.dataRoot)].filter((p): p is string => !!p).map(p => resolve(p));
  }
  private backupPath(config: LegacyMigrationConfig): string { return join(resolve(config.backupDirectory), `h1-v1-${identifier(config.migrationId)}.json`); }
  private async build(config: LegacyMigrationConfig, paths: string[], encryptionKey?: string): Promise<MigrationPlan> {
    const files = await snapshot(paths), rows: MigrationRow[] = [];
    const json = (path: string) => JSON.parse(Buffer.from(files.find(f => f.path === resolve(path))!.bytes, 'base64').toString('utf8')) as unknown;
    const security = validateSecurityState(json(config.securityPath), config.securityColumns);
    if (config.namespaces.length !== security.namespaces.length || new Set(config.namespaces.map(n => n.namespaceId)).size !== config.namespaces.length || new Set(config.namespaces.map(n => n.tenantId)).size !== config.namespaces.length) throw new MetadataError('MIGRATION_NAMESPACE_MAPPING_REQUIRED');
    const namespaces = config.namespaces.map(n => {
      identifier(n.namespaceId);
      if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(n.tenantId)) throw new MetadataError('MIGRATION_OPAQUE_TENANT_ID_REQUIRED');
      const legacy = security.namespaces.find(s => s.id === n.namespaceId); if (!legacy) throw new MetadataError('MIGRATION_NAMESPACE_MAPPING_REQUIRED');
      return { tenantId: n.tenantId, namespaceId: n.namespaceId, name: legacy.name };
    });
    const scope = (namespaceId: string): Scope => { const n = namespaces.find(n => n.namespaceId === namespaceId); if (!n) throw new MetadataError('MIGRATION_UNRESOLVED_NAMESPACE'); return { tenantId: n.tenantId, namespaceId }; };
    const add = (namespaceId: string, key: ResourceKey, body: JsonObject) => rows.push({ ...scope(namespaceId), key, body });
    for (const { namespaceId, id, ...body } of security.users) add(namespaceId, { kind: 'user', id }, body);
    for (const { namespaceId, id, ...body } of security.groups) add(namespaceId, { kind: 'group', id }, body);
    for (const { namespaceId, id, ...body } of security.folders ?? []) add(namespaceId, { kind: 'folder', id }, body);
    for (const { namespaceId, id, ...body } of security.invitations ?? []) add(namespaceId, { kind: 'invitation', id }, body);
    for (const { namespaceId, ...body } of security.datasets) {
      if (!config.datasets.some(d => d.namespaceId === namespaceId && d.id === body.datasetId && d.arn === body.dataSetArn)) throw new MetadataError('MIGRATION_UNRESOLVED_REFERENCE');
      add(namespaceId, { kind: 'policy', id: body.datasetId }, body);
    }
    for (const source of config.sources) add(source.namespaceId, { kind: 'source', id: source.id, ...(source.ownerId ? { ownerId: source.ownerId } : {}) }, { binding: source.binding });
    for (const d of config.datasets) add(d.namespaceId, { kind: 'dataset', id: d.id }, { definition: d.definition, sources: d.sources });
    const arnKeys = config.datasets.map(d => canonical([d.namespaceId, d.arn]));
    if (new Set(arnKeys).size !== arnKeys.length) throw new MetadataError('MIGRATION_DUPLICATE_ID');
    const asset = (namespaceId: string, key: ResourceKey, definition: JsonObject, folderId: string | null, grants?: unknown) => {
      const declarations = object(definition.Definition).DataSetIdentifierDeclarations;
      if (!Array.isArray(declarations)) throw new MetadataError('MIGRATION_DEFINITION_INVALID');
      const datasets = declarations.map(d => {
        const resolved = config.datasets.find(b => b.namespaceId === namespaceId && b.arn === object(d).DataSetArn);
        if (!resolved) throw new MetadataError('MIGRATION_UNRESOLVED_REFERENCE'); return { kind: 'dataset', id: resolved.id };
      });
      add(namespaceId, key, { definition, folderId, datasets, ...(grants === undefined ? {} : { grants }) });
    };
    const imported = new Set<string>();
    for (const n of config.namespaces) if (n.dataRoot) {
      const store = await DefinitionStore.load(n.dataRoot, true);
      for (const item of store.list()) {
        const organized = security.assets?.find(a => a.namespaceId === n.namespaceId && a.id === item.id && a.kind === item.kind);
        if (organized?.definition) throw new MetadataError('MIGRATION_DUPLICATE_ID');
        asset(n.namespaceId, { kind: item.kind, id: item.id }, store.get(item.kind, item.id)!, organized?.folderId ?? null, organized?.grants);
        imported.add(canonical([n.namespaceId, item.kind, item.id]));
      }
    }
    for (const a of security.assets ?? []) {
      if (a.definition) asset(a.namespaceId, { kind: a.kind, id: a.id }, a.definition, a.folderId, a.grants);
      else if (!imported.has(canonical([a.namespaceId, a.kind, a.id]))) throw new MetadataError('MIGRATION_UNRESOLVED_REFERENCE');
    }
    if (config.prepPath) for (const d of validatePrepState(json(config.prepPath)).datasets) add(d.namespaceId, { kind: 'prepared-dataset', id: d.resource.dataSetId, ownerId: d.userId }, { resource: d.resource, ...(d.execution ? { execution: d.execution } : {}) });
    if (config.aiPath) for (const saved of validateAIState(json(config.aiPath), config.compatibleBaseUrls ?? []).configs) {
      const { namespaceId, encryptedKey, ...settings } = saved;
      if (encryptedKey) {
        if (!encryptionKey) throw new MetadataError('METADATA_ENCRYPTION_KEY_REQUIRED', 503);
        add(namespaceId, { kind: 'secret', id: 'ai-provider' }, migrateAISecret({ ...saved, encryptedKey }, encryptionKey, scope(namespaceId)));
      }
      add(namespaceId, { kind: 'ai-config', id: 'provider' }, { ...settings, ...(encryptedKey ? { secretId: 'ai-provider' } : {}) });
    }
    if (config.automationPath) {
      const automation = validateAutomationState(json(config.automationPath));
      // No inferred tenant, even for an empty automation file.
      scope('default');
      const jobId = (collection: string, key: unknown) => checksum([collection, key]);
      for (const [collection, values] of Object.entries(automation)) if (collection !== 'version') for (const raw of values as unknown[]) {
        const r = object(raw), refs: ResourceKey[] = [];
        const ownKey = collection === 'subscriptions' ? [r.userId, r.id] : r.id ?? r.eventId ?? r.ruleId ?? r.datasetId;
        if (r.datasetId) refs.push({ kind: 'dataset', id: String(r.datasetId) });
        if (r.dashboardId) refs.push({ kind: 'dashboard', id: String(r.dashboardId) });
        if (r.userId) refs.push({ kind: 'user', id: String(r.userId) });
        if (r.subscriptionId) refs.push({ kind: 'job', id: jobId('subscriptions', [r.userId, r.subscriptionId]) });
        if (r.ruleId) refs.push({ kind: 'job', id: jobId('alertRules', r.ruleId) });
        if (r.refreshRunId) refs.push({ kind: 'job', id: jobId('refreshRuns', r.refreshRunId) });
        add('default', { kind: 'job', id: jobId(collection, ownKey) }, { collection, record: r, references: refs, executionDisabled: true });
      }
    }
    const counts: Record<string, number> = { namespaces: namespaces.length };
    for (const row of rows) counts[row.key.kind] = (counts[row.key.kind] ?? 0) + 1;
    const plan: MigrationPlan = { version: 1, configurationChecksum: checksum(config), inputChecksum: inputChecksum(files), checksum: '', counts, files, freezePaths: paths, namespaces, rows };
    validatePlan(plan);
    plan.checksum = checksum({ namespaces, rows });
    return plan;
  }
  private async loadPlan(config: LegacyMigrationConfig): Promise<MigrationPlan> {
    const plan = JSON.parse(await readFile(this.backupPath(config), 'utf8')) as MigrationPlan;
    if (plan.version !== 1 || plan.configurationChecksum !== checksum(config) || plan.checksum !== checksum({ namespaces: plan.namespaces, rows: plan.rows }) || plan.inputChecksum !== inputChecksum(plan.files) || plan.files.some(f => digest(Buffer.from(f.bytes, 'base64')) !== f.sha256)) throw new MetadataError('MIGRATION_BACKUP_MISMATCH');
    validatePlan(plan); return plan;
  }
  private async unchanged(plan: MigrationPlan): Promise<void> {
    if (inputChecksum(await snapshot(plan.freezePaths)) !== plan.inputChecksum) throw new MetadataError('MIGRATION_INPUT_CHANGED');
  }
  private report(config: LegacyMigrationConfig, plan: MigrationPlan, state: string): MigrationReport {
    return { migrationId: config.migrationId, state, checksum: plan.checksum, counts: plan.counts, backupVersion: 1 };
  }
  private async migrateLocked(config: LegacyMigrationConfig, encryptionKey?: string, checkpoint: (stage: MigrationCheckpoint) => Promise<void> = async () => {}): Promise<MigrationReport> {
    config = structuredClone(config);
    const paths = this.paths(config);
    for (const path of paths) if (await realpath(path) !== path) throw new MetadataError('MIGRATION_SYMLINK_REJECTED');
    for (let i = 0; i < paths.length; i++) for (let j = i + 1; j < paths.length; j++) if (inside(paths[i]!, paths[j]!) || inside(paths[j]!, paths[i]!)) throw new MetadataError('MIGRATION_OVERLAPPING_INPUTS');
    for (const path of paths) if (inside(path, resolve(config.backupDirectory))) throw new MetadataError('MIGRATION_BACKUP_OVERLAPS_INPUT');
    const fixtures = fileURLToPath(new URL('../../../fixtures', import.meta.url));
    for (const n of config.namespaces) {
      if (!['customer', 'self-hosted'].includes(n.purpose)) throw new MetadataError('MIGRATION_PURPOSE_REQUIRED');
      if (n.dataRoot && n.purpose === 'customer' && (inside(fixtures, resolve(n.dataRoot)) || inside(resolve(n.dataRoot), fixtures))) throw new MetadataError('MIGRATION_FIXTURE_CUSTOMER_REJECTED');
    }
    for (const path of paths) await freezeLegacy(path, config.migrationId);
    await checkpoint('frozen');
    let plan: MigrationPlan;
    try { plan = await this.loadPlan(config); }
    catch (error) {
      if (!absent(error)) throw error;
      plan = await this.build(config, paths, encryptionKey);
      const destination = this.backupPath(config);
      await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
      const temporary = `${destination}.${randomUUID()}.tmp`, file = await open(temporary, 'wx', 0o600);
      try { await file.writeFile(JSON.stringify(plan)); await file.sync(); } finally { await file.close(); }
      await rename(temporary, destination);
      const directory = await open(dirname(destination), 'r'); try { await directory.sync(); } finally { await directory.close(); }
    }
    await this.unchanged(plan);
    await this.database.transaction(async c => {
      const previous = await c.query('SELECT checksum, state FROM h1_migrations WHERE migration_id = ?', [config.migrationId]);
      if (previous[0]) {
        if (previous[0].checksum !== plan.checksum || previous[0].state === 'rolled-back') throw new MetadataError('MIGRATION_ID_REUSED');
      } else await c.query("INSERT INTO h1_migrations VALUES (?,?,?,'inventoried',1)", [config.migrationId, plan.checksum, JSON.stringify(plan.counts)]);
    });
    await checkpoint('inventoried');
    const state = await this.database.transaction(async c => {
      const record = (await c.query('SELECT state FROM h1_migrations WHERE migration_id = ?', [config.migrationId]))[0]!;
      if (record.state === 'committed' || record.state === 'sealed') return String(record.state);
      if (record.state !== 'inventoried') throw new MetadataError('MIGRATION_ID_REUSED');
      for (const ns of plan.namespaces) {
        await c.query("INSERT INTO h1_tenants VALUES (?,'provisioning',1,NULL,NULL,NULL)", [ns.tenantId]);
        await c.query('INSERT INTO h1_namespaces VALUES (?,?,?)', [ns.namespaceId, ns.tenantId, ns.name]);
        await c.query('INSERT INTO h1_revisions VALUES (?,?,1,1,1)', [ns.tenantId, ns.namespaceId]);
        await c.query("INSERT INTO h1_operations VALUES (?,?,?,'provision',?,'pending','migration-held')", [operationId(config.migrationId, ns.tenantId), ns.tenantId, ns.namespaceId, plan.checksum]);
        await checkpoint('tenant-written');
      }
      for (const row of plan.rows) { await insertResource(c, row, row.key, row.body); await checkpoint('row-written'); }
      await this.unchanged(plan);
      for (const ns of plan.namespaces) await appendMetadataEvent(c, ns, 'migration.committed');
      await c.query("UPDATE h1_migrations SET state = 'committed' WHERE migration_id = ?", [config.migrationId]);
      await checkpoint('before-commit');
      return 'committed';
    });
    await checkpoint('committed');
    return this.report(config, plan, state);
  }
  private async sealLocked(config: LegacyMigrationConfig): Promise<MigrationReport> {
    this.paths(config); const plan = await this.loadPlan(config); await this.unchanged(plan);
    await this.database.transaction(async c => {
      const m = (await c.query('SELECT * FROM h1_migrations WHERE migration_id = ?', [config.migrationId]))[0];
      if (!m || m.checksum !== plan.checksum || !['committed', 'sealed'].includes(String(m.state))) throw new MetadataError('MIGRATION_NOT_COMMITTED');
      if (m.state === 'sealed') return;
      for (const ns of plan.namespaces) {
        const result = await c.query("UPDATE h1_tenants SET state = 'active', version = version + 1 WHERE tenant_id = ? AND state = 'provisioning' RETURNING tenant_id", [ns.tenantId]);
        if (!result.length) throw new MetadataError('MIGRATION_TENANT_CHANGED');
        await c.query("UPDATE h1_operations SET status = 'complete', step = 'active' WHERE operation_id = ?", [operationId(config.migrationId, ns.tenantId)]);
        await appendMetadataEvent(c, ns, 'tenant.active');
      }
      await c.query("UPDATE h1_migrations SET state = 'sealed' WHERE migration_id = ?", [config.migrationId]);
    });
    return this.report(config, plan, 'sealed');
  }
  private async rollbackLocked(config: LegacyMigrationConfig): Promise<void> {
    const paths = this.paths(config);
    await this.database.transaction(async c => {
      const m = (await c.query('SELECT * FROM h1_migrations WHERE migration_id = ?', [config.migrationId]))[0];
      if (m?.state === 'sealed') throw new MetadataError('MIGRATION_ROLLBACK_BOUNDARY');
      if (m && m.state !== 'rolled-back') {
        const plan = await this.loadPlan(config);
        if (m.checksum !== plan.checksum) throw new MetadataError('MIGRATION_BACKUP_MISMATCH');
        if (m.state === 'committed') for (const ns of plan.namespaces) {
          const tenant = (await c.query('SELECT state FROM h1_tenants WHERE tenant_id = ?', [ns.tenantId]))[0];
          if (tenant?.state !== 'provisioning') throw new MetadataError('MIGRATION_TENANT_CHANGED');
          for (const table of ['links', 'resources', 'outbox', 'operations', 'revisions', 'namespaces', 'tenants']) await c.query(`DELETE FROM h1_${table} WHERE tenant_id = ?`, [ns.tenantId]);
        }
        await c.query("UPDATE h1_migrations SET state = 'rolled-back' WHERE migration_id = ?", [config.migrationId]);
      }
    });
    for (const path of paths) try { await unfreezeLegacy(path, config.migrationId); } catch (error) { if (!absent(error)) throw error; }
  }
}
