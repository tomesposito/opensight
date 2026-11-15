import { randomUUID } from 'node:crypto';
import { MetadataError, type Database, type SqlConnection } from './metadata-db.js';
import type { TenantContext, TenantMetadata } from './metadata.js';

export const aiReceiptTables = ['ai_answer_receipts', 'ai_answer_receipt_reservations'] as const;
const ttl = 60 * 60 * 1000, lease = 60 * 1000;
const scope = 'tenant_id = ? AND namespace_id = ? AND user_id = ? AND route = ? AND idempotency_key = ?';
const scopeColumns = ['tenant_id', 'namespace_id', 'user_id', 'route', 'idempotency_key'] as const;
const withoutActiveReservation = `NOT EXISTS (SELECT 1 FROM ai_answer_receipt_reservations reservation
  WHERE ${scopeColumns.map(column => `reservation.${column} = ai_answer_receipts.${column}`).join(' AND ')}
  AND reservation.expires_at > ?)`;
type Revisions = Awaited<ReturnType<TenantMetadata['revisions']>>;
export interface AiAnswerReceipt { state: 'pending' | 'committed'; answer: unknown; chargedCount: number; managed: boolean; revisions: Revisions }
export interface AiAnswerAttempt {
  receipt?: AiAnswerReceipt;
  pending(answer: unknown, chargedCount: number, managed: boolean, revisions: Revisions): Promise<void>;
  beforeCommit(): Promise<void>;
  committed(): Promise<void>;
}
const conflict = (): never => { throw new MetadataError('IDEMPOTENCY_CONFLICT', 409); };
export async function initializeAiAnswerReceipts(db: Database): Promise<void> {
  await db.transaction(async c => {
    await c.query(`CREATE TABLE IF NOT EXISTS ai_answer_receipts (
      tenant_id TEXT NOT NULL, namespace_id TEXT NOT NULL, user_id TEXT NOT NULL, route TEXT NOT NULL,
      idempotency_key TEXT NOT NULL, fingerprint TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('pending','committed')), answer TEXT NOT NULL,
      charged_count INTEGER NOT NULL CHECK (charged_count >= 0), managed INTEGER NOT NULL CHECK (managed IN (0,1)),
      revisions TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL,
      PRIMARY KEY (tenant_id, namespace_id, user_id, route, idempotency_key))`);
    // Admission is separate from receipts: failed/denied generation never stores
    // an answer. A unique durable reservation excludes other serverless workers.
    await c.query(`CREATE TABLE IF NOT EXISTS ai_answer_receipt_reservations (
      tenant_id TEXT NOT NULL, namespace_id TEXT NOT NULL, user_id TEXT NOT NULL, route TEXT NOT NULL,
      idempotency_key TEXT NOT NULL, owner TEXT NOT NULL, expires_at TEXT NOT NULL,
      PRIMARY KEY (tenant_id, namespace_id, user_id, route, idempotency_key))`);
    await c.query('CREATE INDEX IF NOT EXISTS ai_answer_receipts_expiry ON ai_answer_receipts (expires_at)');
    await c.query('CREATE INDEX IF NOT EXISTS ai_answer_receipt_reservations_expiry ON ai_answer_receipt_reservations (expires_at)');
    await c.query('CREATE INDEX IF NOT EXISTS ai_answer_receipts_tenant_expiry ON ai_answer_receipts (tenant_id, expires_at)');
  });
}
export class HostedAIReceipts {
  constructor(private readonly db: Database, private readonly clock: () => number = Date.now) {}
  private async prune(c: SqlConnection, now: string): Promise<void> {
    for (const table of aiReceiptTables) {
      const expired = `expires_at <= ?${table === 'ai_answer_receipts' ? ` AND ${withoutActiveReservation}` : ''}`;
      const times = table === 'ai_answer_receipts' ? [now, now] : [now];
      for (let batch = 0; batch < 20; batch++) {
        const rows = await c.query(`SELECT ${scopeColumns.join(', ')} FROM ${table}
          WHERE ${expired} ORDER BY expires_at LIMIT 500`, times);
        if (rows.length) {
          const keys = rows.flatMap(row => scopeColumns.map(column => String(row[column])));
          await c.query(`DELETE FROM ${table} WHERE (${scopeColumns.join(', ')}) IN
            (${rows.map(() => '(?,?,?,?,?)').join(',')}) AND ${expired}`, [...keys, ...times]);
        }
        if (rows.length < 500) break;
      }
    }
  }
  async pruneExpired(): Promise<void> {
    await this.db.transaction(c => this.prune(c, new Date(this.clock()).toISOString()));
  }
  async run<T>(context: TenantContext, route: string, key: string, fingerprint: string, work: (attempt: AiAnswerAttempt) => Promise<T>): Promise<T> {
    const args = [context.tenantId, context.namespaceId, context.userId, route, key], owner = randomUUID();
    const at = () => new Date(this.clock()).toISOString(), until = () => new Date(this.clock() + lease).toISOString();
    const receipt = await this.db.transaction(async c => {
      const now = at();
      await this.prune(c, now);
      // Reclaim this key even when the global cleanup exhausted its batch budget.
      await c.query(`DELETE FROM ai_answer_receipt_reservations WHERE ${scope} AND expires_at <= ?`, [...args, now]);
      await c.query(`DELETE FROM ai_answer_receipts WHERE ${scope} AND expires_at <= ? AND ${withoutActiveReservation}`, [...args, now, now]);
      if (!(await c.query(`INSERT INTO ai_answer_receipt_reservations VALUES (?,?,?,?,?,?,?)
        ON CONFLICT (tenant_id, namespace_id, user_id, route, idempotency_key) DO NOTHING RETURNING owner`, [...args, owner, until()])).length) conflict();
      const row = (await c.query(`SELECT * FROM ai_answer_receipts WHERE ${scope}`, args))[0];
      if (!row) return undefined;
      if (row.fingerprint !== fingerprint) conflict();
      return { state: row.state as AiAnswerReceipt['state'], answer: JSON.parse(String(row.answer)) as unknown,
        chargedCount: Number(row.charged_count), managed: row.managed === 1, revisions: JSON.parse(String(row.revisions)) as Revisions };
    });
    const renew = async (c: SqlConnection) => {
      if (!(await c.query(`UPDATE ai_answer_receipt_reservations SET expires_at = ? WHERE ${scope} AND owner = ? AND expires_at > ? RETURNING owner`, [until(), ...args, owner, at()])).length) conflict();
    };
    // No open transaction spans provider/metadata/meter I/O. Lost leases fence
    // persistence; a crashed worker's reservation becomes recoverable in a minute.
    let renewal: Promise<void> = Promise.resolve(), lost = false;
    const timer = setInterval(() => { renewal = renewal.then(() => this.db.transaction(renew)).catch(() => { lost = true; }); }, lease / 3);
    timer.unref();
    const write = async (operation: (c: SqlConnection) => Promise<void>) => {
      if (lost) conflict();
      await this.db.transaction(async c => { await renew(c); await operation(c); });
    };
    try {
      return await work({ receipt, beforeCommit: () => write(async () => {}),
        pending: (answer, chargedCount, managed, revisions) => write(async c => {
          const created = this.clock();
          if (!(await c.query(`INSERT INTO ai_answer_receipts VALUES (?,?,?,?,?,?,'pending',?,?,?,?,?,?)
            ON CONFLICT (tenant_id, namespace_id, user_id, route, idempotency_key) DO NOTHING RETURNING idempotency_key`,
          [...args, fingerprint, JSON.stringify(answer), chargedCount, managed ? 1 : 0, JSON.stringify(revisions), new Date(created).toISOString(), new Date(created + ttl).toISOString()])).length) conflict();
        }),
        committed: () => write(async c => {
          if (!(await c.query(`UPDATE ai_answer_receipts SET state = 'committed' WHERE ${scope} AND fingerprint = ? RETURNING idempotency_key`, [...args, fingerprint])).length) conflict();
        }),
      });
    } finally {
      clearInterval(timer); await renewal;
      await this.db.transaction(async c => { await c.query(`DELETE FROM ai_answer_receipt_reservations WHERE ${scope} AND owner = ?`, [...args, owner]); });
    }
  }
}
