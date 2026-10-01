import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseUpload, type UploadColumn } from '@opensight/query-engine';
import { MetadataError, type Database, type SqlConnection } from './metadata-db.js';
import { identifier, object, insertLinks, resourceLinks, type ResourceKey, type Scope } from './metadata-resources.js';
import { checksum } from './metadata-operator.js';
import { maintenanceLock } from './metadata-maintenance.js';
import { encryptMetadataSecret } from './metadata-secrets.js';
import { sourceBody, sourceCredentials, sourceError, type SourceEndpoint } from './source-schema.js';
import type { JsonObject } from './mapping.js';

export interface SourceMigrationInput extends Scope {
  id: string; ownerId: string; binding: JsonObject; policy: JsonObject;
  /** Names of environment variables, never credential or upload values in the manifest. */
  credentialsEnv?: string; uploadEnv?: string; uploadConfig?: JsonObject;
}
export interface SourceMigrationConfig { migrationId: string; maintenance: true; backupDirectory: string; sources: SourceMigrationInput[] }
interface Row extends Scope { key: ResourceKey; body: JsonObject; version: number }
interface Plan { version: 1; configuration: string; checksum: string; before: Row[]; after: Row[]; scopes: Scope[]; counts: { sources: number; secrets: number } }
const values = (r: Row) => [r.tenantId, r.namespaceId, r.key.kind, r.key.ownerId ?? '', r.key.id];
const predicate = 'tenant_id = ? AND namespace_id = ? AND kind = ? AND owner_id = ? AND resource_id = ?';
const identity = (r: Pick<Row, 'tenantId' | 'namespaceId' | 'key'>) => JSON.stringify(values({ ...r, body: {}, version: 0 }));
function row(scope: Scope, r: Record<string, unknown>): Row {
  return { ...scope, key: { kind: r.kind as ResourceKey['kind'], id: String(r.resource_id), ...(r.owner_id ? { ownerId: String(r.owner_id) } : {}) }, body: object(JSON.parse(String(r.body))), version: Number(r.version) };
}
async function frozen(c: SqlConnection, scopes: Scope[]) {
  for (const s of scopes) {
    const result = await c.query("UPDATE h1_tenants SET version = version WHERE tenant_id = ? AND state IN ('provisioning','suspended') RETURNING tenant_id", [s.tenantId]);
    if (!result.length) throw new MetadataError('MIGRATION_MAINTENANCE_REQUIRED', 503);
    if (!(await c.query('SELECT namespace_id FROM h1_namespaces WHERE tenant_id = ? AND namespace_id = ?', [s.tenantId, s.namespaceId])).length) throw new MetadataError('MIGRATION_UNRESOLVED_NAMESPACE');
  }
}
/** H3 upgrades H1 source rows offline. Suspended/provisioning tenants freeze every tenant writer. */
export class SourceMigration {
  constructor(private readonly database: Database, private readonly encryptionKey: string, private readonly endpoints: readonly SourceEndpoint[]) {}
  private config(raw: SourceMigrationConfig) {
    const config = structuredClone(raw);
    object(config, ['migrationId', 'maintenance', 'backupDirectory', 'sources']); identifier(config.migrationId);
    if (config.maintenance !== true || !Array.isArray(config.sources) || !config.sources.length) throw new MetadataError('MIGRATION_MAINTENANCE_REQUIRED', 503);
    const seen = new Set<string>();
    for (const s of config.sources) {
      object(s, ['tenantId', 'namespaceId', 'id', 'ownerId', 'binding', 'policy', 'credentialsEnv', 'uploadEnv', 'uploadConfig']);
      for (const v of [s.tenantId, s.namespaceId, s.id, s.ownerId]) identifier(v);
      for (const name of [s.credentialsEnv, s.uploadEnv]) if (name !== undefined && !/^[A-Z][A-Z0-9_]{0,127}$/.test(name)) sourceError('MIGRATION_ENV_INVALID');
      const key = identity({ ...s, key: { kind: 'source', id: s.id, ownerId: s.ownerId } });
      if (seen.has(key)) throw new MetadataError('MIGRATION_DUPLICATE_ID'); seen.add(key);
    }
    return config;
  }
  private async lock<T>(config: SourceMigrationConfig, work: () => Promise<T>) {
    await mkdir(resolve(config.backupDirectory), { recursive: true, mode: 0o700 });
    return maintenanceLock(join(resolve(config.backupDirectory), 'h3-maintenance'), work);
  }
  private path(config: SourceMigrationConfig) { return join(resolve(config.backupDirectory), `h3-v1-${config.migrationId}.json`); }
  private async load(config: SourceMigrationConfig): Promise<Plan> {
    const p = JSON.parse(await readFile(this.path(config), 'utf8')) as Plan;
    const { checksum: saved, ...body } = p;
    if (p.version !== 1 || p.configuration !== checksum(config) || checksum(body) !== saved) throw new MetadataError('MIGRATION_BACKUP_MISMATCH');
    return p;
  }
  private async inventory(config: SourceMigrationConfig, env: NodeJS.ProcessEnv): Promise<Plan> {
    const scopes = [...new Map(config.sources.map(s => [JSON.stringify([s.tenantId, s.namespaceId]), { tenantId: s.tenantId, namespaceId: s.namespaceId }])).values()];
    return this.database.transaction(async c => {
      await frozen(c, scopes);
      const before: Row[] = [], after: Row[] = [];
      for (const scope of scopes) {
        const current = await c.query("SELECT * FROM h1_resources WHERE tenant_id = ? AND namespace_id = ? AND kind = 'source' ORDER BY owner_id, resource_id", [scope.tenantId, scope.namespaceId]);
        const supplied = config.sources.filter(s => s.tenantId === scope.tenantId && s.namespaceId === scope.namespaceId);
        // Every source must have an explicit repair mapping. No orphan/ownerless row is discarded.
        if (current.length !== supplied.length) throw new MetadataError('MIGRATION_UNRESOLVED_SOURCE');
        for (const r of current) {
          const old = row(scope, r), input = supplied.find(s => s.id === old.key.id && s.ownerId === old.key.ownerId);
          if (!input) throw new MetadataError('MIGRATION_UNRESOLVED_SOURCE');
          before.push(old);
          if (old.body.secretId !== undefined) {
            const secret = await c.query(`SELECT * FROM h1_resources WHERE ${predicate}`, [...values(old).slice(0, 2), 'secret', old.key.ownerId!, String(old.body.secretId)]);
            if (!secret[0]) throw new MetadataError('MIGRATION_UNRESOLVED_REFERENCE');
            const previous = row(scope, secret[0]); if (before.some(r => identity(r) === identity(previous))) throw new MetadataError('MIGRATION_SHARED_SECRET_REQUIRES_REPAIR'); before.push(previous);
          }
          const secretId = randomUUID(), secretKey: ResourceKey = { kind: 'secret', ownerId: input.ownerId, id: secretId };
          const body = sourceBody({ binding: input.binding, policy: input.policy, secretId });
          let payload: unknown;
          if (body.binding.state !== 'active') throw new MetadataError('MIGRATION_UNRESOLVED_SOURCE');
          if (body.binding.connectorId === 'postgresql') {
            if (input.uploadEnv || input.uploadConfig || !input.credentialsEnv || !this.endpoints.some(e => e.id === body.binding.endpointId)) throw new MetadataError('MIGRATION_UNRESOLVED_SOURCE');
            try { payload = sourceCredentials(JSON.parse(env[input.credentialsEnv] ?? '')); } catch { throw new MetadataError('MIGRATION_SECRET_REQUIRED'); }
          } else {
            if (input.credentialsEnv || !input.uploadEnv || !input.uploadConfig || Date.parse(body.binding.expiresAt!) <= Date.now()) throw new MetadataError('MIGRATION_UPLOAD_REQUIRED');
            const bytes = env[input.uploadEnv];
            if (!bytes || Buffer.from(bytes, 'base64').toString('base64') !== bytes) throw new MetadataError('MIGRATION_UPLOAD_REQUIRED');
            const parsed = parseUpload({ config: input.uploadConfig, data: Buffer.from(bytes, 'base64'), columns: body.binding.columns as UploadColumn[] });
            if (parsed.rows.length !== body.binding.rowCount) throw new MetadataError('MIGRATION_UPLOAD_MISMATCH');
            payload = { rows: parsed.rows };
          }
          after.push({ ...scope, key: secretKey, body: encryptMetadataSecret(JSON.stringify(payload), this.encryptionKey, scope, secretKey), version: 1 });
          after.push({ ...old, body: object(body), version: old.version + 1 });
        }
      }
      // Validate all source principals and existing prep edges before writing a backup or rows.
      for (const r of after) for (const key of resourceLinks(r.key, r.body)) {
        const target = { ...r, key };
        if (!after.some(a => identity(a) === identity(target)) && !(await c.query(`SELECT resource_id FROM h1_resources WHERE ${predicate}`, values(target))).length) throw new MetadataError('MIGRATION_UNRESOLVED_REFERENCE');
      }
      for (const scope of scopes) for (const r of await c.query("SELECT * FROM h1_resources WHERE tenant_id = ? AND namespace_id = ? AND kind = 'prepared-dataset'", [scope.tenantId, scope.namespaceId])) {
        const entry = row(scope, r);
        for (const key of resourceLinks(entry.key, entry.body)) if (!(await c.query(`SELECT resource_id FROM h1_resources WHERE ${predicate}`, values({ ...entry, key }))).length) throw new MetadataError('MIGRATION_UNRESOLVED_REFERENCE');
      }
      const plan = { version: 1 as const, configuration: checksum(config), before, after, scopes, counts: { sources: config.sources.length, secrets: config.sources.length } };
      return { ...plan, checksum: checksum(plan) };
    });
  }
  async migrate(raw: SourceMigrationConfig, env: NodeJS.ProcessEnv = process.env, checkpoint: (stage: string) => Promise<void> = async () => {}) {
    const config = this.config(raw);
    return this.lock(config, async () => {
      let plan: Plan;
      try { plan = await this.load(config); }
      catch (e) {
        if (!(e instanceof Error && 'code' in e && e.code === 'ENOENT')) throw e;
        plan = await this.inventory(config, env);
        const target = this.path(config), temporary = `${target}.${randomUUID()}.tmp`, file = await open(temporary, 'wx', 0o600);
        try { await file.writeFile(JSON.stringify(plan)); await file.sync(); } finally { await file.close(); }
        await rename(temporary, target);
        const dir = await open(resolve(config.backupDirectory), 'r'); try { await dir.sync(); } finally { await dir.close(); }
      }
      await checkpoint('inventoried');
      const state = await this.database.transaction(async c => {
        await frozen(c, plan.scopes);
        const existing = (await c.query('SELECT * FROM h1_migrations WHERE migration_id = ?', [`h3_${config.migrationId}`]))[0];
        if (existing) {
          if (existing.checksum !== plan.checksum || existing.state === 'rolled-back') throw new MetadataError('MIGRATION_ID_REUSED');
          return String(existing.state);
        }
        for (const r of plan.before) {
          const current = (await c.query(`SELECT body, version FROM h1_resources WHERE ${predicate}`, values(r)))[0];
          if (!current || Number(current.version) !== r.version || checksum(JSON.parse(String(current.body))) !== checksum(r.body)) throw new MetadataError('MIGRATION_INPUT_CHANGED');
        }
        const sourceCount = await Promise.all(plan.scopes.map(s => c.query("SELECT resource_id FROM h1_resources WHERE tenant_id = ? AND namespace_id = ? AND kind = 'source'", [s.tenantId, s.namespaceId])));
        if (sourceCount.reduce((n, rows) => n + rows.length, 0) !== plan.counts.sources) throw new MetadataError('MIGRATION_INPUT_CHANGED');
        for (const r of plan.before.filter(r => r.key.kind === 'source')) await c.query(`DELETE FROM h1_links WHERE ${predicate}`, values(r));
        for (const r of plan.after) {
          if (r.key.kind === 'source') await c.query(`UPDATE h1_resources SET body = ?, version = ? WHERE ${predicate}`, [JSON.stringify(r.body), r.version, ...values(r)]);
          else await c.query('INSERT INTO h1_resources VALUES (?,?,?,?,?,?,?)', [...values(r), JSON.stringify(r.body), r.version]);
          await insertLinks(c, r, r.key, resourceLinks(r.key, r.body)); await checkpoint('row-written');
        }
        for (const r of plan.before.filter(r => r.key.kind === 'secret')) await c.query(`DELETE FROM h1_resources WHERE ${predicate}`, values(r));
        for (const s of plan.scopes) {
          for (const r of await c.query("SELECT * FROM h1_resources WHERE tenant_id = ? AND namespace_id = ? AND kind = 'prepared-dataset'", [s.tenantId, s.namespaceId])) {
            const entry = row(s, r); await c.query(`DELETE FROM h1_links WHERE ${predicate}`, values(entry)); await insertLinks(c, s, entry.key, resourceLinks(entry.key, entry.body));
          }
          await c.query('UPDATE h1_revisions SET policy = policy + 1, configuration = configuration + 1 WHERE tenant_id = ? AND namespace_id = ?', [s.tenantId, s.namespaceId]);
        }
        await c.query("INSERT INTO h1_migrations VALUES (?,?,?,'committed',1)", [`h3_${config.migrationId}`, plan.checksum, JSON.stringify(plan.counts)]);
        await checkpoint('before-commit'); return 'committed';
      });
      return { migrationId: config.migrationId, state, counts: plan.counts, checksum: plan.checksum, backupVersion: 1 };
    });
  }
  async seal(raw: SourceMigrationConfig): Promise<void> {
    const config = this.config(raw);
    await this.lock(config, async () => { const plan = await this.load(config); await this.database.transaction(async c => {
      await frozen(c, plan.scopes);
      const result = await c.query("UPDATE h1_migrations SET state = 'sealed' WHERE migration_id = ? AND checksum = ? AND state IN ('committed','sealed') RETURNING migration_id", [`h3_${config.migrationId}`, plan.checksum]);
      if (!result.length) throw new MetadataError('MIGRATION_NOT_COMMITTED');
    }); });
  }
  async rollback(raw: SourceMigrationConfig): Promise<void> {
    const config = this.config(raw);
    await this.lock(config, async () => { const plan = await this.load(config); await this.database.transaction(async c => {
      await frozen(c, plan.scopes);
      const migration = (await c.query('SELECT state, checksum FROM h1_migrations WHERE migration_id = ?', [`h3_${config.migrationId}`]))[0];
      if (!migration || migration.state === 'rolled-back') return;
      if (migration.state === 'sealed') throw new MetadataError('MIGRATION_ROLLBACK_BOUNDARY');
      if (migration.checksum !== plan.checksum) throw new MetadataError('MIGRATION_BACKUP_MISMATCH');
      for (const r of plan.after) {
        const current = (await c.query(`SELECT body, version FROM h1_resources WHERE ${predicate}`, values(r)))[0];
        if (!current || Number(current.version) !== r.version || checksum(JSON.parse(String(current.body))) !== checksum(r.body)) throw new MetadataError('MIGRATION_INPUT_CHANGED');
      }
      for (const r of plan.after.filter(r => r.key.kind === 'source')) await c.query(`DELETE FROM h1_links WHERE ${predicate}`, values(r));
      for (const r of plan.before) {
        if (r.key.kind === 'source') await c.query(`UPDATE h1_resources SET body = ?, version = ? WHERE ${predicate}`, [JSON.stringify(r.body), r.version, ...values(r)]);
        else await c.query('INSERT INTO h1_resources VALUES (?,?,?,?,?,?,?)', [...values(r), JSON.stringify(r.body), r.version]);
        await insertLinks(c, r, r.key, resourceLinks(r.key, r.body));
      }
      for (const r of plan.after.filter(r => r.key.kind === 'secret')) await c.query(`DELETE FROM h1_resources WHERE ${predicate}`, values(r));
      for (const s of plan.scopes) await c.query('UPDATE h1_revisions SET policy = policy + 1, configuration = configuration + 1 WHERE tenant_id = ? AND namespace_id = ?', [s.tenantId, s.namespaceId]);
      await c.query("UPDATE h1_migrations SET state = 'rolled-back' WHERE migration_id = ?", [`h3_${config.migrationId}`]);
    }); });
  }
}
