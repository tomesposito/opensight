import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { MetadataError, type Database, type SqlConnection } from './metadata-db.js';

const operations = ['request', 'job.execute', 'job.deliver', 'secret.read', 'secret.rotate', 'key.rotate', 'backup', 'restore', 'audit.read'] as const;
export type Operation = typeof operations[number];
export interface EventInput {
  operation: Operation; tenantId?: string; namespaceId?: string; requestId?: string; jobId?: string;
  resourceRevision?: number; outcome: 'succeeded' | 'failed' | 'denied'; errorCode?: string;
  latencyMs?: number; usage?: { executionMs?: number; sourceRows?: number; workingBytes?: number };
}
export const eventContext = new AsyncLocalStorage<{ requestId?: string; jobId?: string }>();
const opaque = (s: unknown): string | undefined => typeof s === 'string' && /^[A-Za-z0-9_-]{1,512}$/.test(s) ? s : undefined;
const count = (n: unknown): number => typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : 0;
/** An allowlist, not recursive redaction: request/body/error objects never enter telemetry. */
export function safeEvent(input: EventInput) {
  if (!operations.includes(input.operation) || !['succeeded', 'failed', 'denied'].includes(input.outcome)) throw new MetadataError('AUDIT_EVENT_INVALID');
  return { schemaRevision: 1, eventId: randomUUID(), at: new Date().toISOString(), operation: input.operation,
    requestId: opaque(input.requestId ?? eventContext.getStore()?.requestId), jobId: opaque(input.jobId ?? eventContext.getStore()?.jobId),
    tenantId: opaque(input.tenantId), namespaceId: opaque(input.namespaceId), resourceRevision: count(input.resourceRevision),
    outcome: input.outcome, errorCode: typeof input.errorCode === 'string' && /^[A-Z][A-Z0-9_]{0,79}$/.test(input.errorCode) ? input.errorCode : undefined,
    latencyMs: count(input.latencyMs), usage: { executionMs: count(input.usage?.executionMs), sourceRows: count(input.usage?.sourceRows), workingBytes: count(input.usage?.workingBytes) } };
}
export async function initializeEvents(db: Database): Promise<void> {
  await db.transaction(async c => {
    await c.query('CREATE TABLE IF NOT EXISTS h8_audit (event_id TEXT PRIMARY KEY, tenant_id TEXT, namespace_id TEXT, created_at TEXT NOT NULL, body TEXT NOT NULL)');
    await c.query('CREATE INDEX IF NOT EXISTS h8_audit_scope ON h8_audit (tenant_id, namespace_id, created_at)');
    await c.query('CREATE TABLE IF NOT EXISTS h8_encryption (id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL, fingerprint TEXT NOT NULL)');
  });
}
export async function appendAudit(c: SqlConnection, input: EventInput): Promise<void> {
  const event = safeEvent(input);
  await c.query('INSERT INTO h8_audit VALUES (?,?,?,?,?)', [event.eventId, event.tenantId ?? null, event.namespaceId ?? null, event.at, JSON.stringify(event)]);
}
export type AuditWriter = (event: EventInput) => Promise<void>;
export const auditWriter = (db: Database): AuditWriter => event => db.transaction(c => appendAudit(c, event));
