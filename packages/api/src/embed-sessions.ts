import { createHmac, randomBytes } from 'node:crypto';
import { hasCapability } from '@opensight/query-engine';
import { digest, equal } from './auth-crypto.js';
import { embedOrigin } from './embedding.js';
import { defaultEmbedConfig, validateEmbedConfig, type EmbedPolicy, type TenantEmbedConfig } from './embedding-config.js';
import { MetadataError, type Database, type SqlConnection, type SqlRow } from './metadata-db.js';
import { identifier, object } from './metadata-resources.js';
import { type TenantContext, TenantMetadata, type Revisions } from './metadata.js';

export function embedFailure(code = 'EMBED_REQUEST_INVALID', status = 400): never { throw new MetadataError(code, status); }
export type EmbedExperience = { kind: 'dashboard' | 'visual'; dashboardId: string; visualId?: string; sheetId?: string }
  | { kind: 'q'; datasetId: string } | { kind: 'console'; analysisId?: string };
export interface SessionGrant {
  tenantId: string; namespaceId: string; issuerId: string; userId: string; anonymous: boolean;
  virtualNamespace?: string; tags: Record<string, string>; authorizedResources: string[];
  experience: EmbedExperience; allowedDomains: string[]; origin: string; configRevision: number;
  revisions: Revisions; durationMinutes: number; request: Record<string, unknown>;
}
export interface EmbedSession extends SessionGrant { id: string; expiresAt: number; parentOrigin: string; channelId: string }
export interface EmbedKey { id: string; secret: Buffer }
export function embedSessionKey(env: NodeJS.ProcessEnv): EmbedKey | undefined {
  if (env.OPENSIGHT_EMBED_SESSION_KEY_ID === undefined && env.OPENSIGHT_EMBED_SESSION_KEY === undefined) return undefined;
  try {
    const id = identifier(env.OPENSIGHT_EMBED_SESSION_KEY_ID), secret = Buffer.from(env.OPENSIGHT_EMBED_SESSION_KEY ?? '', 'base64');
    if (secret.length !== 32 || secret.toString('base64') !== env.OPENSIGHT_EMBED_SESSION_KEY) throw new Error();
    return { id, secret };
  } catch { return embedFailure('EMBED_KEY_CONFIG_INVALID', 503); }
}
export async function initializeEmbedSessions(database: Database): Promise<void> {
  await database.transaction(async c => {
    await c.query('CREATE TABLE IF NOT EXISTS h6_keys (key_id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, active INTEGER NOT NULL)');
    await c.query(`CREATE TABLE IF NOT EXISTS h6_sessions (
      session_id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, namespace_id TEXT NOT NULL, issuer_id TEXT NOT NULL,
      key_id TEXT NOT NULL REFERENCES h6_keys(key_id), grant_body TEXT NOT NULL, bootstrap_hash TEXT NOT NULL,
      bootstrap_expires_at BIGINT NOT NULL, redeemed INTEGER NOT NULL DEFAULT 0, credential_hash TEXT,
      expires_at BIGINT, parent_origin TEXT, channel_id TEXT, revoked INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (tenant_id, namespace_id) REFERENCES h1_namespaces(tenant_id, namespace_id))`);
  });
}
/** Explicit operator rotation. Retired key IDs cannot be reactivated by stale nodes. */
export async function activateEmbedKey(database: Database, key: EmbedKey): Promise<void> {
  await database.transaction(async c => {
    await c.query('UPDATE h2_control SET id = id WHERE id = 1');
    const prior = (await c.query('SELECT * FROM h6_keys WHERE key_id = ?', [key.id]))[0];
    if (prior) {
      if (prior.fingerprint !== digest(key.secret) || Number(prior.active) !== 1) embedFailure('EMBED_KEY_REUSED', 503);
      return;
    }
    await c.query('UPDATE h6_keys SET active = 0 WHERE active = 1');
    await c.query('INSERT INTO h6_keys VALUES (?,?,1)', [key.id, digest(key.secret)]);
  });
}
function boundedString(value: unknown, max = 256): string {
  if (typeof value !== 'string' || !value.length || value.length > max || /[\x00-\x1f]/.test(value)) embedFailure();
  return value;
}
export function resourceArn(namespaceId: string, kind: string, id: string): string { return `urn:opensight:${namespaceId}:${kind}/${id}`; }
function arn(value: unknown, namespaceId: string, kind: string): string {
  const prefix = `urn:opensight:${namespaceId}:${kind}/`;
  if (typeof value !== 'string' || !value.startsWith(prefix)) embedFailure('EMBED_SUBJECT_UNRESOLVED', 403);
  return identifier(value.slice(prefix.length));
}
export function parseExperience(value: unknown): EmbedExperience {
  const r = object(value, ['Dashboard', 'DashboardVisual', 'QSearchBar', 'QuickSightConsole']);
  if (Object.keys(r).length !== 1) embedFailure();
  if (r.Dashboard) return { kind: 'dashboard', dashboardId: identifier(object(r.Dashboard, ['InitialDashboardId']).InitialDashboardId) };
  if (r.DashboardVisual) {
    const v = object(object(r.DashboardVisual, ['InitialDashboardVisualId']).InitialDashboardVisualId, ['DashboardId', 'SheetId', 'VisualId']);
    return { kind: 'visual', dashboardId: identifier(v.DashboardId), sheetId: identifier(v.SheetId), visualId: identifier(v.VisualId) };
  }
  if (r.QSearchBar) return { kind: 'q', datasetId: identifier(object(r.QSearchBar, ['InitialTopicId']).InitialTopicId) };
  const path = object(r.QuickSightConsole, ['InitialPath']).InitialPath ?? '/start';
  if (path === '/start') return { kind: 'console' };
  const match = typeof path === 'string' && /^\/start\/analyses\/([A-Za-z0-9_-]{1,512})$/.exec(path);
  if (!match) embedFailure();
  return { kind: 'console', analysisId: match[1]! };
}
export type AuthorizeEmbed = (context: TenantContext, grant: SessionGrant) => Promise<void>;
export class EmbedSessions {
  constructor(readonly database: Database, readonly metadata: TenantMetadata, readonly policy: EmbedPolicy,
    private readonly key: EmbedKey | undefined, private readonly authorize: AuthorizeEmbed, readonly clock = Date.now) {}
  async initialize(): Promise<void> {
    await initializeEmbedSessions(this.database);
    if (!this.key) return;
    await this.database.transaction(async c => {
      await c.query('UPDATE h2_control SET id = id WHERE id = 1');
      if (!(await c.query('SELECT key_id FROM h6_keys')).length) await c.query('INSERT INTO h6_keys VALUES (?,?,1)', [this.key!.id, digest(this.key!.secret)]);
      await this.checkKey(c, this.key!.id);
    });
  }
  private configured(): EmbedKey { return this.key ?? embedFailure('EMBEDDING_NOT_CONFIGURED', 503); }
  private async checkKey(c: SqlConnection, id: string): Promise<void> {
    const key = this.configured(), row = (await c.query('SELECT * FROM h6_keys WHERE key_id = ? AND active = 1', [id]))[0];
    if (!row || key.id !== id || !equal(String(row.fingerprint), digest(key.secret))) embedFailure('EMBED_KEY_REVOKED', 401);
  }
  private async membership(c: SqlConnection, tenantId: string, namespaceId: string, userId: string) {
    const row = (await c.query(`SELECT u.body FROM h2_memberships m JOIN h1_resources u
      ON u.tenant_id = m.tenant_id AND u.namespace_id = m.namespace_id AND u.resource_id = m.user_id AND u.kind = 'user' AND u.owner_id = ''
      WHERE m.tenant_id = ? AND m.namespace_id = ? AND m.user_id = ? AND m.status = 'active'`, [tenantId, namespaceId, userId]))[0];
    if (!row) embedFailure('EMBED_SUBJECT_UNRESOLVED', 403);
    return object(JSON.parse(String(row.body)));
  }
  private async configuration(c: SqlConnection, context: Pick<TenantContext, 'tenantId' | 'namespaceId'>) {
    const active = await c.query("UPDATE h1_tenants SET version = version WHERE tenant_id = ? AND state = 'active' RETURNING version", [context.tenantId]);
    if (!active.length) embedFailure('EMBED_SESSION_REVOKED', 401);
    const row = (await c.query('SELECT * FROM h5_embedding_config WHERE tenant_id = ? AND namespace_id = ?', [context.tenantId, context.namespaceId]))[0];
    const config = validateEmbedConfig(row ? JSON.parse(String(row.body)) : defaultEmbedConfig(), context.tenantId, this.policy);
    if (!config.enabled) embedFailure('EMBEDDING_NOT_CONFIGURED', 503);
    const r = (await c.query('SELECT "authorization", policy, configuration FROM h1_revisions WHERE tenant_id = ? AND namespace_id = ?', [context.tenantId, context.namespaceId]))[0]!;
    return { config, revision: Number(row!.revision), revisions: { authorization: Number(r.authorization), policy: Number(r.policy), configuration: Number(r.configuration) } };
  }
  private features(config: TenantEmbedConfig, g: SessionGrant): void {
    const e = g.experience;
    if (g.anonymous && !config.features.anonymous || e.kind === 'console' && !config.features.authoring
      || e.kind === 'dashboard' && !config.features.registeredDashboards || e.kind === 'visual' && !config.features.registeredVisuals) embedFailure('EMBED_FEATURE_UNSUPPORTED', 422);
  }
  private async check(c: SqlConnection, row: SqlRow): Promise<SessionGrant> {
    await this.checkKey(c, String(row.key_id));
    if (Number(row.revoked)) embedFailure('EMBED_SESSION_REVOKED', 401);
    const g = JSON.parse(String(row.grant_body)) as SessionGrant, current = await this.configuration(c, g);
    if (current.revision !== g.configRevision || JSON.stringify(current.revisions) !== JSON.stringify(g.revisions)) embedFailure('EMBED_SESSION_REVOKED', 401);
    await this.membership(c, g.tenantId, g.namespaceId, g.issuerId);
    const user = await this.membership(c, g.tenantId, g.namespaceId, g.userId);
    if (g.experience.kind === 'console' && (g.anonymous || !hasCapability(user.role as Parameters<typeof hasCapability>[0], 'build'))) embedFailure('EMBED_AUTHOR_REQUIRED', 403);
    if (g.allowedDomains.some(o => !this.policy.tenants.get(g.tenantId)?.allowedParentOrigins.includes(o))) embedFailure('EMBED_ORIGIN_DENIED', 403);
    this.features(current.config, g);
    return g;
  }
  private async context(g: SessionGrant): Promise<TenantContext> {
    const context = await this.metadata.authenticate(null, async () => ({ namespaceId: g.namespaceId, userId: g.userId }));
    if (context.tenantId !== g.tenantId || context.authorizationRevision !== g.revisions.authorization) embedFailure('EMBED_SESSION_REVOKED', 401);
    return context;
  }
  private async load(c: SqlConnection, id: string): Promise<SqlRow> {
    const row = (await c.query('SELECT * FROM h6_sessions WHERE session_id = ?', [identifier(id)]))[0];
    return row ?? embedFailure('INVALID_EMBED_TOKEN', 401);
  }
  async issue(context: TenantContext, raw: unknown, anonymous = false) {
    this.metadata.assertContext(context); this.configured();
    const input = object(structuredClone(raw), anonymous
      ? ['Namespace', 'AuthorizedResourceArns', 'ExperienceConfiguration', 'SessionLifetimeInMinutes', 'SessionTags', 'AllowedDomains']
      : ['UserArn', 'ExperienceConfiguration', 'SessionLifetimeInMinutes', 'AllowedDomains']);
    const experience = parseExperience(input.ExperienceConfiguration);
    const minutes = input.SessionLifetimeInMinutes === undefined ? 600 : input.SessionLifetimeInMinutes;
    if (!Number.isSafeInteger(minutes) || Number(minutes) < 15 || Number(minutes) > 600) embedFailure('EMBED_SESSION_LIMIT_EXCEEDED', 422);
    const userId = anonymous ? context.userId : input.UserArn === undefined ? context.userId : arn(input.UserArn, context.namespaceId, 'user');
    const tags: Record<string, string> = Object.create(null) as Record<string, string>;
    let authorizedResources: string[] = [], virtualNamespace: string | undefined;
    if (anonymous) {
      virtualNamespace = identifier(input.Namespace);
      if (!Array.isArray(input.AuthorizedResourceArns) || !input.AuthorizedResourceArns.length || input.AuthorizedResourceArns.length > 25) embedFailure();
      authorizedResources = input.AuthorizedResourceArns.map(v => resourceArn(context.namespaceId, 'dashboard', arn(v, context.namespaceId, 'dashboard')));
      if (experience.kind === 'console' || experience.kind === 'q') embedFailure('EMBED_FEATURE_UNSUPPORTED', 422);
      if (!authorizedResources.includes(resourceArn(context.namespaceId, 'dashboard', experience.dashboardId))) embedFailure('EMBED_SCOPE_DENIED', 403);
      if (input.SessionTags !== undefined) {
        if (!Array.isArray(input.SessionTags) || input.SessionTags.length > 50) embedFailure();
        for (const rawTag of input.SessionTags) { const tag = object(rawTag, ['Key', 'Value']), name = boundedString(tag.Key, 128); if (Object.hasOwn(tags, name)) embedFailure(); tags[name] = boundedString(tag.Value); }
      }
    }
    const snapshot = await this.database.transaction(async c => {
      const current = await this.configuration(c, context);
      if (current.revisions.authorization !== context.authorizationRevision) embedFailure('EMBED_SESSION_REVOKED', 401);
      const issuer = await this.membership(c, context.tenantId, context.namespaceId, context.userId);
      if ((anonymous || userId !== context.userId) && !hasCapability(issuer.role as Parameters<typeof hasCapability>[0], 'admin')) embedFailure('SECURITY_ADMIN_REQUIRED', 403);
      const user = await this.membership(c, context.tenantId, context.namespaceId, userId);
      if (experience.kind === 'console' && !hasCapability(user.role as Parameters<typeof hasCapability>[0], 'build')) embedFailure('EMBED_AUTHOR_REQUIRED', 403);
      if (Number(minutes) * 60 > current.config.maxSessionSeconds!) embedFailure('EMBED_SESSION_LIMIT_EXCEEDED', 422);
      let domains = current.config.allowedParentOrigins;
      if (input.AllowedDomains !== undefined) {
        if (!Array.isArray(input.AllowedDomains) || !input.AllowedDomains.length || input.AllowedDomains.length > 3) embedFailure('EMBED_ORIGIN_DENIED', 403);
        domains = input.AllowedDomains.map(embedOrigin);
        if (new Set(domains).size !== domains.length || domains.some(o => !this.policy.tenants.get(context.tenantId)?.allowedParentOrigins.includes(o))) embedFailure('EMBED_ORIGIN_DENIED', 403);
      }
      const grant: SessionGrant = { tenantId: context.tenantId, namespaceId: context.namespaceId, issuerId: context.userId, userId, anonymous,
        ...(virtualNamespace ? { virtualNamespace } : {}), tags, authorizedResources, experience, allowedDomains: domains,
        origin: this.policy.origins.get(current.config.embedOriginId!)!, configRevision: current.revision, revisions: current.revisions, durationMinutes: Number(minutes), request: input };
      this.features(current.config, grant); return grant;
    });
    await this.authorize(await this.context(snapshot), snapshot);
    const id = randomBytes(24).toString('base64url'), nonce = randomBytes(32).toString('base64url'), key = this.configured();
    const payload = `${key.id}.${id}.${nonce}`, signature = createHmac('sha256', key.secret).update(`OpenSight:embed:v2:${payload}:${digest(JSON.stringify(snapshot))}`).digest('base64url');
    const bootstrap = `${payload}.${signature}`, bootstrapExpiresAt = this.clock() + 300000;
    await this.database.transaction(async c => {
      const row = { key_id: key.id, revoked: 0, grant_body: JSON.stringify(snapshot) };
      await this.check(c, row);
      await c.query('INSERT INTO h6_sessions (session_id, tenant_id, namespace_id, issuer_id, key_id, grant_body, bootstrap_hash, bootstrap_expires_at) VALUES (?,?,?,?,?,?,?,?)',
        [id, snapshot.tenantId, snapshot.namespaceId, snapshot.issuerId, key.id, JSON.stringify(snapshot), digest(bootstrap), bootstrapExpiresAt]);
    });
    return { sessionId: id, EmbedUrl: `${snapshot.origin}/embed/sessions/${id}#bootstrap=${bootstrap}`, bootstrapExpiresAt: new Date(bootstrapExpiresAt).toISOString(),
      SessionLifetimeInMinutes: snapshot.durationMinutes, configRevision: snapshot.configRevision };
  }
  async shell(id: string) {
    return this.database.transaction(async c => {
      const row = await this.load(c, id), grant = await this.check(c, row);
      if (Number(row.redeemed)) embedFailure('EMBED_BOOTSTRAP_REPLAY', 401);
      if (Number(row.bootstrap_expires_at) <= this.clock()) embedFailure('EMBED_BOOTSTRAP_EXPIRED', 401);
      const config = (await this.configuration(c, grant)).config;
      return { sessionId: id, allowedDomains: grant.allowedDomains, appearance: config.appearance,
        assets: Object.fromEntries([...this.policy.assets].filter(([, a]) => a.tenantId === grant.tenantId).map(([id, a]) => [id, a.dataUrl])) };
    });
  }
  async redeem(id: string, raw: unknown) {
    const r = object(raw, ['bootstrap', 'parentOrigin', 'channelId']), parentOrigin = embedOrigin(r.parentOrigin), channelId = boundedString(r.channelId, 128);
    if (!/^[A-Za-z0-9_-]{32,128}$/.test(channelId) || typeof r.bootstrap !== 'string' || r.bootstrap.length > 2048) embedFailure();
    // Check before spending a bootstrap, then serialize the final revision check and consume.
    const grant = await this.database.transaction(async c => this.check(c, await this.load(c, id)));
    await this.authorize(await this.context(grant), grant);
    return this.database.transaction(async c => {
      const row = await this.load(c, id), g = await this.check(c, row);
      if (!equal(digest(String(r.bootstrap)), String(row.bootstrap_hash))) embedFailure('INVALID_EMBED_TOKEN', 401);
      if (!g.allowedDomains.includes(parentOrigin)) embedFailure('EMBED_ORIGIN_DENIED', 403);
      if (Number(row.redeemed)) embedFailure('EMBED_BOOTSTRAP_REPLAY', 401);
      if (Number(row.bootstrap_expires_at) <= this.clock()) embedFailure('EMBED_BOOTSTRAP_EXPIRED', 401);
      const credential = randomBytes(32).toString('base64url'), expiresAt = this.clock() + g.durationMinutes * 60000;
      const consumed = await c.query('UPDATE h6_sessions SET redeemed = 1, credential_hash = ?, expires_at = ?, parent_origin = ?, channel_id = ? WHERE session_id = ? AND redeemed = 0 AND revoked = 0 RETURNING session_id', [digest(credential), expiresAt, parentOrigin, channelId, id]);
      if (!consumed.length) embedFailure('EMBED_BOOTSTRAP_REPLAY', 401);
      return { credential, expiresAt, sessionId: id, experience: g.experience };
    });
  }
  async verify(id: string, credential: string): Promise<{ session: EmbedSession; context: TenantContext }> {
    const session = await this.database.transaction(async c => {
      const row = await this.load(c, id), g = await this.check(c, row);
      if (!/^[A-Za-z0-9_-]{43}$/.test(credential) || !row.credential_hash || !equal(digest(credential), String(row.credential_hash))) embedFailure('INVALID_EMBED_TOKEN', 401);
      if (!Number(row.redeemed) || Number(row.expires_at) <= this.clock()) embedFailure('EMBED_SESSION_EXPIRED', 401);
      return { ...g, id, expiresAt: Number(row.expires_at), parentOrigin: String(row.parent_origin), channelId: String(row.channel_id) };
    });
    const context = await this.context(session); await this.authorize(context, session); return { session, context };
  }
  async revoke(context: TenantContext, id: string): Promise<void> {
    this.metadata.assertContext(context);
    await this.metadata.revisions(context);
    await this.database.transaction(async c => {
      const row = await this.load(c, id);
      if (row.tenant_id !== context.tenantId || row.namespace_id !== context.namespaceId) embedFailure('RESOURCE_NOT_FOUND', 404);
      const issuer = await this.membership(c, context.tenantId, context.namespaceId, context.userId);
      if (row.issuer_id !== context.userId && !hasCapability(issuer.role as Parameters<typeof hasCapability>[0], 'admin')) embedFailure('EMBED_SCOPE_DENIED', 403);
      await c.query('UPDATE h6_sessions SET revoked = 1, credential_hash = NULL WHERE session_id = ?', [id]);
    });
  }
  async renew(context: TenantContext, id: string) {
    this.metadata.assertContext(context);
    const row = await this.database.transaction(c => this.load(c, id));
    if (row.tenant_id !== context.tenantId || row.namespace_id !== context.namespaceId || row.issuer_id !== context.userId) embedFailure('RESOURCE_NOT_FOUND', 404);
    if (Number(row.revoked)) embedFailure('EMBED_SESSION_REVOKED', 401);
    const grant = JSON.parse(String(row.grant_body)) as SessionGrant;
    const result = await this.issue(context, grant.request, grant.anonymous);
    try {
      await this.database.transaction(async c => {
        const won = await c.query('UPDATE h6_sessions SET revoked = 1, credential_hash = NULL WHERE session_id = ? AND revoked = 0 RETURNING session_id', [id]);
        if (!won.length) embedFailure('EMBED_SESSION_REVOKED', 401);
      });
    } catch (e) { await this.revoke(context, result.sessionId); throw e; }
    return result;
  }
}
