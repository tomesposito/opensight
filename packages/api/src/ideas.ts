import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { MetadataError, type Database, type SqlConnection, type SqlRow } from './metadata-db.js';
import type { TenantContext } from './metadata.js';
import { appendOperatorAudit } from './operator-audit.js';

// The API package metadata ships with both single-node and serverless builds.
const packageInfo = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };

export const ideaStatuses = ['received', 'under_review', 'accepted', 'declined', 'shipped'] as const;
export type IdeaStatus = typeof ideaStatuses[number];
export const declineCategories = ['not-aligned', 'duplicate', 'not-feasible', 'later'] as const;
export type DeclineCategory = typeof declineCategories[number];
export interface Idea {
  id: string; tenantId: string; namespaceId: string; userId: string; name: string | null; email: string | null;
  title: string; description: string; surface: string; productVersion: string; status: IdeaStatus;
  declineCategory: DeclineCategory | null; declineNote: string | null; shippedReference: string | null;
  createdAt: string; updatedAt: string;
}
export async function initializeIdeas(db: Database): Promise<void> {
  await db.transaction(async c => {
    await c.query(`CREATE TABLE IF NOT EXISTS h8_ideas (
      id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, namespace_id TEXT NOT NULL, user_id TEXT NOT NULL,
      name TEXT, email TEXT, title TEXT NOT NULL, description TEXT NOT NULL, surface TEXT NOT NULL,
      product_version TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('received','under_review','accepted','declined','shipped')),
      decline_category TEXT, decline_note TEXT, shipped_reference TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
    await c.query('CREATE INDEX IF NOT EXISTS h8_ideas_submitter ON h8_ideas (tenant_id, namespace_id, user_id, created_at, id)');
    await c.query('CREATE INDEX IF NOT EXISTS h8_ideas_review ON h8_ideas (status, created_at, id)');
  });
}
function invalid(code = 'IDEA_INVALID'): never { throw new MetadataError(code, 400); }
function field(value: unknown, max: number, multiline = false, code = 'IDEA_INVALID'): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max
    || (multiline ? /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/ : /[\x00-\x1f\x7f-\x9f\u2028\u2029]/).test(value)) invalid(code);
  return value.trim();
}
export function ideaStatus(value: unknown): IdeaStatus {
  if (!ideaStatuses.includes(value as IdeaStatus)) invalid('IDEA_STATUS_INVALID');
  return value as IdeaStatus;
}
function stored(row: SqlRow): Idea {
  const nullable = (key: string) => row[key] === null ? null : String(row[key]);
  return { id: String(row.id), tenantId: String(row.tenant_id), namespaceId: String(row.namespace_id), userId: String(row.user_id),
    name: nullable('name'), email: nullable('email'), title: String(row.title), description: String(row.description),
    surface: String(row.surface), productVersion: String(row.product_version), status: ideaStatus(row.status),
    declineCategory: nullable('decline_category') as DeclineCategory | null, declineNote: nullable('decline_note'),
    shippedReference: nullable('shipped_reference'), createdAt: String(row.created_at), updatedAt: String(row.updated_at) };
}
/** Recheck durable membership inside the read/write transaction, including lifecycle races. */
async function member(c: SqlConnection, context: TenantContext): Promise<{ name: string | null; email: string | null }> {
  if (!(await c.query("UPDATE h1_tenants SET version = version WHERE tenant_id = ? AND state = 'active' RETURNING tenant_id", [context.tenantId])).length)
    throw new MetadataError('TENANT_UNAVAILABLE', 403);
  const row = (await c.query(`SELECT u.body, i.email FROM h2_memberships m
    JOIN h2_identities i ON i.subject = m.subject AND i.status = 'active'
    JOIN h1_resources u ON u.tenant_id = m.tenant_id AND u.namespace_id = m.namespace_id AND u.resource_id = m.user_id AND u.kind = 'user' AND u.owner_id = ''
    WHERE m.tenant_id = ? AND m.namespace_id = ? AND m.user_id = ? AND m.status = 'active'`, [context.tenantId, context.namespaceId, context.userId]))[0];
  if (!row) throw new MetadataError('PRINCIPAL_REQUIRED', 401);
  const user = JSON.parse(String(row.body)) as { name?: unknown; email?: unknown };
  return { name: typeof user.name === 'string' ? user.name : null, email: typeof user.email === 'string' ? user.email : typeof row.email === 'string' ? row.email : null };
}
/** Five attempts per ten minutes per tenant/namespace/user, durable across invocations.
 * Reserve before validation; malformed submissions consume the same bucket. */
export async function limitIdeas(db: Database, context: TenantContext, now: number): Promise<void> {
  const bucket = `idea:${createHash('sha256').update(JSON.stringify([context.tenantId, context.namespaceId, context.userId])).digest('hex')}`;
  const allowed = await db.transaction(async c => {
    await member(c, context);
    await c.query("DELETE FROM h2_attempts WHERE bucket LIKE 'idea:%' AND window_start <= ?", [now - 600000]);
    const row = (await c.query(`INSERT INTO h2_attempts VALUES (?,?,1) ON CONFLICT (bucket) DO UPDATE
      SET attempts = CASE WHEN h2_attempts.attempts < 6 THEN h2_attempts.attempts + 1 ELSE h2_attempts.attempts END RETURNING attempts`, [bucket, now]))[0]!;
    return Number(row.attempts) <= 5;
  });
  if (!allowed) throw new MetadataError('IDEA_RATE_LIMITED', 429);
}
export async function submitIdea(db: Database, context: TenantContext, input: { title: unknown; description: unknown; surface: unknown }, now = Date.now()): Promise<Idea> {
  const title = field(input.title, 160), description = field(input.description, 10000, true), surface = field(input.surface, 80);
  const at = new Date(now).toISOString();
  return db.transaction(async c => {
    const identity = await member(c, context);
    const idea: Idea = { id: randomUUID(), tenantId: context.tenantId, namespaceId: context.namespaceId, userId: context.userId, ...identity,
      title, description, surface, productVersion: packageInfo.version, status: 'received', declineCategory: null, declineNote: null,
      shippedReference: null, createdAt: at, updatedAt: at };
    await c.query(`INSERT INTO h8_ideas (id, tenant_id, namespace_id, user_id, name, email, title, description, surface, product_version, status, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`, [idea.id, idea.tenantId, idea.namespaceId, idea.userId, idea.name, idea.email, title, description, surface, idea.productVersion, idea.status, at, at]);
    return idea;
  });
}
export async function myIdeas(db: Database, context: TenantContext): Promise<Idea[]> {
  return db.transaction(async c => {
    await member(c, context);
    return (await c.query('SELECT * FROM h8_ideas WHERE tenant_id = ? AND namespace_id = ? AND user_id = ? ORDER BY created_at DESC, id DESC',
      [context.tenantId, context.namespaceId, context.userId])).map(stored);
  });
}
/** Operator authorization belongs to the operator router; no tenant route calls these functions. */
export async function listIdeas(db: Database, filters: { status?: unknown; tenantId?: unknown } = {}): Promise<Idea[]> {
  const clauses: string[] = [], values: string[] = [];
  if (filters.status !== undefined) { clauses.push('status = ?'); values.push(ideaStatus(filters.status)); }
  if (filters.tenantId !== undefined) {
    if (typeof filters.tenantId !== 'string' || !/^[A-Za-z0-9_-]{1,512}$/.test(filters.tenantId)) invalid('IDEA_FILTER_INVALID');
    clauses.push('tenant_id = ?'); values.push(filters.tenantId);
  }
  return db.transaction(async c => (await c.query(`SELECT * FROM h8_ideas${clauses.length ? ` WHERE ${clauses.join(' AND ')}` : ''} ORDER BY created_at DESC, id DESC`, values)).map(stored));
}
const transitions: Record<IdeaStatus, readonly IdeaStatus[]> = { received: ['under_review'], under_review: ['accepted', 'declined', 'shipped'], accepted: ['shipped'], declined: [], shipped: [] };
export async function transitionIdea(db: Database, id: string, input: { status: unknown; declineCategory?: unknown; declineNote?: unknown; shippedReference?: unknown }, now = Date.now()): Promise<Idea> {
  const status = ideaStatus(input.status);
  let category: DeclineCategory | null = null, note: string | null = null, reference: string | null = null;
  if (status === 'declined') {
    if (!declineCategories.includes(input.declineCategory as DeclineCategory)) invalid('IDEA_DECLINE_REASON_REQUIRED');
    category = input.declineCategory as DeclineCategory;
    note = field(input.declineNote, 500, false, 'IDEA_DECLINE_REASON_REQUIRED');
  } else if (input.declineCategory !== undefined || input.declineNote !== undefined) invalid();
  if (status === 'shipped') reference = field(input.shippedReference, 500, false, 'IDEA_SHIPPED_REFERENCE_REQUIRED');
  else if (input.shippedReference !== undefined) invalid();
  return db.transaction(async c => {
    const previous = (await c.query('SELECT * FROM h8_ideas WHERE id = ?', [id]))[0];
    if (!previous) throw new MetadataError('IDEA_NOT_FOUND', 404);
    const from = ideaStatus(previous.status);
    if (!transitions[from].includes(status)) throw new MetadataError('IDEA_TRANSITION_INVALID', 409);
    const row = (await c.query(`UPDATE h8_ideas SET status = ?, decline_category = ?, decline_note = ?, shipped_reference = ?, updated_at = ?
      WHERE id = ? AND status = ? RETURNING *`, [status, category, note, reference, new Date(now).toISOString(), id, from]))[0];
    if (!row) throw new MetadataError('IDEA_TRANSITION_INVALID', 409);
    await appendOperatorAudit(c, { action: 'idea.transitioned', tenantId: String(row.tenant_id), subject: id, detail: { from, to: status } }, now);
    return stored(row);
  });
}
