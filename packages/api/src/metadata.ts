import { AssetCatalog, assetKey } from './asset-model.js';
import { changeDashboard, changeDashboardGrants, describeDashboard, dashboardVersion, type DashboardRecord, type DashboardChange } from './dashboard-model.js';
import type { AssetGrant } from './organization.js';
import { hasCapability } from '@opensight/query-engine';
import { MetadataError, missing, type Database, type SqlConnection, type SqlRow } from './metadata-db.js';
import { identifier, insertLinks, insertResource, resourceKey, resourceKinds, resourceLinks, type MetadataKind, type MetadataResource, type ResourceKey, type Scope } from './metadata-resources.js';
import type { JsonObject } from './mapping.js';
import { appendMetadataEvent } from './metadata-outbox.js';
import type { HostedUsage } from './hosted-usage.js';
import { sourceBody } from './source-schema.js';
import type { RetryCommit } from './retry-store.js';

export interface TenantContext extends Scope { readonly userId: string; readonly authorizationRevision: number }
export interface Revisions { authorization: number; policy: number; configuration: number }
export type MetadataEdit = { key: ResourceKey; expectedVersion: number; body: JsonObject | null };
const predicates = 'tenant_id = ? AND namespace_id = ? AND kind = ? AND owner_id = ? AND resource_id = ?';
const scopeValues = (context: Scope) => [context.tenantId, context.namespaceId];
const keyValues = (context: Scope, key: ResourceKey) => [...scopeValues(context), key.kind, key.ownerId ?? '', key.id];
function resource(row: SqlRow): MetadataResource {
  return { kind: row.kind as MetadataKind, id: String(row.resource_id), ...(row.owner_id ? { ownerId: String(row.owner_id) } : {}), body: JSON.parse(String(row.body)) as JsonObject, version: Number(row.version) };
}

/** H1 data access boundary. Pass only server-verified identities to the verifier seam.
 * Operator access is a separate object/pool, never a tenant capability or HTTP field. */
export class TenantMetadata {
  readonly #contexts = new WeakSet<TenantContext>();
  constructor(private readonly tenantDatabase: Database, private readonly membershipDatabase: Database, readonly usage?: HostedUsage) {}

  async authenticate<T>(credential: T, verify: (credential: T) => Promise<{ namespaceId: string; userId: string } | undefined>): Promise<TenantContext> {
    const identity = await verify(credential);
    if (!identity) throw new MetadataError('PRINCIPAL_REQUIRED', 401);
    const namespaceId = identifier(identity.namespaceId), userId = identifier(identity.userId);
    return this.membershipDatabase.transaction(async c => {
      const rows = await c.query(`SELECT n.tenant_id, r."authorization" FROM h1_namespaces n
        JOIN h1_tenants t ON t.tenant_id = n.tenant_id
        JOIN h1_revisions r ON r.tenant_id = n.tenant_id AND r.namespace_id = n.namespace_id
        JOIN h1_resources u ON u.tenant_id = n.tenant_id AND u.namespace_id = n.namespace_id AND u.kind = 'user' AND u.owner_id = ''
        WHERE n.namespace_id = ? AND u.resource_id = ? AND t.state = 'active'`, [namespaceId, userId]);
      if (!rows[0]) throw new MetadataError('UNKNOWN_PRINCIPAL', 403);
      const context = Object.freeze({ tenantId: String(rows[0].tenant_id), namespaceId, userId, authorizationRevision: Number(rows[0].authorization) });
      this.#contexts.add(context); return context;
    });
  }
  assertContext(context: TenantContext): void {
    if (!context || !this.#contexts.has(context)) throw new MetadataError('TENANT_CONTEXT_REQUIRED', 401);
  }
  private key(context: TenantContext, key: ResourceKey): ResourceKey {
    const normalized = resourceKey(key);
    if (normalized.ownerId && normalized.ownerId !== context.userId) missing();
    return normalized;
  }
  private async checked<T>(context: TenantContext, work: (c: SqlConnection, revisions: Revisions, user: JsonObject) => Promise<T>, writes = false): Promise<T> {
    this.assertContext(context);
    return this.tenantDatabase.transaction(async c => {
      // Serialize admission with tenant edits and lifecycle transitions on both engines.
      const tenants = await c.query("UPDATE h1_tenants SET version = version WHERE tenant_id = ? AND state = 'active' RETURNING version", [context.tenantId]);
      if (!tenants.length) throw new MetadataError('TENANT_UNAVAILABLE', 403);
      const rows = await c.query('SELECT "authorization", policy, configuration FROM h1_revisions WHERE tenant_id = ? AND namespace_id = ?', scopeValues(context));
      const rev = rows[0];
      if (!rev || Number(rev.authorization) !== context.authorizationRevision) throw new MetadataError('AUTHORIZATION_REVISED', 403);
      const users = await c.query(`SELECT body FROM h1_resources WHERE ${predicates}`, keyValues(context, { kind: 'user', id: context.userId }));
      if (!users[0]) throw new MetadataError('UNKNOWN_PRINCIPAL', 403);
      const before = writes && this.usage ? await this.usage.storageBytes(c, context) : 0;
      const result = await work(c, { authorization: Number(rev.authorization), policy: Number(rev.policy), configuration: Number(rev.configuration) }, JSON.parse(String(users[0].body)) as JsonObject);
      if (writes) await this.usage?.storage(c, context, before);
      return result;
    }, context);
  }
  async get(context: TenantContext, key: ResourceKey): Promise<MetadataResource> {
    return this.checked(context, async c => {
      const rows = await c.query(`SELECT * FROM h1_resources WHERE ${predicates}`, keyValues(context, this.key(context, key)));
      return rows[0] ? resource(rows[0]) : missing();
    });
  }
  /** Trusted published-dashboard executor only: read recipe metadata in the reader's
   * tenant, pinned to the publisher. This grants neither source nor secret access;
   * callers must first authorize the durable dashboard/version. No HTTP route. */
  async dashboardRecipe(context: TenantContext, ownerId: string, id: string): Promise<MetadataResource> {
    return this.checked(context, async c => {
      const key = resourceKey({ kind: 'prepared-dataset', ownerId, id });
      const rows = await c.query(`SELECT * FROM h1_resources WHERE ${predicates}`, keyValues(context, key));
      return rows[0] ? resource(rows[0]) : missing();
    });
  }
  /** Trusted embedded asset reader: follows only durable dataset links in this tenant.
   * There is no HTTP route for this method, and no prepared-dataset traversal. */
  async embedDatasetSource(context: TenantContext, datasetId: string): Promise<{ source: MetadataResource; secret?: MetadataResource }> {
    return this.checked(context, async c => {
      const rows = await c.query(`SELECT * FROM h1_resources WHERE ${predicates}`, keyValues(context, { kind: 'dataset', id: identifier(datasetId) }));
      if (!rows[0]) missing();
      const body = resource(rows[0]).body;
      if (!Array.isArray(body.sources) || body.sources.length !== 1) throw new MetadataError('EMBED_DATASET_UNSUPPORTED', 422);
      const ref = resourceKey(body.sources[0] as ResourceKey);
      if (ref.kind !== 'source' || !ref.ownerId) throw new MetadataError('EMBED_SOURCE_UNRESOLVED', 403);
      const sources = await c.query(`SELECT * FROM h1_resources WHERE ${predicates}`, keyValues(context, ref));
      if (!sources[0]) missing();
      const source = resource(sources[0]);
      if (sourceBody(source.body).binding.version === 4) return { source };
      if (typeof source.body.secretId !== 'string') throw new MetadataError('SOURCE_SECRET_REQUIRED', 403);
      const secrets = await c.query(`SELECT * FROM h1_resources WHERE ${predicates}`, keyValues(context, { kind: 'secret', id: identifier(source.body.secretId), ownerId: ref.ownerId }));
      if (!secrets[0]) missing();
      return { source, secret: resource(secrets[0]) };
    });
  }
  async list(context: TenantContext, kind: MetadataKind): Promise<MetadataResource[]> {
    return this.checked(context, async c => {
      if (!resourceKinds.includes(kind)) throw new MetadataError('METADATA_INVALID', 400);
      const rows = await c.query("SELECT * FROM h1_resources WHERE tenant_id = ? AND namespace_id = ? AND kind = ? AND owner_id IN ('',?) ORDER BY resource_id, owner_id", [...scopeValues(context), kind, context.userId]);
      return rows.map(resource);
    });
  }
  async revisions(context: TenantContext): Promise<Revisions> { return this.checked(context, async (_c, revisions) => revisions); }
  async assertRevisions(context: TenantContext, expected: Revisions): Promise<void> {
    await this.checked(context, async (_c, current) => {
      if (current.authorization !== expected.authorization || current.policy !== expected.policy || current.configuration !== expected.configuration) throw new MetadataError('METADATA_REVISED', 403);
    });
  }
  async put(context: TenantContext, key: ResourceKey, body: JsonObject, expectedVersion = 0): Promise<void> {
    await this.batch(context, [{ key, body, expectedVersion }]);
  }
  async remove(context: TenantContext, key: ResourceKey, expectedVersion: number): Promise<void> {
    await this.batch(context, [{ key, body: null, expectedVersion }]);
  }
  /** Author-only definition edits. Callers cannot replace grants or folder placement. */
  async saveEmbeddedAnalysis(context: TenantContext, asset: MetadataResource, expected: Revisions): Promise<void> {
    await this.checked(context, async (c, revisions, user) => {
      if (!hasCapability(user.role as Parameters<typeof hasCapability>[0], 'build') || asset.kind !== 'analysis') throw new MetadataError('METADATA_WRITE_FORBIDDEN', 403);
      if (JSON.stringify(revisions) !== JSON.stringify(expected)) throw new MetadataError('METADATA_REVISED', 403);
      const key = resourceKey({ kind: 'analysis', id: asset.id });
      const prior = (await c.query(`SELECT * FROM h1_resources WHERE ${predicates}`, keyValues(context, key)))[0];
      if (Number(prior?.version ?? 0) !== asset.version) throw new MetadataError('METADATA_CONFLICT');
      const old = prior ? JSON.parse(String(prior.body)) as JsonObject : { folderId: null };
      await this.analysisWriteAccess(c, context, user, old);
      const body: JsonObject = { ...old, hasHadVisual: old.hasHadVisual === true || asset.body.hasHadVisual === true, definition: asset.body.definition, datasets: asset.body.datasets, updatedAt: new Date().toISOString() };
      if (!prior) await insertResource(c, context, key, body);
      else {
        await c.query(`DELETE FROM h1_links WHERE ${predicates}`, keyValues(context, key));
        await c.query(`UPDATE h1_resources SET body = ?, version = version + 1 WHERE ${predicates}`, [JSON.stringify(body), ...keyValues(context, key)]);
        await insertLinks(c, context, key, resourceLinks(key, body));
      }
      await c.query('UPDATE h1_revisions SET "authorization" = "authorization" + 1 WHERE tenant_id = ? AND namespace_id = ?', scopeValues(context));
      await appendMetadataEvent(c, context, 'analysis.saved');
    }, true);
  }
  private async analysisWriteAccess(c: SqlConnection, context: TenantContext, user: JsonObject, old: JsonObject): Promise<void> {
      const groups = await c.query("SELECT resource_id, body FROM h1_resources WHERE tenant_id = ? AND namespace_id = ? AND kind = 'group'", scopeValues(context));
      const memberships = groups.filter(g => (JSON.parse(String(g.body)) as { userIds: string[] }).userIds.includes(context.userId)).map(g => String(g.resource_id));
      const allows = (grants: unknown): boolean => user.role === 'administrator' || grants === undefined || Array.isArray(grants) && grants.some((value: unknown) => {
        const g = value as { role: string; principal: { type: string; id: string } };
        return g.role === 'co-owner' && (g.principal.type === 'user' ? g.principal.id === context.userId : memberships.includes(g.principal.id));
      });
      if (!allows(old.grants)) throw new MetadataError('METADATA_WRITE_FORBIDDEN', 403);
      if (old.folderId) {
        const folder = (await c.query(`SELECT body FROM h1_resources WHERE ${predicates}`, keyValues(context, { kind: 'folder', id: String(old.folderId) })))[0];
        if (!folder || !allows((JSON.parse(String(folder.body)) as JsonObject).grants)) throw new MetadataError('METADATA_WRITE_FORBIDDEN', 403);
      }
  }
  /** D-44/D-45: grant-aware author writes, CAS and revision check in one transaction.
   * Only definitions and server-resolved dataset links may change. */
  async mutateAnalysis(context: TenantContext, id: string, replacement: Pick<JsonObject, 'definition' | 'datasets'> & { hasHadVisual?: boolean } | null, expectedVersion: number, expected: Revisions, receipt?: RetryCommit): Promise<void> {
    await this.checked(context, async (c, revisions, user) => {
      if (!hasCapability(user.role as Parameters<typeof hasCapability>[0], 'build')) throw new MetadataError('METADATA_WRITE_FORBIDDEN', 403);
      const key = resourceKey({ kind: 'analysis', id });
      const prior = (await c.query(`SELECT * FROM h1_resources WHERE ${predicates}`, keyValues(context, key)))[0];
      if (!prior && (expectedVersion !== 0 || replacement === null)) missing();
      const old = prior ? JSON.parse(String(prior.body)) as JsonObject : { folderId: null, grants: [{ principal: { type: 'user', id: context.userId }, role: 'co-owner' }] };
      await this.analysisWriteAccess(c, context, user, old);
      if (Number(prior?.version ?? 0) !== expectedVersion) throw new MetadataError('METADATA_CONFLICT');
      if (JSON.stringify(revisions) !== JSON.stringify(expected)) throw new MetadataError('METADATA_REVISED', 403);
      if (replacement === null) {
        // Sever the mutable republish link, keeping every frozen definition byte-stable.
        const dashboards = await c.query("SELECT * FROM h1_resources WHERE tenant_id = ? AND namespace_id = ? AND kind = 'dashboard'", scopeValues(context));
        for (const row of dashboards) {
          const dashboard = resource(row), published = dashboard.body.published as DashboardRecord | undefined;
          if (published?.sourceAnalysisId !== id || !published.sourceActive) continue;
          published.sourceActive = false;
          await c.query(`UPDATE h1_resources SET body = ?, version = version + 1 WHERE ${predicates}`, [JSON.stringify(dashboard.body), ...keyValues(context, dashboard)]);
        }
        await c.query(`DELETE FROM h1_links WHERE ${predicates}`, keyValues(context, key));
        await c.query(`DELETE FROM h1_resources WHERE ${predicates}`, keyValues(context, key));
      } else {
        const body: JsonObject = { ...old, hasHadVisual: old.hasHadVisual === true || replacement.hasHadVisual === true, definition: replacement.definition, datasets: replacement.datasets, updatedAt: new Date().toISOString() };
        // Server-owned prepared links cannot adopt another user's owner scope.
        for (const ref of resourceLinks(key, body)) if (ref.kind === 'prepared-dataset' && ref.ownerId !== context.userId) missing();
        if (!prior) await insertResource(c, context, key, body);
        else {
          await c.query(`DELETE FROM h1_links WHERE ${predicates}`, keyValues(context, key));
          await c.query(`UPDATE h1_resources SET body = ?, version = version + 1 WHERE ${predicates}`, [JSON.stringify(body), ...keyValues(context, key)]);
          await insertLinks(c, context, key, resourceLinks(key, body));
        }
      }
      // Working-definition CAS is independent of security/data revisions.
      // Advancing those would revoke both concurrent writers' bearer sessions
      // and turn the required stale-version 409 into authentication failures.
      // Reads always check current asset/folder grants and dataset admission.
      await appendMetadataEvent(c, context, replacement ? 'analysis.saved' : 'analysis.deleted');
      await receipt?.persist?.(c);
    }, true);
  }
  /** Publication, latest-version CAS, grants and source checks share one transaction. */
  async mutateDashboard(context: TenantContext, id: string, change: DashboardChange, expected: Revisions, receipt?: (record: DashboardRecord | null) => RetryCommit): Promise<DashboardRecord | null> {
    return this.checked(context, async (c, revisions, user) => {
      if (JSON.stringify(revisions) !== JSON.stringify(expected)) throw new MetadataError('METADATA_REVISED', 403);
      const key = resourceKey({ kind: 'dashboard', id });
      const row = (await c.query(`SELECT * FROM h1_resources WHERE ${predicates}`, keyValues(context, key)))[0];
      const old: JsonObject = row ? resource(row).body : { folderId: null, grants: [{ principal: { type: 'user', id: context.userId }, role: 'co-owner' }] };
      if (change.kind === 'share') {
        if (user.role !== 'administrator') throw new MetadataError('METADATA_WRITE_FORBIDDEN', 403);
      } else {
        if (!hasCapability(user.role as Parameters<typeof hasCapability>[0], 'build')) throw new MetadataError('METADATA_WRITE_FORBIDDEN', 403);
        if (change.kind === 'publish') {
          const source = (await c.query(`SELECT * FROM h1_resources WHERE ${predicates}`, keyValues(context, { kind: 'analysis', id: change.source.id })))[0];
          if (!source) missing();
          await this.analysisWriteAccess(c, context, user, resource(source).body);
          if (Number(source.version) !== change.source.version) throw new MetadataError('METADATA_CONFLICT', 409);
        } else await this.analysisWriteAccess(c, context, user, old);
      }
      if (row && !old.published) throw new MetadataError('DASHBOARD_SOURCE_MISMATCH', 409);
      const next = changeDashboard(old.published as DashboardRecord | undefined, change, context.userId);
      if (row) await c.query(`DELETE FROM h1_links WHERE ${predicates}`, keyValues(context, key));
      if (!next) await c.query(`DELETE FROM h1_resources WHERE ${predicates}`, keyValues(context, key));
      else {
        const v = dashboardVersion(next);
        const body: JsonObject = { ...old, updatedAt: new Date().toISOString(), published: next, definition: describeDashboard(next), datasets: v.definition.dataSetIdentifierDeclarations.map(d => {
          const b = v.datasetBindings[d.identifier]!;
          return { ...b, ...(b.kind === 'prepared-dataset' ? { ownerId: v.bindingOwnerId } : {}) };
        }) };
        if (change.kind === 'share') body.grants = changeDashboardGrants(old.grants as AssetGrant[] | undefined, change);
        if (!row) await insertResource(c, context, key, body);
        else {
          await c.query(`UPDATE h1_resources SET body = ?, version = version + 1 WHERE ${predicates}`, [JSON.stringify(body), ...keyValues(context, key)]);
          await insertLinks(c, context, key, resourceLinks(key, body));
        }
      }
      await appendMetadataEvent(c, context, `dashboard.${change.kind}`);
      await receipt?.(next).persist?.(c);
      return next;
    }, true);
  }
  /** Assets use the same tenant lock, links, quota accounting and durable rows as authoring. */
  async assetTransaction<T>(context: TenantContext, write: boolean, work: (catalog: AssetCatalog) => T, receipt?: (result: T) => RetryCommit): Promise<T> {
    return this.checked(context, async c => {
      const rows = await c.query("SELECT * FROM h1_resources WHERE tenant_id = ? AND namespace_id = ? AND kind IN ('user','group','folder','analysis','dashboard','prepared-dataset')", scopeValues(context));
      const before = rows.map(resource), catalog = new AssetCatalog(context, structuredClone(before));
      const result = work(catalog);
      if (!write) return result;
      const old = new Map(before.map(r => [assetKey(r), r])), next = new Map(catalog.resources.map(r => [assetKey(r), r]));
      const changed = catalog.resources.filter(r => JSON.stringify(r) !== JSON.stringify(old.get(assetKey(r))));
      const removed = before.filter(r => !next.has(assetKey(r)));
      for (const r of [...changed, ...removed]) {
        if (r.ownerId && r.ownerId !== context.userId) missing();
        if (!['analysis', 'dashboard', 'folder', 'prepared-dataset'].includes(r.kind)) throw new MetadataError('METADATA_WRITE_FORBIDDEN', 403);
        await c.query(`DELETE FROM h1_links WHERE ${predicates}`, keyValues(context, r));
      }
      for (const r of changed) {
        const key: ResourceKey = { kind: r.kind, id: r.id, ...(r.ownerId ? { ownerId: r.ownerId } : {}) };
        const links = resourceLinks(key, r.body);
        if (!old.has(assetKey(r))) await insertResource(c, context, key, r.body, r.version);
        else {
          await c.query(`UPDATE h1_resources SET body = ?, version = ? WHERE ${predicates}`, [JSON.stringify(r.body), r.version, ...keyValues(context, r)]);
          await insertLinks(c, context, key, links);
        }
      }
      for (const r of removed) {
        const refs = await c.query('SELECT kind FROM h1_links WHERE tenant_id = ? AND namespace_id = ? AND target_kind = ? AND target_owner = ? AND target_id = ?', [...scopeValues(context), r.kind, r.ownerId ?? '', r.id]);
        if (refs.length) throw new MetadataError('ASSET_DELETE_REFERENCED', 409);
        await c.query(`DELETE FROM h1_resources WHERE ${predicates}`, keyValues(context, r));
      }
      if (removed.some(r => r.kind === 'prepared-dataset')) await c.query('UPDATE h1_revisions SET configuration = configuration + 1 WHERE tenant_id = ? AND namespace_id = ?', scopeValues(context));
      if (changed.length || removed.length) await appendMetadataEvent(c, context, 'assets.changed');
      await receipt?.(result).persist?.(c);
      return result;
    }, write);
  }
  async batch(context: TenantContext, edits: readonly MetadataEdit[], expectedRevisions?: Revisions): Promise<void> {
    this.assertContext(context);
    // Snapshot before awaiting; caller mutation cannot change a checked write mid-transaction.
    const changes = structuredClone(edits);
    await this.checked(context, async (c, _revisions, user) => {
      if (expectedRevisions && Object.keys(expectedRevisions).some(k => expectedRevisions[k as keyof Revisions] !== _revisions[k as keyof Revisions])) throw new MetadataError('METADATA_REVISED', 403);
      const seen = new Set<string>();
      for (const edit of changes) {
        const key = this.key(context, edit.key), encoded = JSON.stringify(keyValues(context, key));
        if (seen.has(encoded) || !Number.isSafeInteger(edit.expectedVersion) || edit.expectedVersion < 0) throw new MetadataError('METADATA_INVALID', 400);
        seen.add(encoded);
        const capability = key.ownerId ? 'build' : 'admin';
        if (!hasCapability(user.role as Parameters<typeof hasCapability>[0], capability)) throw new MetadataError('METADATA_WRITE_FORBIDDEN', 403);
        if (edit.expectedVersion === 0 && edit.body !== null) await insertResource(c, context, key, edit.body);
        else {
          const existing = await c.query(`SELECT version FROM h1_resources WHERE ${predicates}`, keyValues(context, key));
          if (!existing[0]) missing();
          if (Number(existing[0].version) !== edit.expectedVersion) throw new MetadataError('METADATA_CONFLICT');
          await c.query(`DELETE FROM h1_links WHERE ${predicates}`, keyValues(context, key));
          if (edit.body === null) await c.query(`DELETE FROM h1_resources WHERE ${predicates}`, keyValues(context, key));
          else {
            const links = resourceLinks(key, edit.body);
            await c.query(`UPDATE h1_resources SET body = ?, version = version + 1 WHERE ${predicates}`, [JSON.stringify(edit.body), ...keyValues(context, key)]);
            await insertLinks(c, context, key, links);
          }
        }
      }
      if (changes.length) {
        const authorization = changes.some(e => ['user', 'group', 'folder', 'analysis', 'dashboard', 'policy', 'invitation'].includes(e.key.kind)) ? 1 : 0;
        const policy = changes.some(e => e.key.kind === 'policy' || e.key.kind === 'source') ? 1 : 0;
        const configuration = changes.some(e => ['dataset', 'prepared-dataset', 'source', 'secret', 'ai-config'].includes(e.key.kind)) ? 1 : 0;
        await c.query('UPDATE h1_revisions SET "authorization" = "authorization" + ?, policy = policy + ?, configuration = configuration + ? WHERE tenant_id = ? AND namespace_id = ?',
          [authorization, policy, configuration, ...scopeValues(context)]);
        await appendMetadataEvent(c, context, 'metadata.changed');
      }
    }, true);
  }
}
