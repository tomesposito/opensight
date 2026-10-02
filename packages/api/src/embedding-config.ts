import { hasCapability } from '@opensight/query-engine';
import { embedOrigin } from './embedding.js';
import { validatedPng } from './embed-assets.js';
import { MetadataError, type Database, type SqlConnection } from './metadata-db.js';
import { identifier, object } from './metadata-resources.js';
import type { TenantContext, TenantMetadata } from './metadata.js';
import { appendMetadataEvent } from './metadata-outbox.js';

const appearanceFields = ['palette', 'font', 'layout', 'productName', 'iframeTitle', 'logoAssetId', 'faviconAssetId'] as const;
const featureNames = ['registeredDashboards', 'registeredVisuals', 'parameterControls', 'filtering', 'anonymous', 'authoring', 'export', 'download', 'persistentReaderState'] as const;
type Features = Record<typeof featureNames[number], boolean>;
export interface EmbedAppearance {
  palette: 'navy' | 'teal' | 'plum'; font: 'system' | 'sans'; layout: 'comfortable' | 'compact';
  productName: string; iframeTitle: string; logoAssetId: string | null; faviconAssetId: string | null;
}
export interface TenantEmbedConfig {
  enabled: boolean; allowedParentOrigins: string[]; embedOriginId: string | null; maxSessionSeconds: number | null;
  appearance: EmbedAppearance; features: Features;
}
interface TenantPolicy { allowedParentOrigins: string[]; embedOriginIds: string[]; maxSessionSeconds: number }
interface Asset { tenantId: string; kind: 'logo' | 'favicon'; dataUrl: string }
export interface EmbedPolicy { origins: ReadonlyMap<string, string>; tenants: ReadonlyMap<string, TenantPolicy>; assets: ReadonlyMap<string, Asset> }
function fail(code = 'EMBED_CONFIG_INVALID', status = 422): never { throw new MetadataError(code, status); }
export const defaultAppearance: EmbedAppearance = { palette: 'navy', font: 'system', layout: 'comfortable', productName: 'OpenSight', iframeTitle: 'OpenSight dashboard', logoAssetId: null, faviconAssetId: null };
export function defaultEmbedConfig(): TenantEmbedConfig {
  return { enabled: false, allowedParentOrigins: [], embedOriginId: null, maxSessionSeconds: null, appearance: { ...defaultAppearance },
    features: { registeredDashboards: true, registeredVisuals: true, parameterControls: false, filtering: false, anonymous: false, authoring: false, export: false, download: false, persistentReaderState: false } };
}
export const embedCapabilities = Object.freeze({ registeredDashboards: true, registeredVisuals: true, parameterControls: false, filtering: false,
  anonymous: true, authoring: true, export: false, download: false, persistentReaderState: false,
  sessionIssuance: true, customDomains: false, appearancePreview: true, brandingRemoval: false });
function fields(raw: unknown, allowed?: readonly string[]): Record<string, unknown> {
  try { return object(raw, allowed); } catch { return fail(); }
}
function text(raw: unknown, maximum: number): string {
  // Plain labels only. Reject markup, URL/CSS syntax, encoded markup and bidi/control characters.
  if (typeof raw !== 'string' || !raw.trim() || raw.length > maximum || !/^[\p{L}\p{N} .,'’!?()\-]+$/u.test(raw)
    || /(?:javascript|expression|url)\s*\(/i.test(raw)) fail();
  return raw;
}
function selection<T extends string>(raw: unknown, allowed: readonly T[]): T {
  if (typeof raw !== 'string' || !allowed.includes(raw as T)) fail();
  return raw as T;
}
function origins(raw: unknown): string[] {
  if (!Array.isArray(raw) || raw.length > 64) fail();
  const result = raw.map(v => { try { return embedOrigin(v); } catch { return fail('EMBED_ORIGIN_DENIED', 403); } });
  if (new Set(result).size !== result.length) fail();
  return result;
}
function seconds(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw < 1) fail();
  return raw;
}
function assetId(raw: unknown, kind: Asset['kind'], tenantId: string, policy: EmbedPolicy): string | null {
  if (raw === null) return null;
  const asset = typeof raw === 'string' ? policy.assets.get(raw) : undefined;
  if (!asset || asset.tenantId !== tenantId || asset.kind !== kind) fail('EMBED_ASSET_UNAVAILABLE', 422);
  return raw as string;
}
export function validateEmbedConfig(raw: unknown, tenantId: string, policy: EmbedPolicy): TenantEmbedConfig {
  const input = fields(raw, ['enabled', 'allowedParentOrigins', 'embedOriginId', 'maxSessionSeconds', 'appearance', 'features']);
  if (typeof input.enabled !== 'boolean') fail();
  const parents = origins(input.allowedParentOrigins), tenant = policy.tenants.get(tenantId);
  if (parents.some(o => !tenant?.allowedParentOrigins.includes(o))) fail('EMBED_ORIGIN_DENIED', 403);
  const originId = input.embedOriginId;
  if (originId !== null && (typeof originId !== 'string' || !tenant?.embedOriginIds.includes(originId) || !policy.origins.has(originId))) fail('EMBED_ORIGIN_DENIED', 403);
  const maximum = input.maxSessionSeconds === null ? null : seconds(input.maxSessionSeconds);
  if (maximum !== null && (!tenant || maximum > tenant.maxSessionSeconds)) fail('EMBED_SESSION_LIMIT_EXCEEDED');
  if (input.enabled && (!parents.length || originId === null || maximum === null)) fail('EMBEDDING_NOT_CONFIGURED', 503);
  const a = fields(input.appearance, appearanceFields);
  const appearance: EmbedAppearance = { palette: selection(a.palette, ['navy', 'teal', 'plum']), font: selection(a.font, ['system', 'sans']),
    layout: selection(a.layout, ['comfortable', 'compact']), productName: text(a.productName, 80), iframeTitle: text(a.iframeTitle, 160),
    logoAssetId: assetId(a.logoAssetId, 'logo', tenantId, policy), faviconAssetId: assetId(a.faviconAssetId, 'favicon', tenantId, policy) };
  const flags = fields(input.features), features = {} as Features;
  if (Object.keys(flags).some(k => !featureNames.includes(k as typeof featureNames[number]))) fail('EMBED_FEATURE_UNSUPPORTED');
  for (const name of featureNames) {
    if (typeof flags[name] !== 'boolean') fail();
    if (flags[name] && !embedCapabilities[name]) fail('EMBED_FEATURE_UNSUPPORTED');
    features[name] = flags[name];
  }
  return { enabled: input.enabled, allowedParentOrigins: parents, embedOriginId: originId as string | null, maxSessionSeconds: maximum, appearance, features };
}

/** No tenant-controlled host, redirect or URL. H11 routing is intentionally unavailable:
 * every registry entry must resolve to this node's trusted canonical HTTPS origin. */
export function embeddingPolicy(env: NodeJS.ProcessEnv, publicOrigin: string): EmbedPolicy {
  const originMap = new Map<string, string>(), tenants = new Map<string, TenantPolicy>(), assets = new Map<string, Asset>();
  if (env.OPENSIGHT_EMBEDDING_POLICY === undefined) return { origins: originMap, tenants, assets };
  try {
    if (env.OPENSIGHT_EMBEDDING_POLICY.length > 8 * 1024 * 1024) fail();
    const raw = fields(JSON.parse(env.OPENSIGHT_EMBEDDING_POLICY), ['origins', 'tenants', 'assets']);
    for (const k of ['origins', 'tenants', 'assets']) if (!Array.isArray(raw[k]) || raw[k].length > 1024) fail();
    for (const entry of raw.origins as unknown[]) {
      const o = fields(entry, ['id', 'origin']), id = identifier(o.id);
      if (originMap.has(id) || embedOrigin(o.origin) !== publicOrigin) fail();
      originMap.set(id, publicOrigin);
    }
    for (const entry of raw.tenants as unknown[]) {
      const t = fields(entry, ['tenantId', 'allowedParentOrigins', 'embedOriginIds', 'maxSessionSeconds']), id = identifier(t.tenantId);
      if (tenants.has(id) || !Array.isArray(t.embedOriginIds) || t.embedOriginIds.length > 64
        || t.embedOriginIds.some(v => typeof v !== 'string' || !originMap.has(v)) || new Set(t.embedOriginIds).size !== t.embedOriginIds.length) fail();
      tenants.set(id, { allowedParentOrigins: origins(t.allowedParentOrigins), embedOriginIds: t.embedOriginIds as string[], maxSessionSeconds: seconds(t.maxSessionSeconds) });
    }
    for (const entry of raw.assets as unknown[]) {
      const a = fields(entry, ['id', 'tenantId', 'kind', 'pngBase64']), id = identifier(a.id), tenantId = identifier(a.tenantId);
      if (assets.has(id) || !tenants.has(tenantId)) fail();
      assets.set(id, { tenantId, kind: selection(a.kind, ['logo', 'favicon']), dataUrl: validatedPng(a.pngBase64) });
    }
    return { origins: originMap, tenants, assets };
  } catch { throw new MetadataError('EMBED_OPERATOR_CONFIG_INVALID', 503); }
}
export function expectedEmbedRevision(raw: unknown): number {
  if (raw === undefined) fail('EMBED_REVISION_REQUIRED', 428);
  if (typeof raw !== 'string' || !/^"(?:0|[1-9]\d*)"$/.test(raw) || !Number.isSafeInteger(Number(raw.slice(1, -1)))) fail('EMBED_CONFIG_INVALID', 400);
  return Number(raw.slice(1, -1));
}

/** Operator-owned table, like H2 session metadata; do not grant tenant SQL roles access. */
export async function initializeEmbedding(database: Database): Promise<void> {
  await database.transaction(c => c.query(`CREATE TABLE IF NOT EXISTS h5_embedding_config (
    tenant_id TEXT PRIMARY KEY, namespace_id TEXT NOT NULL, revision INTEGER NOT NULL CHECK (revision > 0), body TEXT NOT NULL,
    FOREIGN KEY (tenant_id, namespace_id) REFERENCES h1_namespaces(tenant_id, namespace_id))`));
}
export class HostedEmbedding {
  constructor(private readonly database: Database, private readonly metadata: TenantMetadata, private readonly policy: EmbedPolicy) {}
  private async checked<T>(context: TenantContext, work: (c: SqlConnection) => Promise<T>): Promise<T> {
    this.metadata.assertContext(context);
    return this.database.transaction(async c => {
      const active = await c.query("UPDATE h1_tenants SET version = version WHERE tenant_id = ? AND state = 'active' RETURNING version", [context.tenantId]);
      if (!active.length) fail('TENANT_UNAVAILABLE', 403);
      const rows = await c.query(`SELECT u.body, r."authorization" FROM h1_resources u
        JOIN h1_revisions r ON r.tenant_id = u.tenant_id AND r.namespace_id = u.namespace_id
        JOIN h2_memberships m ON m.tenant_id = u.tenant_id AND m.namespace_id = u.namespace_id AND m.user_id = u.resource_id
        WHERE u.tenant_id = ? AND u.namespace_id = ? AND u.kind = 'user' AND u.owner_id = '' AND u.resource_id = ? AND m.status = 'active'`,
      [context.tenantId, context.namespaceId, context.userId]);
      if (!rows[0] || Number(rows[0].authorization) !== context.authorizationRevision) fail('AUTHORIZATION_REVISED', 403);
      const user = object(JSON.parse(String(rows[0].body)));
      if (!hasCapability(user.role as Parameters<typeof hasCapability>[0], 'admin')) fail('SECURITY_ADMIN_REQUIRED', 403);
      return work(c);
    });
  }
  private async current(c: SqlConnection, context: TenantContext) {
    const rows = await c.query('SELECT revision, body FROM h5_embedding_config WHERE tenant_id = ? AND namespace_id = ?', [context.tenantId, context.namespaceId]);
    return { revision: rows[0] ? Number(rows[0].revision) : 0, config: rows[0] ? JSON.parse(String(rows[0].body)) as unknown : defaultEmbedConfig() };
  }
  private result(config: TenantEmbedConfig, revision: number, tenantId: string) {
    const tenant = this.policy.tenants.get(tenantId);
    return { config, revision, capabilities: embedCapabilities,
      policy: { allowedParentOrigins: tenant?.allowedParentOrigins ?? [], embedOrigins: (tenant?.embedOriginIds ?? []).map(id => ({ id, origin: this.policy.origins.get(id)! })),
        maxSessionSeconds: tenant?.maxSessionSeconds ?? null, assets: [...this.policy.assets].filter(([, a]) => a.tenantId === tenantId).map(([id, a]) => ({ id, kind: a.kind })) } };
  }
  async get(context: TenantContext) {
    return this.checked(context, async c => {
      const current = await this.current(c, context);
      // Revalidate against current operator policy on every read; never silently widen or serve stale policy.
      return this.result(validateEmbedConfig(current.config, context.tenantId, this.policy), current.revision, context.tenantId);
    });
  }
  async put(context: TenantContext, raw: unknown, expectedRevision: number) {
    const snapshot = structuredClone(raw);
    return this.checked(context, async c => {
      const current = await this.current(c, context);
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) fail('EMBED_CONFIG_INVALID', 400);
      if (current.revision !== expectedRevision) fail('EMBED_CONFIG_REVISION_CONFLICT', 412);
      const config = validateEmbedConfig(snapshot, context.tenantId, this.policy), revision = current.revision + 1;
      if (current.revision) await c.query('UPDATE h5_embedding_config SET revision = ?, body = ? WHERE tenant_id = ? AND namespace_id = ?', [revision, JSON.stringify(config), context.tenantId, context.namespaceId]);
      else await c.query('INSERT INTO h5_embedding_config VALUES (?,?,?,?)', [context.tenantId, context.namespaceId, revision, JSON.stringify(config)]);
      // Conservative H2 behavior: all replacements revoke existing tenant API sessions.
      // H6 must bind embed grants to this revision; H5 cannot mint such grants.
      await c.query('UPDATE h1_revisions SET configuration = configuration + 1 WHERE tenant_id = ? AND namespace_id = ?', [context.tenantId, context.namespaceId]);
      await c.query('UPDATE h2_sessions SET revoked = 1 WHERE tenant_id = ?', [context.tenantId]);
      await appendMetadataEvent(c, context, 'embedding.config.changed');
      return this.result(config, revision, context.tenantId);
    });
  }
}
