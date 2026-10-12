import { randomUUID } from 'node:crypto';
import { MetadataError, type SqlConnection, type SqlRow } from './metadata-db.js';
import { DurableDispatch, type DispatchEnvelope, type DurableEvent } from './dispatch.js';
import { executionChecksum } from './execution-schema.js';

export type ExecutionEvent = DurableEvent & { scope: { tenantId: string; namespaceId: string; userId: string } };
export interface ExecutionHandle { readonly event: ExecutionEvent; readonly token: string; readonly fence: string; readonly attempts: number }
export type TerminalWork = (c: SqlConnection, event: ExecutionEvent, code: string, now: number) => Promise<void>;
const retryable = (error: unknown): boolean => !(error instanceof MetadataError) || error.status >= 500 || error.status === 429
  || ['OPERATION_BUSY', 'BLAZE_BUSY', 'DISPATCH_EXECUTION_BUSY'].includes(error.code);
const safeCode = (error: unknown): string => error instanceof Error && 'code' in error && typeof error.code === 'string'
  && /^[A-Z][A-Z0-9_]{0,95}$/.test(error.code) ? error.code : 'DISPATCH_EXECUTION_FAILED';

/** SQL owns attempts; the source receipt owns recovery until outcome and children commit. */
export class DurableExecution {
  readonly #handles = new WeakSet<ExecutionHandle>();
  constructor(readonly dispatch: DurableDispatch, private readonly terminalWork: TerminalWork = async () => {}) {}
  private async schema(c: SqlConnection): Promise<void> {
    const row = (await c.query('SELECT version, checksum FROM sr_execution_schema WHERE deployment = ?', [this.dispatch.deployment]))[0];
    if (Number(row?.version) !== 1 || row?.checksum !== executionChecksum) throw new MetadataError('EXECUTION_SCHEMA_REQUIRED', 503);
  }
  private row(c: SqlConnection, id: string): Promise<SqlRow | undefined> {
    return c.query('SELECT *, CAST(fence AS TEXT) AS fence FROM sr_execution WHERE deployment = ? AND event_id = ?', [this.dispatch.deployment, id]).then(r => r[0]);
  }
  async claim(envelope: DispatchEnvelope, remainingMs = 110000): Promise<ExecutionHandle | undefined> {
    const event = await this.dispatch.inspect(envelope, true); if (!event) return undefined;
    const result = await this.dispatch.system(async (c, { epoch, now }) => {
      await this.schema(c); if (epoch !== event.epoch) return undefined;
      const outbox = (await c.query('SELECT state FROM sr_outbox WHERE deployment = ? AND event_id = ?', [this.dispatch.deployment, event.eventId]))[0];
      const row = await this.row(c, event.eventId);
      if (outbox?.state === 'terminal' || row && ['completed', 'failed', 'cancelled'].includes(String(row.state))) return undefined;
      if (row && ['running', 'sending'].includes(String(row.state)) && Number(row.lease_until) > now) throw new MetadataError('DISPATCH_EXECUTION_BUSY', 409);
      if (event.expiresAt <= now || Number(row?.attempts ?? 0) >= 5) {
        const code = event.expiresAt <= now ? 'DISPATCH_EVENT_EXPIRED' : 'DISPATCH_RETRY_EXHAUSTED';
        await this.terminalWork(c, event, code, now);
        if (row) await c.query("UPDATE sr_execution SET state = 'failed', error_code = ? WHERE deployment = ? AND event_id = ?", [code, this.dispatch.deployment, event.eventId]);
        else await c.query("INSERT INTO sr_execution VALUES (?,?,1,?,1,?,'failed',?)", [this.dispatch.deployment, event.eventId, randomUUID(), now, code]);
        await this.dispatch.terminal(c, event.eventId, epoch); return undefined;
      }
      if (row && ['sending', 'ambiguous'].includes(String(row.state))) {
        await c.query("UPDATE sr_execution SET state = 'ambiguous', error_code = 'DELIVERY_AMBIGUOUS' WHERE deployment = ? AND event_id = ?", [this.dispatch.deployment, event.eventId]);
        return 'ambiguous' as const;
      }
      if (!Number.isFinite(remainingMs) || remainingMs < 1000) throw new MetadataError('INVOCATION_DEADLINE_EXCEEDED', 503);
      if (row && BigInt(String(row.fence)) >= 9223372036854775807n) throw new MetadataError('CLAIM_FENCE_EXHAUSTED', 503);
      const token = randomUUID(), lease = Math.min(event.expiresAt, now + Math.min(110000, Math.floor(remainingMs)));
      if (row) await c.query("UPDATE sr_execution SET fence = fence + 1, token = ?, attempts = attempts + 1, lease_until = ?, state = 'running', error_code = NULL WHERE deployment = ? AND event_id = ?", [token, lease, this.dispatch.deployment, event.eventId]);
      else await c.query("INSERT INTO sr_execution VALUES (?,?,1,?,1,?,'running',NULL)", [this.dispatch.deployment, event.eventId, token, lease]);
      const saved = (await this.row(c, event.eventId))!;
      const handle = Object.freeze({ event: Object.freeze({ ...event, scope: Object.freeze({ ...event.scope }) }), token, fence: String(saved.fence), attempts: Number(saved.attempts) });
      this.#handles.add(handle); return handle;
    });
    if (result === 'ambiguous') throw new MetadataError('DELIVERY_AMBIGUOUS', 503);
    return result;
  }
  async checkOn(c: SqlConnection, handle: ExecutionHandle, now: number, epoch: number): Promise<void> {
    if (!this.#handles.has(handle)) throw new MetadataError('EXECUTION_HANDLE_REQUIRED', 403);
    const row = await this.row(c, handle.event.eventId);
    if (epoch !== handle.event.epoch || !row || row.token !== handle.token || String(row.fence) !== handle.fence
      || !['running', 'sending'].includes(String(row.state)) || Number(row.lease_until) <= now || handle.event.expiresAt <= now) throw new MetadataError('DISPATCH_CLAIM_LOST', 409);
  }
  async checked<T>(handle: ExecutionHandle, work: (c: SqlConnection, now: number) => Promise<T>): Promise<T> {
    return this.dispatch.system(async (c, { epoch, now }) => {
      await this.checkOn(c, handle, now, epoch);
      const row = (await this.row(c, handle.event.eventId))!, result = await work(c, now);
      if (await this.dispatch.time(c) >= Math.min(Number(row.lease_until), handle.event.expiresAt)) throw new MetadataError('DISPATCH_CLAIM_LOST', 409);
      return result;
    });
  }
  async sending(handle: ExecutionHandle): Promise<void> {
    await this.checked(handle, async c => { await c.query("UPDATE sr_execution SET state = 'sending' WHERE deployment = ? AND event_id = ?", [this.dispatch.deployment, handle.event.eventId]); });
  }
  async complete(handle: ExecutionHandle, work: (c: SqlConnection, now: number) => Promise<void> = async () => {}): Promise<void> {
    await this.checked(handle, async (c, now) => {
      await work(c, now);
      await c.query("UPDATE sr_execution SET state = 'completed', error_code = NULL WHERE deployment = ? AND event_id = ?", [this.dispatch.deployment, handle.event.eventId]);
      await this.dispatch.terminal(c, handle.event.eventId, handle.event.epoch);
    });
  }
  /** A failed outcome transaction leaves the incoming receipt unacknowledged. */
  async failed(handle: ExecutionHandle, error: unknown, ambiguous = false): Promise<boolean> {
    const code = safeCode(error);
    return this.checked(handle, async (c, now) => {
      const retry = retryable(error) && handle.attempts < 5;
      const state = ambiguous ? 'ambiguous' : retry ? 'retry' : 'failed';
      await c.query('UPDATE sr_execution SET state = ?, error_code = ? WHERE deployment = ? AND event_id = ?', [state, code, this.dispatch.deployment, handle.event.eventId]);
      if (!retry && !ambiguous) {
        await this.terminalWork(c, handle.event, code, now);
        await this.dispatch.terminal(c, handle.event.eventId, handle.event.epoch);
      }
      return !retry && !ambiguous;
    });
  }
  /** Private operator composition must supply fresh domain authorization; no counter reset. */
  async replay(envelope: DispatchEnvelope, authorize: (c: SqlConnection, event: ExecutionEvent) => Promise<void>, acceptAmbiguous = false): Promise<void> {
    const event = await this.dispatch.inspect(envelope, true);
    if (!event) throw new MetadataError('DISPATCH_REPLAY_DENIED', 409);
    await this.dispatch.system(async (c, { epoch, now }) => {
      await this.schema(c); const row = await this.row(c, event.eventId);
      if (epoch !== event.epoch || event.expiresAt <= now || row && (Number(row.attempts) >= 5
        || ['completed', 'failed', 'cancelled'].includes(String(row.state)) || ['running', 'sending'].includes(String(row.state)) && Number(row.lease_until) > now)) throw new MetadataError('DISPATCH_REPLAY_DENIED', 409);
      if (row && ['ambiguous', 'sending'].includes(String(row.state)) && !acceptAmbiguous) throw new MetadataError('DELIVERY_AMBIGUOUS', 409);
      await authorize(c, event);
      if (row) await c.query("UPDATE sr_execution SET state = 'retry' WHERE deployment = ? AND event_id = ?", [this.dispatch.deployment, event.eventId]);
      await c.query("UPDATE sr_outbox SET state = 'pending' WHERE deployment = ? AND event_id = ? AND state <> 'terminal'", [this.dispatch.deployment, event.eventId]);
    });
    // Lost send acknowledgement is safe: replay again under the same bounds.
    await this.dispatch.flushEvent(envelope);
  }
}
