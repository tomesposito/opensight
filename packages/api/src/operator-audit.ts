import { createHash, randomUUID } from 'node:crypto';
import { MetadataError, type Database, type SqlConnection, type SqlRow } from './metadata-db.js';

/** The deployment has one operator identity; every operator-plane mutation is attributed to it. */
export const OPERATOR_ACTOR = 'deployment-operator';

/** Marker replacing any secret-bearing value before it reaches the audit log. */
export const AUDIT_REDACTED = '[redacted]';

/**
 * Version of the audit schema managed by this code. Bumped only with an explicit
 * additive upgrade path in initializeAudit; the marker mismatch then fails closed.
 */
export const AUDIT_SCHEMA_VERSION = 1;

/** Canonical DDL the checksum contract covers. Column names are fixed constants, never caller input. */
const AUDIT_SCHEMA_STATEMENTS = [
  'CREATE TABLE h8_audit (event_id TEXT PRIMARY KEY, created_at TEXT NOT NULL, action TEXT NOT NULL)',
  `ALTER TABLE h8_audit ADD COLUMN actor TEXT NOT NULL DEFAULT '${OPERATOR_ACTOR}'`,
  'ALTER TABLE h8_audit ADD COLUMN tenant_id TEXT',
  'ALTER TABLE h8_audit ADD COLUMN subject TEXT',
  'ALTER TABLE h8_audit ADD COLUMN detail TEXT',
];
export const auditSchemaChecksum = createHash('sha256').update(AUDIT_SCHEMA_STATEMENTS.join('\n')).digest('hex');

/** Detail keys whose values must never appear in the audit log, matched case-insensitively. */
const SECRET_DETAIL_KEY = /token|secret|password|fingerprint|credential|totp|seal|signingkey|privatekey|authorization/i;

export interface OperatorAuditInput {
  actor?: string;
  action: string;
  tenantId?: string;
  subject?: string;
  detail?: unknown;
}
export interface OperatorAuditEntry {
  eventId: string;
  createdAt: string;
  actor: string;
  action: string;
  tenantId: string | null;
  subject: string | null;
  detail: unknown;
}

/**
 * Recursively replace secret-bearing detail fields with a marker. Safe on
 * circular structures and never throws; conservative by design — an over-wide
 * key match only costs a detail field, never a secret.
 */
export function redactAuditDetail(value: unknown, seen = new Set<unknown>()): unknown {
  if (Array.isArray(value)) return value.map(item => redactAuditDetail(item, seen));
  if (value !== null && typeof value === 'object') {
    if (seen.has(value)) return AUDIT_REDACTED;
    seen.add(value);
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) out[key] = SECRET_DETAIL_KEY.test(key) ? AUDIT_REDACTED : redactAuditDetail(item, seen);
    return out;
  }
  return value;
}

function text(value: unknown, field: string, max: number): string | null {
  if (value === undefined) return null;
  if (typeof value !== 'string' || !value || value.length > max) throw new MetadataError('METADATA_INVALID', 400);
  return value;
}

async function addColumn(c: SqlConnection, column: string, definition: string): Promise<void> {
  // Column names are fixed constants, never caller input. The savepoint keeps a
  // duplicate-column failure from aborting the caller's transaction on Postgres.
  await c.query('SAVEPOINT opensight_audit_migrate');
  try {
    await c.query(`ALTER TABLE h8_audit ADD COLUMN ${column} ${definition}`);
    await c.query('RELEASE SAVEPOINT opensight_audit_migrate');
  } catch (error) {
    await c.query('ROLLBACK TO SAVEPOINT opensight_audit_migrate');
    await c.query('RELEASE SAVEPOINT opensight_audit_migrate');
    const code = error !== null && typeof error === 'object' && 'code' in error ? String(error.code) : '';
    const message = error instanceof Error ? error.message : '';
    if (code === '42701' || /duplicate column/i.test(message)) return; // already migrated
    throw error;
  }
}

/**
 * OWNER MIGRATION PATH ONLY. Applies the audit schema idempotently and records
 * the version/checksum marker in h8_audit_schema. Must run inside the caller's
 * serialized owner migration transaction (advisory lock held by
 * migrateRuntime/migrateServerless) — it is the only place audit DDL happens.
 * Runtime append/read paths never call this; they do no DDL.
 *
 * Additive migration over the H8 audit table. Legacy rows keep their original
 * action and timestamp and are attributed to the single deployment operator
 * identity, which is the only actor that could have written them.
 */
export async function initializeAudit(c: SqlConnection): Promise<void> {
  await c.query('CREATE TABLE IF NOT EXISTS h8_audit_schema (id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL, checksum TEXT NOT NULL)');
  const marker = (await c.query('SELECT version, checksum FROM h8_audit_schema WHERE id = 1'))[0];
  if (marker) {
    if (Number(marker.version) !== AUDIT_SCHEMA_VERSION || String(marker.checksum) !== auditSchemaChecksum)
      throw new MetadataError('AUDIT_SCHEMA_MISMATCH', 503);
    return;
  }
  await c.query('CREATE TABLE IF NOT EXISTS h8_audit (event_id TEXT PRIMARY KEY, created_at TEXT NOT NULL, action TEXT NOT NULL)');
  await addColumn(c, 'actor', `TEXT NOT NULL DEFAULT '${OPERATOR_ACTOR}'`);
  await addColumn(c, 'tenant_id', 'TEXT');
  await addColumn(c, 'subject', 'TEXT');
  await addColumn(c, 'detail', 'TEXT');
  await c.query('INSERT INTO h8_audit_schema VALUES (1,?,?)', [AUDIT_SCHEMA_VERSION, auditSchemaChecksum]);
}

function schemaMissing(error: unknown): boolean {
  const code = error !== null && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  if (code === '42P01' || code === '42703') return true; // postgres: undefined_table / undefined_column
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /no such table|no such column|relation .* does not exist/i.test(message); // sqlite / text fallback
}

/**
 * Runs the audit DML with no DDL. A missing or legacy table surfaces as
 * AUDIT_SCHEMA_NOT_MIGRATED (fail-closed: the operator migration must run)
 * instead of attempting schema changes the runtime role is not privileged for.
 */
async function withoutDdl<T>(work: () => Promise<T>): Promise<T> {
  try { return await work(); }
  catch (error) {
    if (error instanceof MetadataError) throw error;
    if (schemaMissing(error)) throw new MetadataError('AUDIT_SCHEMA_NOT_MIGRATED', 503);
    throw error;
  }
}

/** Append within the mutation's own transaction: a rolled-back mutation leaves no entry. */
export async function appendOperatorAudit(c: SqlConnection, input: OperatorAuditInput, now = Date.now()): Promise<void> {
  const action = text(input.action, 'action', 128);
  if (action === null) throw new MetadataError('METADATA_INVALID', 400);
  const actor = text(input.actor ?? OPERATOR_ACTOR, 'actor', 128) ?? OPERATOR_ACTOR;
  const detail = input.detail === undefined ? null : JSON.stringify(redactAuditDetail(input.detail));
  await withoutDdl(() => c.query('INSERT INTO h8_audit (event_id, created_at, actor, action, tenant_id, subject, detail) VALUES (?,?,?,?,?,?,?)',
    [randomUUID(), new Date(now).toISOString(), actor, action,
      text(input.tenantId, 'tenantId', 512), text(input.subject, 'subject', 512), detail]));
}

function stored(row: SqlRow): OperatorAuditEntry {
  let detail: unknown = null;
  if (row.detail !== null) { try { detail = JSON.parse(String(row.detail)); } catch { detail = AUDIT_REDACTED; } }
  return { eventId: String(row.event_id), createdAt: String(row.created_at), actor: String(row.actor), action: String(row.action),
    tenantId: row.tenant_id === null ? null : String(row.tenant_id), subject: row.subject === null ? null : String(row.subject), detail };
}

/** Operator review read path: newest first, bounded. Operator authentication is the caller's job. */
export async function readOperatorAudit(db: Database, options: { limit?: number } = {}): Promise<OperatorAuditEntry[]> {
  const limit = options.limit ?? 50;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new MetadataError('METADATA_INVALID', 400);
  return db.transaction(async c => withoutDdl(async () => {
    const rows = await c.query('SELECT event_id, created_at, actor, action, tenant_id, subject, detail FROM h8_audit ORDER BY created_at DESC LIMIT ?', [limit]);
    return rows.map(stored);
  }));
}
