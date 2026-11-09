import { createHash, randomUUID } from 'node:crypto';
import { MetadataError, type Database } from './metadata-db.js';
import { emailAddress, type MailTransport } from './mail.js';
import { escapeHtml } from './reports.js';

export interface AccessRequest {
  id: string; name: string; email: string; organization: string | null; note: string | null;
  createdAt: string; status: string; notifiedAt: string | null;
}
export async function initializeAccessRequests(db: Database): Promise<void> {
  await db.transaction(async c => {
    await c.query(`CREATE TABLE IF NOT EXISTS h8_access_requests (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL, organization TEXT, note TEXT,
      created_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', notified_at TEXT,
      notify_claim_token TEXT, notify_claim_expires_at TEXT)`);
    // Additive upgrades for tables created before notifications (issue #177)
    // and before notification claims (issue #232). Some callers pass a
    // transaction-scoped Database whose dialect is not set, so probe for
    // each column under a savepoint instead of branching on dialect
    // (PRAGMA is SQLite-only; the savepoint pattern is the one the
    // AI-warning code in hosted-usage.ts already uses on both dialects).
    for (const [column, savepoint] of [['notified_at', 'opensight_notified_at_check'],
      ['notify_claim_token', 'opensight_notify_claim_token_check'],
      ['notify_claim_expires_at', 'opensight_notify_claim_expires_check']] as const) {
      await c.query(`SAVEPOINT ${savepoint}`);
      let hasColumn = true;
      try {
        await c.query(`SELECT ${column} FROM h8_access_requests LIMIT 0`);
      } catch {
        hasColumn = false;
        await c.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
      }
      await c.query(`RELEASE SAVEPOINT ${savepoint}`);
      if (!hasColumn) await c.query(`ALTER TABLE h8_access_requests ADD COLUMN ${column} TEXT`);
    }
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
  const request: AccessRequest = { id: randomUUID(), name, email, organization, note, createdAt, status: 'pending', notifiedAt: null };
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
    notifiedAt: row.notified_at === null || row.notified_at === undefined ? null : String(row.notified_at),
  })));
}
export function accessRequestNotifyTo(env: NodeJS.ProcessEnv): string | null {
  const name = 'OPENSIGHT_ACCESS_REQUEST_NOTIFY_TO', raw = env[name];
  if (raw === undefined || !raw.trim()) return null;
  const address = raw.trim().toLowerCase();
  if (!emailAddress(address)) throw new Error(`${name} must be a single email address`);
  return address;
}
/**
 * How long a notification claim is held before another sender may take the
 * row over. The SMTP transport's own deadline is at most 60 seconds, so a
 * five-minute lease always outlives a live send while still recovering a
 * row whose sender died mid-send (issue #232).
 */
export const ACCESS_REQUEST_NOTIFY_CLAIM_MS = 5 * 60_000;
/**
 * Best-effort operator notification for stored access requests (issue #177).
 * Store-first semantics: a request is durable before this runs, and a mail
 * failure never propagates — the row simply stays unnotified (visible in the
 * operator list) and a later call retries it. Oldest first; the batch stops
 * at the first send failure so a dead mail server is not hammered per row.
 *
 * Each row is claimed atomically before anything is sent (issue #232): the
 * claim is a conditional UPDATE that only succeeds while the row is
 * unnotified and unclaimed (or its previous claim's lease has expired, i.e.
 * that sender died mid-send). Concurrent submissions or maintenance calls
 * therefore never send the same row twice, even through a transport that
 * does not deduplicate. The send keeps the stable per-request dedupe key
 * (#224), so a retry after a crash between send and stamp still carries the
 * same delivery identity. A failed send releases its claim immediately;
 * returns how many notifications this call delivered.
 */
export async function notifyAccessRequests(db: Database, mail: MailTransport, to: string | null, now: number, limit = 20): Promise<number> {
  if (!to || !mail.configured) return 0;
  const nowIso = new Date(now).toISOString();
  const claimToken = randomUUID();
  const claimExpiresAt = new Date(now + ACCESS_REQUEST_NOTIFY_CLAIM_MS).toISOString();
  // Rows are claimed one at a time, immediately before their send: claiming
  // a whole batch up front would leave its later rows claimed (and skipped
  // by other senders) when the batch stops at an early failure.
  const claimNext = () => db.transaction(async c => {
    const [candidate] = await c.query(
      `SELECT * FROM h8_access_requests WHERE notified_at IS NULL
        AND (notify_claim_expires_at IS NULL OR notify_claim_expires_at <= ?)
        ORDER BY created_at ASC, id ASC LIMIT 1`, [nowIso]);
    if (!candidate) return null;
    const taken = await c.query(
      `UPDATE h8_access_requests SET notify_claim_token = ?, notify_claim_expires_at = ?
        WHERE id = ? AND notified_at IS NULL
          AND (notify_claim_expires_at IS NULL OR notify_claim_expires_at <= ?) RETURNING id`,
      [claimToken, claimExpiresAt, String(candidate.id), nowIso]);
    return taken.length ? candidate : 'lost';
  });
  let sent = 0;
  for (let processed = 0, races = 0; processed < limit;) {
    const row = await claimNext();
    if (row === null) break;
    if (row === 'lost') { if (++races > 100) break; continue; }
    processed++;
    const subjectName = String(row.name).replace(/[\x00-\x1f\x7f]+/g, ' ').trim();
    const lines = [
      `<p><strong>${escapeHtml(String(row.name))}</strong> (${escapeHtml(String(row.email))}) requested hosted OpenSight access.</p>`,
      row.organization ? `<p>Organization: ${escapeHtml(String(row.organization))}</p>` : '',
      row.note ? `<p>Note: ${escapeHtml(String(row.note))}</p>` : '',
      `<p>Requested at ${escapeHtml(String(row.created_at))}. Review all requests with GET /api/host/access-requests and provision by hand (D-79).</p>`,
    ].join('');
    try {
      // The production SMTP transport only accepts a 64-char lowercase hex
      // dedupe key (it becomes the Message-ID); the raw namespaced key was
      // rejected before sending and, because the batch stops at the first
      // failure, permanently blocked every later notification (issue #224).
      // Hash the namespaced identity into that format — stable per request,
      // so retries still dedupe.
      await mail.send({ to: [to], subject: `OpenSight access request: ${subjectName}`, html: lines, dedupeKey: createHash('sha256').update(`access-request:${String(row.id)}`).digest('hex') });
    } catch {
      // Release only our own claim so a later call retries promptly; if the
      // lease already changed hands the new owner's claim is left alone.
      await db.transaction(c => c.query(
        'UPDATE h8_access_requests SET notify_claim_token = NULL, notify_claim_expires_at = NULL WHERE id = ? AND notify_claim_token = ?',
        [String(row.id), claimToken])).catch(() => {});
      break;
    }
    await db.transaction(c => c.query(
      `UPDATE h8_access_requests SET notified_at = ?, notify_claim_token = NULL, notify_claim_expires_at = NULL
        WHERE id = ? AND notify_claim_token = ?`, [new Date(now).toISOString(), String(row.id), claimToken]));
    sent++;
  }
  return sent;
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
