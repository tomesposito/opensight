import { createHash, randomUUID } from 'node:crypto';
import { MetadataError, type Database } from './metadata-db.js';

export interface AccessRequest {
  id: string; name: string; email: string; organization: string | null; note: string | null;
  createdAt: string; status: string;
}
export async function initializeAccessRequests(db: Database): Promise<void> {
  await db.transaction(async c => {
    await c.query(`CREATE TABLE IF NOT EXISTS h8_access_requests (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL, organization TEXT, note TEXT,
      created_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending')`);
  });
}
function invalid(): never { throw new MetadataError('ACCESS_REQUEST_INVALID', 400); }
function field(value: unknown, max: number, required = false): string | null {
  if (value === undefined && !required) return null;
  if (typeof value !== 'string') return invalid();
  const trimmed = value.trim();
  if (trimmed.length > max || required && !trimmed.length) return invalid();
  return trimmed || null;
}
export async function storeAccessRequest(db: Database, input: {
  name: unknown; email: unknown; organization?: unknown; note?: unknown; now: number;
}): Promise<AccessRequest> {
  const name = field(input.name, 120, true)!;
  const email = field(input.email, 254, true)!.toLowerCase();
  if (typeof input.email !== 'string' || /[\x00-\x1f\x7f-\x9f]/.test(input.email)
    || /\s/.test(email) || !/^[^@]+@[^@.]+(?:\.[^@.]+)+$/.test(email)) invalid();
  const organization = field(input.organization, 160), note = field(input.note, 1000);
  const createdAt = new Date(input.now).toISOString();
  const request: AccessRequest = { id: randomUUID(), name, email, organization, note, createdAt, status: 'pending' };
  await db.transaction(c => c.query(`INSERT INTO h8_access_requests
    (id, name, email, organization, note, created_at, status) VALUES (?,?,?,?,?,?,?)`,
  [request.id, name, email, organization, note, createdAt, request.status]));
  return request;
}
export async function listAccessRequests(db: Database): Promise<AccessRequest[]> {
  return db.transaction(async c => (await c.query('SELECT * FROM h8_access_requests ORDER BY created_at DESC, id DESC')).map(row => ({
    id: String(row.id), name: String(row.name), email: String(row.email),
    organization: row.organization === null ? null : String(row.organization), note: row.note === null ? null : String(row.note),
    createdAt: String(row.created_at), status: String(row.status),
  })));
}
export function accessRequestRate(env: NodeJS.ProcessEnv): number {
  const name = 'OPENSIGHT_ACCESS_REQUEST_RATE', raw = env[name];
  if (raw === undefined) return 5;
  if (!/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(Number(raw))) throw new Error(`${name} must be a positive integer`);
  if (Number(raw) > 100000) throw new Error(`${name} must be at most 100000`);
  return Number(raw);
}
/** Reserve before body parsing. Separate durable buckets survive invocation lifetimes;
 * only this motion's expired buckets are pruned, without changing auth limits. */
export async function limitAccessRequests(db: Database, peer: string, limit: number, now: number): Promise<void> {
  const bucket = `access-request:${createHash('sha256').update(peer).digest('hex')}`;
  const allowed = await db.transaction(async c => {
    await c.query("DELETE FROM h2_attempts WHERE bucket LIKE 'access-request:%' AND window_start <= ?", [now - 600000]);
    const row = (await c.query(`INSERT INTO h2_attempts VALUES (?,?,1)
      ON CONFLICT (bucket) DO UPDATE SET attempts = CASE WHEN h2_attempts.attempts < ?
        THEN h2_attempts.attempts + 1 ELSE h2_attempts.attempts END RETURNING attempts`, [bucket, now, limit + 1]))[0]!;
    return Number(row.attempts) <= limit;
  });
  if (!allowed) throw new MetadataError('ACCESS_REQUEST_RATE_LIMITED', 429);
}
