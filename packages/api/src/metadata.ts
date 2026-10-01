import { hasCapability } from '@opensight/query-engine';
import { MetadataError, missing, type Database, type SqlConnection, type SqlRow } from './metadata-db.js';
import { identifier, insertLinks, insertResource, resourceKey, resourceKinds, resourceLinks, type MetadataKind, type MetadataResource, type ResourceKey, type Scope } from './metadata-resources.js';
import type { JsonObject } from './mapping.js';
import { appendMetadataEvent } from './metadata-outbox.js';

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
  constructor(private readonly tenantDatabase: Database, private readonly membershipDatabase: Database) {}

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
  private context(context: TenantContext): void {
    if (!context || !this.#contexts.has(context)) throw new MetadataError('TENANT_CONTEXT_REQUIRED', 401);
  }
  private key(context: TenantContext, key: ResourceKey): ResourceKey {
    const normalized = resourceKey(key);
    if (normalized.ownerId && normalized.ownerId !== context.userId) missing();
    return normalized;
  }
  private async checked<T>(context: TenantContext, work: (c: SqlConnection, revisions: Revisions, user: JsonObject) => Promise<T>): Promise<T> {
    this.context(context);
    return this.tenantDatabase.transaction(async c => {
      // Serialize admission with tenant edits and lifecycle transitions on both engines.
      const tenants = await c.query("UPDATE h1_tenants SET version = version WHERE tenant_id = ? AND state = 'active' RETURNING version", [context.tenantId]);
      if (!tenants.length) throw new MetadataError('TENANT_UNAVAILABLE', 403);
      const rows = await c.query('SELECT "authorization", policy, configuration FROM h1_revisions WHERE tenant_id = ? AND namespace_id = ?', scopeValues(context));
      const rev = rows[0];
      if (!rev || Number(rev.authorization) !== context.authorizationRevision) throw new MetadataError('AUTHORIZATION_REVISED', 403);
      const users = await c.query(`SELECT body FROM h1_resources WHERE ${predicates}`, keyValues(context, { kind: 'user', id: context.userId }));
      if (!users[0]) throw new MetadataError('UNKNOWN_PRINCIPAL', 403);
      return work(c, { authorization: Number(rev.authorization), policy: Number(rev.policy), configuration: Number(rev.configuration) }, JSON.parse(String(users[0].body)) as JsonObject);
    }, context);
  }
  async get(context: TenantContext, key: ResourceKey): Promise<MetadataResource> {
    return this.checked(context, async c => {
      const rows = await c.query(`SELECT * FROM h1_resources WHERE ${predicates}`, keyValues(context, this.key(context, key)));
      return rows[0] ? resource(rows[0]) : missing();
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
  async batch(context: TenantContext, edits: readonly MetadataEdit[], expectedRevisions?: Revisions): Promise<void> {
    this.context(context);
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
    });
  }
}
