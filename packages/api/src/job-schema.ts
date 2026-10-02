import type { Database, SqlConnection, SqlRow } from './metadata-db.js';
import { MetadataError, missing } from './metadata-db.js';
import { identifier, object, type Scope } from './metadata-resources.js';
import type { Revisions } from './metadata.js';
import { enabled, validateSchedule, type Schedule } from './schedule.js';
import { validateAlert, type AlertCondition } from './alerts.js';

export type JobSpec = { kind: 'refresh'; target: { kind: 'source' | 'prepared-dataset' | 'dataset'; id: string }; enabled: boolean; schedule: Schedule }
  | { kind: 'report'; dashboardId: string; recipients: string[]; enabled: boolean; schedule: Schedule }
  | { kind: 'alert'; datasetId: string; dashboardId: string; visualId: string; fieldId: string; dimensions: Record<string, string | number | null>; condition: AlertCondition; recipients: string[]; enabled: boolean };
export interface Job extends Scope { id: string; ownerId: string; version: number; spec: JobSpec; nextRun: string | null; stopped: boolean; alertState: 'ok' | 'triggered' }
export interface Occurrence extends Scope {
  id: string; jobId: string; ownerId: string; initiatedBy: string; jobVersion: number; due: string;
  spec: JobSpec; revisions: Revisions; state: string; errorCode: string | null; createdAt: string; finishedAt: string | null;
}
export const scoped = 'tenant_id = ? AND namespace_id = ?';
export const scopeArgs = (s: Scope) => [s.tenantId, s.namespaceId];
export function jobSpec(raw: unknown): JobSpec {
  const b = object(raw);
  const active = enabled(b.enabled);
  if (b.kind === 'refresh') {
    object(b, ['kind', 'target', 'enabled', 'schedule']); const target = object(b.target, ['kind', 'id']);
    if (!['source', 'prepared-dataset', 'dataset'].includes(String(target.kind))) throw new MetadataError('JOB_TARGET_INVALID', 400);
    return { kind: 'refresh', target: { kind: target.kind as 'source' | 'prepared-dataset' | 'dataset', id: identifier(target.id) }, enabled: active, schedule: validateSchedule(b.schedule) };
  }
  if (!Array.isArray(b.recipients) || !b.recipients.length || b.recipients.length > 50 || new Set(b.recipients).size !== b.recipients.length) throw new MetadataError('JOB_RECIPIENT_INVALID', 400);
  const recipients = b.recipients.map(identifier);
  if (b.kind === 'report') {
    object(b, ['kind', 'dashboardId', 'recipients', 'enabled', 'schedule']);
    return { kind: 'report', dashboardId: identifier(b.dashboardId), enabled: active, schedule: validateSchedule(b.schedule), recipients };
  }
  if (b.kind !== 'alert') throw new MetadataError('JOB_KIND_INVALID', 400);
  const { kind: _kind, ...body } = b;
  const { id: _id, ...rule } = validateAlert('job', { ...body, recipients: ['validation@example.test'] });
  identifier(rule.datasetId); identifier(rule.dashboardId); identifier(rule.visualId);
  return { kind: 'alert', ...rule, recipients };
}
export function readJob(r: SqlRow): Job {
  return { tenantId: String(r.tenant_id), namespaceId: String(r.namespace_id), id: String(r.job_id), ownerId: String(r.owner_id), version: Number(r.version),
    spec: jobSpec(JSON.parse(String(r.spec))), nextRun: r.next_run as string | null, stopped: Number(r.stopped) === 1, alertState: r.alert_state as Job['alertState'] };
}
export function readOccurrence(r: SqlRow): Occurrence {
  return { tenantId: String(r.tenant_id), namespaceId: String(r.namespace_id), id: String(r.occurrence_id), jobId: String(r.job_id), ownerId: String(r.owner_id), initiatedBy: String(r.initiated_by),
    jobVersion: Number(r.job_version), spec: jobSpec(JSON.parse(String(r.spec))), revisions: JSON.parse(String(r.revisions)) as Revisions, due: String(r.due), state: String(r.state),
    errorCode: r.error_code as string | null, createdAt: String(r.created_at), finishedAt: r.finished_at as string | null };
}
export async function lockTenant(c: SqlConnection, s: Scope): Promise<void> {
  if (!(await c.query("UPDATE h1_tenants SET version = version WHERE tenant_id = ? AND state = 'active' AND NOT EXISTS (SELECT 1 FROM h8_restore_holds h WHERE h.tenant_id = h1_tenants.tenant_id) RETURNING tenant_id", [s.tenantId])).length) throw new MetadataError('TENANT_UNAVAILABLE', 403);
  if (!(await c.query(`SELECT namespace_id FROM h1_namespaces WHERE ${scoped}`, scopeArgs(s))).length) missing();
}
export async function member(c: SqlConnection, s: Scope, userId: string) {
  const rows = await c.query(`SELECT u.body, i.email FROM h2_memberships m JOIN h2_identities i ON i.subject = m.subject
    JOIN h1_resources u ON u.tenant_id = m.tenant_id AND u.namespace_id = m.namespace_id AND u.kind = 'user' AND u.owner_id = '' AND u.resource_id = m.user_id
    WHERE m.tenant_id = ? AND m.namespace_id = ? AND m.user_id = ? AND m.status = 'active' AND i.status = 'active'`, [...scopeArgs(s), identifier(userId)]);
  if (!rows[0]) throw new MetadataError('JOB_PRINCIPAL_UNAVAILABLE', 403);
  const body = object(JSON.parse(String(rows[0].body)));
  return { role: String(body.role), name: String(body.name), email: String(rows[0].email) };
}
export async function revisions(c: SqlConnection, s: Scope): Promise<Revisions> {
  const r = (await c.query(`SELECT "authorization", policy, configuration FROM h1_revisions WHERE ${scoped}`, scopeArgs(s)))[0];
  if (!r) missing();
  return { authorization: Number(r.authorization), policy: Number(r.policy), configuration: Number(r.configuration) };
}
export async function cancelJob(c: SqlConnection, s: Scope, id: string, code: string, now: string): Promise<void> {
  await c.query(`UPDATE h7_occurrences SET state = 'cancelled', error_code = ?, finished_at = ? WHERE ${scoped} AND job_id = ? AND state IN ('queued','running','delivering')`, [code, now, ...scopeArgs(s), id]);
  await c.query(`UPDATE h7_deliveries SET state = 'cancelled', error_code = ?, message = NULL WHERE ${scoped} AND job_id = ? AND state IN ('pending','sending')`, [code, ...scopeArgs(s), id]);
}
/** Private operator-owned tables; no grants to the H1 tenant role. */
export async function initializeJobs(db: Database): Promise<void> {
  await db.transaction(async c => {
    await c.query(`CREATE TABLE IF NOT EXISTS h7_jobs (
      tenant_id TEXT NOT NULL, namespace_id TEXT NOT NULL, job_id TEXT NOT NULL, owner_id TEXT NOT NULL,
      version INTEGER NOT NULL CHECK (version > 0), spec TEXT NOT NULL, next_run TEXT, stopped INTEGER NOT NULL DEFAULT 0 CHECK (stopped IN (0,1)),
      alert_state TEXT NOT NULL DEFAULT 'ok' CHECK (alert_state IN ('ok','triggered')),
      PRIMARY KEY (tenant_id, namespace_id, job_id), FOREIGN KEY (tenant_id, namespace_id) REFERENCES h1_namespaces(tenant_id, namespace_id),
      FOREIGN KEY (tenant_id, namespace_id, owner_id) REFERENCES h2_memberships(tenant_id, namespace_id, user_id))`);
    await c.query(`CREATE TABLE IF NOT EXISTS h7_occurrences (
      tenant_id TEXT NOT NULL, namespace_id TEXT NOT NULL, occurrence_id TEXT NOT NULL, job_id TEXT NOT NULL,
      owner_id TEXT NOT NULL, initiated_by TEXT NOT NULL, job_version INTEGER NOT NULL, due TEXT NOT NULL, spec TEXT NOT NULL, revisions TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('queued','running','delivering','succeeded','failed','cancelled')), error_code TEXT,
      created_at TEXT NOT NULL, finished_at TEXT, PRIMARY KEY (tenant_id, namespace_id, occurrence_id),
      UNIQUE (tenant_id, namespace_id, job_id, job_version, due),
      FOREIGN KEY (tenant_id, namespace_id, job_id) REFERENCES h7_jobs(tenant_id, namespace_id, job_id),
      FOREIGN KEY (tenant_id, namespace_id, owner_id) REFERENCES h2_memberships(tenant_id, namespace_id, user_id),
      FOREIGN KEY (tenant_id, namespace_id, initiated_by) REFERENCES h2_memberships(tenant_id, namespace_id, user_id))`);
    await c.query(`CREATE TABLE IF NOT EXISTS h7_deliveries (
      tenant_id TEXT NOT NULL, namespace_id TEXT NOT NULL, delivery_id TEXT NOT NULL, job_id TEXT NOT NULL, occurrence_id TEXT NOT NULL, recipient_id TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('pending','sending','sent','cancelled')), attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0), next_attempt TEXT NOT NULL,
      error_code TEXT, message TEXT, sent_at TEXT, PRIMARY KEY (tenant_id, namespace_id, delivery_id),
      UNIQUE (tenant_id, namespace_id, occurrence_id, recipient_id),
      FOREIGN KEY (tenant_id, namespace_id, occurrence_id) REFERENCES h7_occurrences(tenant_id, namespace_id, occurrence_id),
      FOREIGN KEY (tenant_id, namespace_id, job_id) REFERENCES h7_jobs(tenant_id, namespace_id, job_id),
      FOREIGN KEY (tenant_id, namespace_id, recipient_id) REFERENCES h2_memberships(tenant_id, namespace_id, user_id))`);
    await c.query(`CREATE TABLE IF NOT EXISTS h7_migrations (tenant_id TEXT NOT NULL, namespace_id TEXT NOT NULL, checksum TEXT NOT NULL,
      PRIMARY KEY (tenant_id, namespace_id), FOREIGN KEY (tenant_id, namespace_id) REFERENCES h1_namespaces(tenant_id, namespace_id))`);
  });
}
