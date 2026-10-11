import { createHash, randomUUID } from 'node:crypto';
import { MetadataError, type Database, type SqlConnection, type SqlRow, type SqlValue } from './metadata-db.js';
import { identifier, object } from './metadata-resources.js';
import { TenantMetadata, type TenantContext, type Revisions } from './metadata.js';
import { currentAuthority } from './serverless-authority.js';
import { coordinationDeployment, coordinationFailure, coordinationNow, type CoordinationDialect } from './coordination-schema.js';
import { dispatchChecksum } from './dispatch-schema.js';

export interface DispatchEnvelope { version: 1; deploymentEpoch: number; eventId: string; kind: 'execute' | 'recover' | 'due' }
export type DurableEventKind = 'ingest' | 'object-cleanup' | 'result-expire' | 'artifact-cleanup';
export interface DurableEvent {
  eventId: string; aggregateId: string; aggregateRevision: number; kind: DurableEventKind;
  dueAt: number; expiresAt: number; epoch: number;
}
export interface DispatchTransport {
  /** Resolve only after SQS acknowledges a recovery message with a 60-second delay. */
  recover(envelope: DispatchEnvelope): Promise<void>;
  /** Resolve only after SQS send or exact one-time Scheduler create/GET acknowledgement. */
  dispatch(envelope: DispatchEnvelope, event: DurableEvent): Promise<void>;
}
export interface IntentRequest { kind: 'upload-reserve' | 'upload-complete' | 'artifact-write' | 'artifact-refresh' | 'result-write'; requestDigest: string; idempotencyKey: string; revisions: Revisions }
export interface DispatchPreparation { readonly intentId: string }
export interface DispatchReceipt { id: string; revision: number }
export type EventInput = Omit<DurableEvent, 'eventId' | 'epoch'>;
interface Prepared { context: TenantContext; input: IntentRequest; epoch: number; idempotencyDigest: string }
const scoped = 'deployment = ? AND tenant_id = ? AND namespace_id = ? AND owner_id = ?';
const eventKinds: readonly DurableEventKind[] = ['ingest', 'object-cleanup', 'result-expire', 'artifact-cleanup'];
const integer = (value: SqlValue | undefined): number => {
  const n = Number(value); if (!Number.isSafeInteger(n) || n < 1) throw new MetadataError('DISPATCH_UNAVAILABLE', 503); return n;
};
const snapshot = (raw: IntentRequest): IntentRequest => {
  const input = structuredClone(raw), r = object(input, ['kind', 'requestDigest', 'idempotencyKey', 'revisions']);
  if (!['upload-reserve', 'upload-complete', 'artifact-write', 'artifact-refresh', 'result-write'].includes(String(r.kind))
    || typeof r.requestDigest !== 'string' || !/^[a-f0-9]{64}$/.test(r.requestDigest)
    || typeof r.idempotencyKey !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(r.idempotencyKey)) throw new MetadataError('DISPATCH_INPUT_INVALID', 400);
  const revisions = object(r.revisions, ['authorization', 'policy', 'configuration']);
  if (!['authorization', 'policy', 'configuration'].every(k => Number.isSafeInteger(revisions[k]) && Number(revisions[k]) > 0)) throw new MetadataError('DISPATCH_INPUT_INVALID', 400);
  return input;
};
function receipt(raw: unknown): DispatchReceipt {
  const r = object(raw, ['id', 'revision']); identifier(r.id);
  if (!Number.isSafeInteger(r.revision) || Number(r.revision) < 1) throw new MetadataError('DISPATCH_INPUT_INVALID', 400);
  return { id: String(r.id), revision: Number(r.revision) };
}

/** Recovery is acknowledged BEFORE business commit. External I/O never holds a SQL transaction. */
export class DurableDispatch {
  readonly deployment: string;
  readonly #preparations = new WeakMap<DispatchPreparation, Prepared>();
  constructor(private readonly database: Database, private readonly metadata: TenantMetadata, deployment: string,
    private readonly transport: DispatchTransport, private readonly dialect: CoordinationDialect = 'postgres') {
    this.deployment = coordinationDeployment(deployment);
    if (database.durable !== true || !['sqlite', 'postgres'].includes(dialect)) throw new MetadataError('DISPATCH_CONFIG_INVALID', 503);
  }
  private transaction<T>(work: (c: SqlConnection) => Promise<T>): Promise<T> { return this.database.transaction(work).catch(coordinationFailure); }
  private scope(context: TenantContext): SqlValue[] { return [this.deployment, context.tenantId, context.namespaceId, context.userId]; }
  private async control(c: SqlConnection): Promise<number> {
    const row = (await c.query(`SELECT state, epoch, schema_min, schema_max, protocol_min, protocol_max FROM sr_control WHERE deployment = ?${this.dialect === 'postgres' ? ' FOR UPDATE' : ''}`, [this.deployment]))[0];
    if (row?.state !== 'open' || !['schema_min', 'schema_max', 'protocol_min', 'protocol_max'].every(k => Number(row[k]) === 1)) throw new MetadataError('WORKSPACE_MAINTENANCE', 503);
    const marker = (await c.query('SELECT version, checksum FROM sr_dispatch_schema WHERE deployment = ?', [this.deployment]))[0];
    if (Number(marker?.version) !== 1 || marker?.checksum !== dispatchChecksum) throw new MetadataError('DISPATCH_SCHEMA_REQUIRED', 503);
    return integer(row.epoch);
  }
  private row(c: SqlConnection, context: TenantContext, id: string): Promise<SqlRow | undefined> {
    return c.query(`SELECT * FROM sr_dispatch_intent WHERE ${scoped} AND intent_id = ?${this.dialect === 'postgres' ? ' FOR UPDATE' : ''}`, [...this.scope(context), id]).then(rows => rows[0]);
  }
  /** Short metadata operations share authority/lock order without reserving a native worker. */
  async authorized<T>(context: TenantContext, revisions: Revisions, work: (c: SqlConnection, control: { epoch: number; now: number }) => Promise<T>, build = true): Promise<T> {
    this.metadata.assertContext(context);
    const expected = structuredClone(revisions);
    return this.transaction(async c => {
      const epoch = await this.control(c); await currentAuthority(c, this.metadata, context, expected, build);
      return work(c, { epoch, now: await coordinationNow(c, this.dialect) });
    });
  }
  async prepare(context: TenantContext, raw: IntentRequest): Promise<DispatchPreparation> {
    this.metadata.assertContext(context);
    const input = snapshot(raw), idempotencyDigest = createHash('sha256').update(input.idempotencyKey).digest('hex');
    const found = await this.transaction(async c => {
      const epoch = await this.control(c); await currentAuthority(c, this.metadata, context, input.revisions, true);
      const now = await coordinationNow(c, this.dialect);
      // A crash before recovery send created no accepted obligation. Scoped activity retires it.
      await c.query(`UPDATE sr_dispatch_intent SET state = 'aborted' WHERE ${scoped} AND state = 'prepared' AND commit_until <= ?`, [...this.scope(context), now]);
      const prior = (await c.query(`SELECT * FROM sr_dispatch_intent WHERE ${scoped} AND kind = ? AND idempotency_digest = ?`, [...this.scope(context), input.kind, idempotencyDigest]))[0];
      if (prior) {
        if (prior.request_digest !== input.requestDigest) throw new MetadataError('IDEMPOTENCY_CONFLICT', 409);
        if (integer(prior.control_epoch) !== epoch || prior.state === 'aborted') throw new MetadataError('DISPATCH_INTENT_EXPIRED', 409);
        if (prior.state === 'prepared' && (['authorization', 'policy', 'configuration'] as const).some(k => integer(prior[`${k}_revision`]) !== input.revisions[k])) throw new MetadataError('METADATA_REVISED', 403);
        return { epoch, id: String(prior.intent_id), committed: prior.state === 'committed' };
      }
      const active = await c.query("SELECT namespace_id, owner_id FROM sr_dispatch_intent WHERE deployment = ? AND tenant_id = ? AND state = 'prepared' AND commit_until > ?", [this.deployment, context.tenantId, now]);
      if (active.length >= 32 || active.filter(r => r.owner_id === context.userId && r.namespace_id === context.namespaceId).length >= 8) throw new MetadataError('DISPATCH_ADMISSION_REFUSED', 429);
      const id = randomUUID();
      await c.query('INSERT INTO sr_dispatch_intent VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL)', [...this.scope(context), id, input.kind, input.requestDigest, idempotencyDigest,
        epoch, input.revisions.authorization, input.revisions.policy, input.revisions.configuration, now + 60000, 'prepared']);
      return { epoch, id, committed: false };
    });
    if (!found.committed) await this.transport.recover({ version: 1, deploymentEpoch: found.epoch, eventId: found.id, kind: 'recover' });
    const handle = Object.freeze({ intentId: found.id });
    this.#preparations.set(handle, { context, input, epoch: found.epoch, idempotencyDigest }); return handle;
  }
  /** The callback is internal SQL-only business work; the handle cannot be reconstructed from JSON. */
  async commit(handle: DispatchPreparation, work: (c: SqlConnection, now: number) => Promise<{ receipt: DispatchReceipt; events: EventInput[] }>): Promise<DispatchReceipt> {
    return this.transaction(c => this.commitOn(c, handle, work));
  }
  /** Internal composition with an already control/tenant-locked SR2 admission transaction. */
  async commitOn(c: SqlConnection, handle: DispatchPreparation, work: (c: SqlConnection, now: number) => Promise<{ receipt: DispatchReceipt; events: EventInput[] }>): Promise<DispatchReceipt> {
    const prepared = this.#preparations.get(handle);
    if (!prepared) throw new MetadataError('DISPATCH_PREPARATION_REQUIRED', 403);
    const { context, input, epoch } = prepared;
    if (await this.control(c) !== epoch) throw new MetadataError('WORKSPACE_MAINTENANCE', 503);
    await currentAuthority(c, this.metadata, context, input.revisions, true);
    const row = await this.row(c, context, handle.intentId), now = await coordinationNow(c, this.dialect);
    if (!row || row.request_digest !== input.requestDigest || row.idempotency_digest !== prepared.idempotencyDigest || integer(row.control_epoch) !== epoch) throw new MetadataError('DISPATCH_PREPARATION_REQUIRED', 403);
    if (row.state === 'committed') return receipt(JSON.parse(String(row.receipt)));
    if (row.state !== 'prepared' || integer(row.commit_until) <= now) throw new MetadataError('DISPATCH_INTENT_EXPIRED', 409);
    if ((['authorization', 'policy', 'configuration'] as const).some(k => integer(row[`${k}_revision`]) !== input.revisions[k])) throw new MetadataError('METADATA_REVISED', 403);
    const result = await work(c, now), saved = receipt(result.receipt);
    if (!Array.isArray(result.events) || result.events.length > 8) throw new MetadataError('DISPATCH_INPUT_INVALID', 400);
    for (const raw of result.events) {
      const event = object(raw, ['aggregateId', 'aggregateRevision', 'kind', 'dueAt', 'expiresAt']); identifier(event.aggregateId);
      if (!eventKinds.includes(event.kind as DurableEventKind) || !Number.isSafeInteger(event.aggregateRevision) || Number(event.aggregateRevision) < 1
        || ![event.dueAt, event.expiresAt].every(Number.isSafeInteger) || Number(event.expiresAt) <= Math.max(Number(event.dueAt), now)
        || Number(event.dueAt) < now - 1000 || Number(event.expiresAt) - Math.max(now, Number(event.dueAt)) > 86400000) throw new MetadataError('DISPATCH_INPUT_INVALID', 400);
      await c.query("INSERT INTO sr_outbox VALUES (?,?,?,?,?,?,?,?,?,1,?,?,?,'pending')", [...this.scope(context), randomUUID(), handle.intentId,
        String(event.aggregateId), Number(event.aggregateRevision), String(event.kind), epoch, Number(event.dueAt), Number(event.expiresAt)]);
    }
    // A callback may change its own H1 revisions. It may not commit after intent eligibility.
    if (await coordinationNow(c, this.dialect) >= integer(row.commit_until)) throw new MetadataError('DISPATCH_INTENT_EXPIRED', 409);
    await c.query(`UPDATE sr_dispatch_intent SET state = 'committed', receipt = ? WHERE ${scoped} AND intent_id = ?`, [JSON.stringify(saved), ...this.scope(context), handle.intentId]);
    return saved;
  }

  private event(row: SqlRow): DurableEvent {
    if (!eventKinds.includes(row.kind as DurableEventKind) || Number(row.version) !== 1) throw new MetadataError('DISPATCH_UNAVAILABLE', 503);
    return { eventId: identifier(row.event_id), aggregateId: identifier(row.aggregate_id), aggregateRevision: integer(row.aggregate_revision),
      kind: row.kind as DurableEventKind, dueAt: integer(row.due_at), expiresAt: integer(row.expires_at), epoch: integer(row.control_epoch) };
  }
  /** Safe after uncertain sends: at-least-once hints, never exactly-once business work. */
  async flush(intentId: string, expectedEpoch: number): Promise<void> {
    identifier(intentId);
    const events = await this.transaction(async c => {
      const epoch = await this.control(c); if (epoch !== expectedEpoch) return [];
      const row = (await c.query('SELECT state FROM sr_dispatch_intent WHERE deployment = ? AND intent_id = ?', [this.deployment, intentId]))[0];
      if (row?.state !== 'committed') return [];
      return (await c.query("SELECT * FROM sr_outbox WHERE deployment = ? AND intent_id = ? AND state = 'pending'", [this.deployment, intentId])).map(r => this.event(r));
    });
    for (const event of events) {
      await this.transport.dispatch({ version: 1, deploymentEpoch: event.epoch, eventId: event.eventId, kind: 'execute' }, event);
      await this.transaction(async c => {
        if (await this.control(c) !== expectedEpoch) throw new MetadataError('WORKSPACE_MAINTENANCE', 503);
        await c.query("UPDATE sr_outbox SET state = 'dispatched' WHERE deployment = ? AND event_id = ? AND intent_id = ? AND control_epoch = ? AND state = 'pending'", [this.deployment, event.eventId, intentId, expectedEpoch]);
      });
    }
  }
  /** Immediate dispatch is optional for latency; this method preserves the prearmed recovery path. */
  async dispatch(handle: DispatchPreparation): Promise<void> {
    const prepared = this.#preparations.get(handle); if (!prepared) throw new MetadataError('DISPATCH_PREPARATION_REQUIRED', 403);
    await this.flush(handle.intentId, prepared.epoch);
  }
  async recover(envelope: DispatchEnvelope): Promise<void> {
    if (envelope.kind !== 'recover') throw new MetadataError('SCHEDULE_EVENT_INVALID', 400);
    identifier(envelope.eventId);
    const committed = await this.transaction(async c => {
      const epoch = await this.control(c); if (epoch !== envelope.deploymentEpoch) return false;
      const row = (await c.query(`SELECT * FROM sr_dispatch_intent WHERE deployment = ? AND intent_id = ?${this.dialect === 'postgres' ? ' FOR UPDATE' : ''}`, [this.deployment, envelope.eventId]))[0];
      // A successfully sent recovery can only refer to an already committed preparation row.
      if (!row) throw new MetadataError('DISPATCH_INTENT_UNAVAILABLE', 503);
      if (integer(row.control_epoch) !== epoch || row.state === 'aborted') return false;
      if (row.state === 'committed') return true;
      if (await coordinationNow(c, this.dialect) < integer(row.commit_until)) throw new MetadataError('DISPATCH_RECOVERY_EARLY', 409);
      await c.query("UPDATE sr_dispatch_intent SET state = 'aborted' WHERE deployment = ? AND intent_id = ? AND state = 'prepared'", [this.deployment, envelope.eventId]); return false;
    });
    if (committed) await this.flush(envelope.eventId, envelope.deploymentEpoch);
  }
  /** Worker claims must recheck business authority; an event descriptor is not an execution permit. */
  async inspect(envelope: DispatchEnvelope): Promise<(DurableEvent & { scope: { tenantId: string; namespaceId: string; userId: string } }) | undefined> {
    if (!['execute', 'due'].includes(envelope.kind)) throw new MetadataError('SCHEDULE_EVENT_INVALID', 400);
    identifier(envelope.eventId);
    return this.transaction(async c => {
      if (await this.control(c) !== envelope.deploymentEpoch) return undefined;
      const row = (await c.query('SELECT * FROM sr_outbox WHERE deployment = ? AND event_id = ?', [this.deployment, envelope.eventId]))[0];
      if (!row) throw new MetadataError('DISPATCH_EVENT_UNAVAILABLE', 503);
      if (row.state === 'terminal' || integer(row.control_epoch) !== envelope.deploymentEpoch) return undefined;
      const event = this.event(row), now = await coordinationNow(c, this.dialect);
      if (event.expiresAt <= now) { await this.terminal(c, event.eventId, envelope.deploymentEpoch); return undefined; }
      if (event.dueAt > now) throw new MetadataError('DISPATCH_EVENT_EARLY', 409);
      return { ...event, scope: { tenantId: String(row.tenant_id), namespaceId: String(row.namespace_id), userId: String(row.owner_id) } };
    });
  }
  /** Only call inside the fenced business outcome transaction. */
  async terminal(c: SqlConnection, eventId: string, epoch: number): Promise<void> {
    await c.query("UPDATE sr_outbox SET state = 'terminal' WHERE deployment = ? AND event_id = ? AND control_epoch = ?", [this.deployment, identifier(eventId), epoch]);
  }
}
