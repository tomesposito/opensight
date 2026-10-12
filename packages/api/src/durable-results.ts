import { createHash, randomUUID } from 'node:crypto';
import { MetadataError, type Database, type SqlConnection, type SqlRow, type SqlValue } from './metadata-db.js';
import { TenantMetadata, type TenantContext, type Revisions } from './metadata.js';
import { identifier, object } from './metadata-resources.js';
import { DurableDispatch, type DispatchPreparation, type EventInput } from './dispatch.js';
import type { ExecutionEvent } from './durable-execution.js';
import { ObjectLedger, type VerifiedObject } from './object-ledger.js';
import { ResultObjects, resultChunkBytes } from './result-objects.js';
import { ServerlessWork } from './serverless-work.js';
import { TenantBudgets } from './budgets.js';
import { operationChecksum } from './operation-schema.js';
import { requestDigest } from './upload-request.js';
import { coordinationNow, type CoordinationDialect } from './coordination-schema.js';
import type { ResultCertificate } from './manifests.js';

export interface ResultReader { kind: 'author' | 'embed'; id: string; expiresAt: number }
export interface ResultDescriptor { version: 1; byteLength: number; sha256: string; chunks: { index: number; byteLength: number; sha256: string }[] }
interface StoredResult { reader: ResultReader; descriptor: ResultDescriptor; certificate: ResultCertificate }
const scoped = 'deployment = ? AND tenant_id = ? AND namespace_id = ? AND owner_id = ?';
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const expired = (): never => { throw new MetadataError('RESULT_EXPIRED', 410); };
/** Called only inside the current event's fenced outcome transaction. */
export async function expireResultOperation(c: SqlConnection, deployment: string, event: ExecutionEvent, now: number): Promise<void> {
  if (event.kind !== 'result-expire') throw new MetadataError('OPERATION_EVENT_INVALID', 409);
  const args = [deployment, event.scope.tenantId, event.scope.namespaceId, event.scope.userId, event.aggregateId, event.epoch];
  const row = (await c.query(`SELECT expires_at FROM sr_operation WHERE ${scoped} AND operation_id = ? AND control_epoch = ? AND kind = 'result'`, args))[0];
  if (!row) throw new MetadataError('OPERATION_EVENT_INVALID', 409);
  if (Number(row.expires_at) > now) throw new MetadataError('DISPATCH_EVENT_EARLY', 409);
  await c.query(`UPDATE sr_operation SET state = 'expired', revision = revision + 1, result = NULL WHERE ${scoped} AND operation_id = ? AND control_epoch = ? AND kind = 'result' AND state IN ('queued','running','completed')`, args);
}
export class DurableResults {
  constructor(private readonly database: Database, private readonly metadata: TenantMetadata, private readonly dispatch: DurableDispatch,
    private readonly ledger: ObjectLedger, private readonly objects: ResultObjects, private readonly work: ServerlessWork,
    private readonly budgets: TenantBudgets, private readonly dialect: CoordinationDialect = 'postgres') {}
  private scope(context: TenantContext): SqlValue[] { this.metadata.assertContext(context); return [this.dispatch.deployment, context.tenantId, context.namespaceId, context.userId]; }
  private async schema(c: SqlConnection): Promise<void> {
    const row = (await c.query('SELECT checksum FROM sr_operation_schema WHERE deployment = ?', [this.dispatch.deployment]))[0];
    if (row?.checksum !== operationChecksum) throw new MetadataError('OPERATION_SCHEMA_REQUIRED', 503);
  }
  private reader(reader: ResultReader): void {
    if (!['author', 'embed'].includes(reader.kind) || typeof reader.id !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(reader.id)
      || !Number.isSafeInteger(reader.expiresAt) || reader.expiresAt <= Date.now()) expired();
  }
  private async flush(preparation: DispatchPreparation): Promise<void> {
    try { await this.dispatch.dispatch(preparation); }
    catch (error) { if (error instanceof MetadataError && ['INVOCATION_CLEANUP_FAILED', 'RUNTIME_QUARANTINED'].includes(error.code)) throw error; }
  }
  /** Only a completed, currently authorized analytics request can create a result. */
  async publish(context: TenantContext, body: unknown, reader: ResultReader, recheck: () => Promise<void>): Promise<{ status: number; body: unknown }> {
    const json = JSON.stringify(body), byteLength = Buffer.byteLength(json);
    if (byteLength <= resultChunkBytes) return { status: 200, body };
    this.reader(reader);
    const attempt = this.work.attempt(context), details = this.work.coordinator.describe(attempt), revisions = details.input.revisions;
    if (byteLength > details.limits.resultBytes) throw new MetadataError('TENANT_BUDGET_EXCEEDED', 429);
    return this.work.resultWork(context, async () => {
      const local = this.budgets.current(context); local.memory(json.length * 2 + byteLength);
      const bytes = Buffer.from(json), id = randomUUID(), descriptor: ResultDescriptor = { version: 1, byteLength, sha256: digest(bytes), chunks: [] };
      const chunks: Buffer[] = [];
      for (let offset = 0; offset < bytes.length; offset += resultChunkBytes) {
        const chunk = bytes.subarray(offset, Math.min(bytes.length, offset + resultChunkBytes));
        descriptor.chunks.push({ index: chunks.length, byteLength: chunk.length, sha256: digest(chunk) }); chunks.push(chunk);
      }
      const stored: StoredResult = { reader: { ...reader }, descriptor, certificate: this.work.resultCertificate() };
      if (Buffer.byteLength(JSON.stringify(stored)) > resultChunkBytes) throw new MetadataError('RESULT_METADATA_TOO_LARGE', 429);
      const verified: { id: string; object: VerifiedObject }[] = []; let expiresAt = 0;
      for (let start = 0; start < chunks.length; start += 7) {
        local.check(); await recheck();
        const group = chunks.slice(start, start + 7), plans = group.map(chunk => this.ledger.plan(context, { purpose: 'result', capacityBytes: chunk.length,
          checksum: createHash('sha256').update(chunk).digest('base64'), mediaType: 'application/octet-stream' }));
        const preparation = await this.dispatch.prepare(context, { kind: 'result-write', idempotencyKey: randomUUID(), requestDigest: requestDigest({ id, start, descriptor }), revisions });
        await recheck();
        await this.work.coordinator.publish(attempt, c => this.dispatch.commitOn(c, preparation, async (c, now) => {
          await this.schema(c);
          if (!start) {
            expiresAt = Math.min(now + 900000, reader.expiresAt, this.work.sourceExpiry()); if (expiresAt <= now) expired();
            await c.query("INSERT INTO sr_operation VALUES (?,?,?,?,?,1,'result','running',?,?,?,?,NULL,?,1,?,NULL,?)", [...this.scope(context), id,
              Number(details.epoch), revisions.authorization, revisions.policy, revisions.configuration, expiresAt, attempt.attemptId, JSON.stringify(stored)]);
          } else {
            const row = (await c.query(`SELECT state, attempt_id, expires_at FROM sr_operation WHERE ${scoped} AND operation_id = ?`, [...this.scope(context), id]))[0];
            if (row?.state !== 'running' || row.attempt_id !== attempt.attemptId || Number(row.expires_at) !== expiresAt || expiresAt <= now) expired();
          }
          await this.ledger.reserve(c, context, revisions, preparation.intentId, plans, now, expiresAt);
          const events: EventInput[] = start ? [] : [{ aggregateId: id, aggregateRevision: 1, kind: 'result-expire', dueAt: expiresAt, expiresAt: expiresAt + 86400000 }];
          for (const [index, plan] of plans.entries()) {
            await c.query('INSERT INTO sr_result_chunk VALUES (?,?,?,?,?,?,?)', [...this.scope(context), id, start + index, plan.id]);
            events.push({ aggregateId: plan.id, aggregateRevision: 1, kind: 'object-cleanup', dueAt: now + 86400000, expiresAt: now + 172800000 });
          }
          return { receipt: { id, revision: 1 }, events };
        }));
        await this.flush(preparation);
        for (const [index, plan] of plans.entries()) {
          const entry = await this.work.coordinator.publish(attempt, c => this.ledger.read(c, context, plan.id));
          verified.push({ id: plan.id, object: await this.objects.write(local, entry, group[index]!) });
        }
      }
      await recheck(); await this.work.cache.verify?.();
      await this.work.coordinator.publish(attempt, async c => {
        if (expiresAt <= await coordinationNow(c, this.dialect)) expired();
        const row = (await c.query(`SELECT state, attempt_id FROM sr_operation WHERE ${scoped} AND operation_id = ?`, [...this.scope(context), id]))[0];
        if (row?.state !== 'running' || row.attempt_id !== attempt.attemptId) throw new MetadataError('OPERATION_CLAIM_LOST', 409);
        for (const value of verified) await this.ledger.bind(c, context, value.id, value.object);
        await c.query(`UPDATE sr_operation SET state = 'completed', revision = revision + 1 WHERE ${scoped} AND operation_id = ?`, [...this.scope(context), id]);
      });
      await recheck(); await this.work.cache.verify?.(); local.check();
      return { status: 202, body: { operation: { id, revision: 2, kind: 'result', state: 'completed', expiresAt: new Date(expiresAt).toISOString(), resultAvailable: true, result: descriptor } } };
    });
  }
  private async current(c: SqlConnection, context: TenantContext, id: string, reader: ResultReader, revisions: Revisions, epoch: number, now: number): Promise<{ row: SqlRow; stored: StoredResult }> {
    await this.schema(c);
    const row = (await c.query(`SELECT * FROM sr_operation WHERE ${scoped} AND operation_id = ?`, [...this.scope(context), identifier(id)]))[0];
    if (!row || row.kind !== 'result') throw new MetadataError('RESOURCE_NOT_FOUND', 404);
    if (row.state !== 'completed' || Number(row.expires_at) <= now) expired();
    if (Number(row.control_epoch) !== epoch || (['authorization', 'policy', 'configuration'] as const).some(k => Number(row[`${k}_revision`]) !== revisions[k])) throw new MetadataError('METADATA_REVISED', 403);
    const raw = object(JSON.parse(String(row.result)), ['reader', 'descriptor', 'certificate']), bound = object(raw.reader, ['kind', 'id', 'expiresAt']);
    if (bound.kind !== reader.kind || bound.id !== reader.id || Number(bound.expiresAt) !== reader.expiresAt) throw new MetadataError('RESULT_SESSION_DENIED', 403);
    const stored = raw as unknown as StoredResult;
    await this.work.manifests.verifyResult(c, context, revisions, epoch, this.budgets.limits(context.tenantId), stored.certificate);
    return { row, stored };
  }
  async chunk(context: TenantContext, id: string, index: number, reader: ResultReader, recheck: () => Promise<void>) {
    this.reader(reader);
    if (!Number.isSafeInteger(index) || index < 0 || index > 999999) throw new MetadataError('RESULT_CHUNK_INVALID', 400);
    const revisions = await this.metadata.revisions(context), select = () => this.dispatch.authorized(context, revisions, async (c, { epoch, now }) => {
      const current = await this.current(c, context, id, reader, revisions, epoch, now), chunk = current.stored.descriptor.chunks[index];
      if (!chunk || chunk.index !== index || chunk.byteLength < 1 || chunk.byteLength > resultChunkBytes) throw new MetadataError('RESOURCE_NOT_FOUND', 404);
      const reference = (await c.query(`SELECT object_id FROM sr_result_chunk WHERE ${scoped} AND operation_id = ? AND chunk_index = ?`, [...this.scope(context), id, index]))[0];
      if (!reference) throw new MetadataError('RESULT_OBJECT_UNAVAILABLE', 503);
      const entry = await this.ledger.read(c, context, String(reference.object_id));
      if (entry.purpose !== 'result' || entry.state !== 'live' || entry.bytes !== chunk.byteLength || entry.checksum !== Buffer.from(chunk.sha256, 'hex').toString('base64') || entry.retentionUntil !== Number(current.row.expires_at)) throw new MetadataError('RESULT_OBJECT_INVALID', 503);
      return { entry, chunk, revision: Number(current.row.revision), expiresAt: Number(current.row.expires_at) };
    }, false);
    await recheck(); const before = await select(), bytes = await this.objects.read(before.entry); await recheck(); const after = await select();
    if (JSON.stringify(before) !== JSON.stringify(after) || bytes.length !== before.chunk.byteLength || digest(bytes) !== before.chunk.sha256) throw new MetadataError('RESULT_OBJECT_INVALID', 503);
    return { operationId: id, revision: before.revision, index, byteLength: bytes.length, sha256: before.chunk.sha256, expiresAt: new Date(before.expiresAt).toISOString(), data: bytes.toString('base64') };
  }
  /** Session ID lookup grants no read; the embed verifier must authenticate it next. */
  async embedSession(id: string): Promise<string> {
    const row = await this.database.transaction(async c => (await c.query("SELECT result FROM sr_operation WHERE deployment = ? AND operation_id = ? AND kind = 'result'", [this.dispatch.deployment, identifier(id)]))[0]);
    const bound = row?.result ? object(object(JSON.parse(String(row.result))).reader) : undefined;
    if (bound?.kind !== 'embed' || typeof bound.id !== 'string') throw new MetadataError('INVALID_EMBED_TOKEN', 401); return bound.id;
  }
}
