import { timingSafeEqual } from 'node:crypto';
import { MetadataError, type Database, type SqlConnection } from './metadata-db.js';
import { type TenantContext, TenantMetadata } from './metadata.js';
import { object, identifier } from './metadata-resources.js';
import { secretKey } from './hosted-config.js';
import { appendAudit, initializeEvents, safeEvent, type EventInput } from './hosted-events.js';

export interface UsageHook {
  eventId: string; type: 'usage.recorded' | 'entitlement.changed'; schemaRevision: 1;
  tenantId: string; namespaceId: string; interval: { start: string; end: string };
  resource: string; units: Record<string, number>;
}
const units = ['executionMs', 'sourceRows', 'workingBytes', 'running', 'queued', 'cacheBytes'] as const;
export async function appendHook(c: SqlConnection, input: UsageHook): Promise<void> {
  object(input, ['eventId', 'type', 'schemaRevision', 'tenantId', 'namespaceId', 'interval', 'resource', 'units']);
  identifier(input.eventId); identifier(input.tenantId); identifier(input.namespaceId); identifier(input.resource);
  if (!['usage.recorded', 'entitlement.changed'].includes(input.type) || input.schemaRevision !== 1) throw new MetadataError('USAGE_HOOK_INVALID');
  object(input.interval, ['start', 'end']); object(input.units, units);
  if (!Object.keys(input.units).length || Object.values(input.units).some(n => typeof n !== 'number' || !Number.isFinite(n) || n < 0)
    || [input.interval.start, input.interval.end].some(s => typeof s !== 'string' || !Number.isFinite(Date.parse(s)) || new Date(s).toISOString() !== s)
    || input.interval.end < input.interval.start) throw new MetadataError('USAGE_HOOK_INVALID');
  // Canonical order makes identical retries independent of caller object key order.
  const body = JSON.stringify({ eventId: input.eventId, type: input.type, schemaRevision: 1, tenantId: input.tenantId, namespaceId: input.namespaceId,
    interval: { start: input.interval.start, end: input.interval.end }, resource: input.resource,
    units: Object.fromEntries(Object.entries(input.units).sort(([a], [b]) => a.localeCompare(b))) });
  await c.query('INSERT INTO h8_hooks VALUES (?,?,?,?,0) ON CONFLICT (event_id) DO NOTHING', [input.eventId, input.tenantId, input.namespaceId, body]);
  const row = (await c.query('SELECT body FROM h8_hooks WHERE event_id = ?', [input.eventId]))[0];
  if (row?.body !== body) throw new MetadataError('USAGE_EVENT_ID_REUSED');
}
export async function initializeObservability(db: Database): Promise<void> {
  await initializeEvents(db);
  await db.transaction(c => c.query('CREATE TABLE IF NOT EXISTS h8_hooks (event_id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, namespace_id TEXT NOT NULL, body TEXT NOT NULL, delivered INTEGER NOT NULL)'));
}
export class HostedObservability {
  private requests = 0;
  private failures = 0;
  private latencyMs = 0;
  private jobs = 0;
  healthy = true;
  constructor(readonly db: Database, readonly metadata: TenantMetadata) {}
  readonly write = async (event: EventInput): Promise<void> => {
    const safe = safeEvent(event);
    try {
      await this.db.transaction(async c => {
        const persisted = await appendAudit(c, safe);
        if (safe.tenantId && safe.namespaceId && Object.values(safe.usage).some(n => n > 0)) {
          await appendHook(c, { eventId: persisted.eventId, type: 'usage.recorded', schemaRevision: 1, tenantId: safe.tenantId, namespaceId: safe.namespaceId,
            interval: { start: new Date(Date.parse(safe.at) - safe.latencyMs).toISOString(), end: safe.at }, resource: safe.jobId ?? safe.requestId ?? safe.eventId, units: safe.usage });
        }
      });
      this.healthy = true;
      if (!['job.execute', 'job.deliver', 'secret.read', 'secret.rotate', 'key.rotate', 'backup', 'restore', 'audit.read'].includes(event.operation)) { this.requests++; this.latencyMs += safe.latencyMs; }
      if (event.operation === 'job.execute') this.jobs++;
      if (event.outcome !== 'succeeded') this.failures++;
    } catch { this.healthy = false; throw new MetadataError('AUDIT_UNAVAILABLE', 503); }
  };
  async tenantAudit(context: TenantContext) {
    const user = await this.metadata.get(context, { kind: 'user', id: context.userId });
    if (user.body.role !== 'administrator') throw new MetadataError('AUDIT_ACCESS_DENIED', 403);
    // Recheck scope/revision under the same tenant lock as the audit read.
    return this.db.transaction(async c => {
      const row = (await c.query("UPDATE h1_tenants SET version = version WHERE tenant_id = ? AND state = 'active' RETURNING tenant_id", [context.tenantId]))[0];
      const revision = (await c.query('SELECT "authorization" FROM h1_revisions WHERE tenant_id = ? AND namespace_id = ?', [context.tenantId, context.namespaceId]))[0];
      if (!row || Number(revision?.authorization) !== context.authorizationRevision) throw new MetadataError('AUDIT_ACCESS_DENIED', 403);
      return (await c.query('SELECT body FROM h8_audit WHERE tenant_id = ? AND namespace_id = ? ORDER BY created_at DESC, event_id DESC LIMIT 100', [context.tenantId, context.namespaceId])).map(r => JSON.parse(String(r.body)) as ReturnType<typeof safeEvent>);
    });
  }
  /** Internal hook only. No client-controlled entitlement or suspension surface. */
  async hook(context: TenantContext, input: Omit<UsageHook, 'tenantId' | 'namespaceId'>): Promise<void> {
    await this.metadata.revisions(context);
    await this.db.transaction(async c => {
      const active = await c.query("UPDATE h1_tenants SET version = version WHERE tenant_id = ? AND state = 'active' RETURNING tenant_id", [context.tenantId]);
      const rev = (await c.query('SELECT "authorization" FROM h1_revisions WHERE tenant_id = ? AND namespace_id = ?', [context.tenantId, context.namespaceId]))[0];
      if (!active.length || Number(rev?.authorization) !== context.authorizationRevision) throw new MetadataError('TENANT_UNAVAILABLE', 403);
      await appendHook(c, { ...input, tenantId: context.tenantId, namespaceId: context.namespaceId });
    });
  }
  async pendingHooks(): Promise<UsageHook[]> {
    return this.db.transaction(async c => (await c.query('SELECT body FROM h8_hooks WHERE delivered = 0 ORDER BY event_id LIMIT 100')).map(r => JSON.parse(String(r.body)) as UsageHook));
  }
  async acknowledgeHook(eventId: string): Promise<void> {
    await this.db.transaction(c => c.query('UPDATE h8_hooks SET delivered = 1 WHERE event_id = ?', [identifier(eventId)]));
  }
  metrics() { return { requests: this.requests, failures: this.failures, requestLatencyMs: this.latencyMs, jobs: this.jobs, rssBytes: process.memoryUsage().rss }; }
}
/** Dedicated audit audience; provisioning and tenant-admin credentials cannot read across tenants. */
export function authorizeAuditOperator(authorization: string | undefined, env: NodeJS.ProcessEnv): void {
  const value = env.OPENSIGHT_AUDIT_OPERATOR_KEY;
  if (!value) throw new MetadataError('AUDIT_OPERATOR_REQUIRED', 403);
  const key = secretKey(value), candidate = Buffer.from(authorization?.startsWith('AuditOperator ') ? authorization.slice(14) : '', 'base64url');
  if (candidate.length !== key.length || !timingSafeEqual(key, candidate)) throw new MetadataError('AUDIT_OPERATOR_REQUIRED', 403);
}
