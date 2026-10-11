import { randomUUID } from 'node:crypto';
import { MetadataError, type SqlConnection, type SqlRow, type SqlValue } from './metadata-db.js';
import { identifier, object } from './metadata-resources.js';
import { TenantMetadata, type TenantContext, type Revisions } from './metadata.js';
import { validateBudgets } from './budgets.js';
import { DurableDispatch, type DispatchPreparation, type EventInput } from './dispatch.js';
import { ObjectLedger } from './object-ledger.js';
import { UploadObjects } from './upload-objects.js';
import { operationChecksum } from './operation-schema.js';
import type { ResultDescriptor } from './durable-results.js';
import { canonicalJson, directUploadRequest, requestDigest } from './upload-request.js';

const scoped = 'deployment = ? AND tenant_id = ? AND namespace_id = ? AND owner_id = ?';
const maxFence = '9223372036854775807';
export interface UploadStatus { id: string; revision: number; state: string; expiresAt: string; sourceExpiresAt: string; operationId?: string; sourceId?: string }
export interface OperationStatus { id: string; revision: number; kind: 'ingest' | 'result'; state: string; expiresAt: string; errorCode?: string; sourceId?: string; resultAvailable: boolean; result?: ResultDescriptor }

/** HTTP control operations. Native parsing/publication belongs to the fenced ingestion worker. */
export class DurableUploads {
  constructor(readonly metadata: TenantMetadata, readonly dispatch: DurableDispatch, readonly ledger: ObjectLedger, readonly objects: UploadObjects) {}
  private scope(context: TenantContext): SqlValue[] { this.metadata.assertContext(context); return [this.dispatch.deployment, context.tenantId, context.namespaceId, context.userId]; }
  private async schema(c: SqlConnection): Promise<void> {
    const row = (await c.query('SELECT version, checksum FROM sr_operation_schema WHERE deployment = ?', [this.dispatch.deployment]))[0];
    if (Number(row?.version) !== 1 || row?.checksum !== operationChecksum) throw new MetadataError('OPERATION_SCHEMA_REQUIRED', 503);
  }
  private async row(c: SqlConnection, context: TenantContext, id: string): Promise<SqlRow> {
    const row = (await c.query(`SELECT * FROM sr_upload WHERE ${scoped} AND upload_id = ?`, [...this.scope(context), identifier(id)]))[0];
    if (!row) throw new MetadataError('RESOURCE_NOT_FOUND', 404); return row;
  }
  private uploadStatus(row: SqlRow, now: number): UploadStatus {
    const state = row.state === 'reserved' && Number(row.expires_at) <= now ? 'expired' : String(row.state);
    return { id: String(row.upload_id), revision: Number(row.revision), state, expiresAt: new Date(Number(row.expires_at)).toISOString(), sourceExpiresAt: new Date(Number(row.source_expires_at)).toISOString(),
      ...(row.operation_id ? { operationId: String(row.operation_id) } : {}), ...(state === 'completed' ? { sourceId: String(row.source_id) } : {}) };
  }
  private async operation(c: SqlConnection, context: TenantContext, id: string): Promise<SqlRow> {
    const row = (await c.query(`SELECT * FROM sr_operation WHERE ${scoped} AND operation_id = ?`, [...this.scope(context), identifier(id)]))[0];
    if (!row) throw new MetadataError('RESOURCE_NOT_FOUND', 404); return row;
  }
  private operationStatus(row: SqlRow, now: number): OperationStatus {
    const state = ['queued', 'running'].includes(String(row.state)) && Number(row.expires_at) <= now ? 'expired' : String(row.state);
    const result = row.result ? object(JSON.parse(String(row.result))) : undefined;
    return { id: String(row.operation_id), revision: Number(row.revision), kind: row.kind as OperationStatus['kind'], state, expiresAt: new Date(Number(row.expires_at)).toISOString(),
      ...(row.error_code ? { errorCode: String(row.error_code) } : {}), ...(state === 'completed' && result?.sourceId ? { sourceId: identifier(result.sourceId) } : {}),
      resultAvailable: state === 'completed' && row.kind === 'result' && Number(row.expires_at) > now,
      ...(state === 'completed' && row.kind === 'result' && Number(row.expires_at) > now && result?.descriptor ? { result: result.descriptor as unknown as ResultDescriptor } : {}) };
  }
  private async flush(preparation: DispatchPreparation): Promise<void> {
    try { await this.dispatch.dispatch(preparation); }
    catch (error) {
      if (error instanceof MetadataError && ['INVOCATION_CLEANUP_FAILED', 'RUNTIME_QUARANTINED'].includes(error.code)) throw error;
      // The acknowledged recovery message owns pending dispatch. Return the durable receipt.
    }
  }
  private original(row: SqlRow, revisions: Revisions, epoch: number): void {
    if (Number(row.control_epoch) !== epoch) throw new MetadataError('WORKSPACE_MAINTENANCE', 503);
    if ((['authorization', 'policy', 'configuration'] as const).some(k => Number(row[`${k}_revision`]) !== revisions[k])) throw new MetadataError('METADATA_REVISED', 403);
  }
  async reserve(context: TenantContext, raw: unknown, idempotencyKey: string, recheck: () => Promise<void>): Promise<UploadStatus & { put: Awaited<ReturnType<UploadObjects['capability']>> }> {
    const request = directUploadRequest(raw), revisions = await this.metadata.revisions(context);
    await recheck();
    const preparation = await this.dispatch.prepare(context, { kind: 'upload-reserve', requestDigest: requestDigest(request), idempotencyKey, revisions });
    await recheck();
    const id = randomUUID(), sourceId = `upload_${randomUUID().replaceAll('-', '')}`;
    const receipt = await this.dispatch.commit(preparation, async (c, now) => {
      await this.schema(c);
      const sourceExpires = Date.parse(request.expiresAt), expires = Math.min(now + 600000, sourceExpires);
      if (sourceExpires <= now) throw new MetadataError('UPLOAD_EXPIRY_REQUIRED', 400);
      const active = await c.query("SELECT namespace_id, owner_id FROM sr_upload WHERE deployment = ? AND tenant_id = ? AND (state = 'reserved' AND expires_at > ? OR state = 'accepted' AND source_expires_at > ?)", [this.dispatch.deployment, context.tenantId, now, now]);
      if (active.length >= 8 || active.filter(r => r.namespace_id === context.namespaceId && r.owner_id === context.userId).length >= 2) throw new MetadataError('UPLOAD_ADMISSION_REFUSED', 429);
      const budget = (await c.query('SELECT body FROM h4_budget_config WHERE id = 1'))[0];
      if (!budget) throw new MetadataError('BUDGET_MIGRATION_REQUIRED', 503);
      const budgets = validateBudgets(JSON.parse(String(budget.body))), limits = Object.hasOwn(budgets.tenants, context.tenantId) ? budgets.tenants[context.tenantId]! : budgets.defaults;
      const rawPlan = this.ledger.plan(context, { purpose: 'raw-upload', capacityBytes: request.byteLength, mediaType: request.mediaType, checksum: request.sha256 });
      const outputPlan = this.ledger.plan(context, { purpose: 'source', capacityBytes: limits.workingBytes, mediaType: 'application/vnd.apache.parquet',
        identity: { tenant: context.tenantId, namespace: context.namespaceId, owner: context.userId, kind: 'source', resource: sourceId } });
      await this.ledger.reserve(c, context, revisions, preparation.intentId, [rawPlan], now, expires, Math.min(now + 60000, expires));
      await this.ledger.reserve(c, context, revisions, preparation.intentId, [outputPlan], now, sourceExpires);
      const control = (await c.query('SELECT epoch FROM sr_control WHERE deployment = ?', [this.dispatch.deployment]))[0]!;
      await c.query(`INSERT INTO sr_upload (${['deployment', 'tenant_id', 'namespace_id', 'owner_id', 'upload_id', 'revision', 'intent_id', 'state', 'raw_object_id', 'output_object_id', 'source_id', 'operation_id', 'request', 'expires_at', 'source_expires_at', 'control_epoch', 'authorization_revision', 'policy_revision', 'configuration_revision'].join(',')})
        VALUES (?,?,?,?,?,1,?,'reserved',?,?,?,NULL,?,?,?,?,?,?,?)`, [...this.scope(context), id, preparation.intentId, rawPlan.id, outputPlan.id, sourceId, canonicalJson(request), expires, sourceExpires,
        Number(control.epoch), revisions.authorization, revisions.policy, revisions.configuration]);
      const events: EventInput[] = [rawPlan, outputPlan].map(plan => ({ aggregateId: plan.id, aggregateRevision: 1, kind: 'object-cleanup',
        dueAt: Math.max(now + 86400000, plan.purpose === 'source' ? sourceExpires : expires), expiresAt: Math.max(now + 86400000, plan.purpose === 'source' ? sourceExpires : expires) + 86400000 }));
      return { receipt: { id, revision: 1 }, events };
    });
    await this.flush(preparation); await recheck();
    const authorized = await this.dispatch.authorized(context, revisions, async (c, { epoch, now }) => {
      const row = await this.row(c, context, receipt.id); this.original(row, revisions, epoch);
      if (row.state !== 'reserved' || Number(row.expires_at) <= now) throw new MetadataError('UPLOAD_EXPIRED', 409);
      const rawId = String(row.raw_object_id), until = Math.min(now + 60000, Number(row.expires_at));
      await this.ledger.signature(c, context, rawId, now, until);
      return { row, entry: await this.ledger.read(c, context, rawId), now, until };
    });
    const put = await this.objects.capability(authorized.entry, authorized.until);
    await recheck(); await this.dispatch.authorized(context, revisions, async (c, { now }) => {
      const row = await this.row(c, context, receipt.id);
      if (row.state !== 'reserved' || Number(row.revision) !== Number(authorized.row.revision) || Number(row.expires_at) <= now) throw new MetadataError('UPLOAD_EXPIRED', 409);
    });
    return { ...this.uploadStatus(authorized.row, authorized.now), put };
  }
  async complete(context: TenantContext, id: string, raw: unknown, idempotencyKey: string, recheck: () => Promise<void>): Promise<OperationStatus> {
    identifier(id); const input = object(structuredClone(raw), ['versionId']);
    if (typeof input.versionId !== 'string' || !input.versionId || input.versionId === 'null' || input.versionId.length > 1024 || /[\x00-\x20\x7f]/.test(input.versionId)) throw new MetadataError('UPLOAD_OBJECT_INVALID', 400);
    const revisions = await this.metadata.revisions(context); await recheck();
    const selected = await this.dispatch.authorized(context, revisions, async (c, { epoch, now }) => {
      await this.schema(c); const row = await this.row(c, context, id);
      if (row.operation_id) {
        const rawObject = await this.ledger.read(c, context, String(row.raw_object_id));
        if (rawObject.version !== input.versionId) throw new MetadataError('UPLOAD_BINDING_CONFLICT', 409);
        return { row, entry: rawObject, existing: true };
      }
      this.original(row, revisions, epoch);
      if (row.state !== 'reserved' || Number(row.expires_at) <= now) throw new MetadataError('UPLOAD_EXPIRED', 409);
      return { row, entry: await this.ledger.read(c, context, String(row.raw_object_id)), existing: false };
    });
    const verified = selected.existing ? undefined : await this.objects.head(selected.entry, input.versionId);
    await recheck();
    const preparation = await this.dispatch.prepare(context, { kind: 'upload-complete', idempotencyKey, requestDigest: requestDigest({ id, versionId: input.versionId }), revisions });
    await recheck();
    const receipt = await this.dispatch.commit(preparation, async (c, now) => {
      const row = await this.row(c, context, id);
      if (row.operation_id) {
        if ((await this.ledger.read(c, context, String(row.raw_object_id))).version !== input.versionId) throw new MetadataError('UPLOAD_BINDING_CONFLICT', 409);
        const existing = await this.operation(c, context, String(row.operation_id));
        return { receipt: { id: String(existing.operation_id), revision: Number(existing.revision) }, events: [] };
      }
      if (!verified || row.state !== 'reserved' || Number(row.revision) !== Number(selected.row.revision) || Number(row.expires_at) <= now) throw new MetadataError('UPLOAD_EXPIRED', 409);
      const operationId = randomUUID(), expiry = Math.min(now + 86400000, Number(row.source_expires_at));
      await this.ledger.bind(c, context, String(row.raw_object_id), verified);
      await c.query(`INSERT INTO sr_operation (${['deployment', 'tenant_id', 'namespace_id', 'owner_id', 'operation_id', 'revision', 'kind', 'state', 'control_epoch', 'authorization_revision', 'policy_revision', 'configuration_revision', 'upload_id', 'expires_at', 'fence', 'attempt_id', 'error_code', 'result'].join(',')})
        VALUES (?,?,?,?,?,1,'ingest','queued',?,?,?,?,?,?,0,NULL,NULL,NULL)`, [...this.scope(context), operationId, Number(row.control_epoch), revisions.authorization, revisions.policy, revisions.configuration, id, expiry]);
      await c.query(`UPDATE sr_upload SET state = 'accepted', revision = revision + 1, operation_id = ? WHERE ${scoped} AND upload_id = ?`, [operationId, ...this.scope(context), id]);
      return { receipt: { id: operationId, revision: 1 }, events: [{ aggregateId: operationId, aggregateRevision: 1, kind: 'ingest', dueAt: now, expiresAt: expiry }] };
    });
    await this.flush(preparation); return this.status(context, receipt.id, recheck);
  }
  async reservation(context: TenantContext, id: string, recheck: () => Promise<void>): Promise<UploadStatus> {
    const revisions = await this.metadata.revisions(context); await recheck();
    const result = await this.dispatch.authorized(context, revisions, async (c, { now }) => { await this.schema(c); return this.uploadStatus(await this.row(c, context, id), now); });
    await recheck(); return result;
  }
  async status(context: TenantContext, id: string, recheck: () => Promise<void>): Promise<OperationStatus> {
    const revisions = await this.metadata.revisions(context); await recheck();
    const result = await this.dispatch.authorized(context, revisions, async (c, { now }) => { await this.schema(c); return this.operationStatus(await this.operation(c, context, id), now); }, false);
    await recheck(); return result;
  }
  async cancel(context: TenantContext, kind: 'reservation' | 'operation', id: string, raw: unknown, recheck: () => Promise<void>): Promise<UploadStatus | OperationStatus> {
    const input = object(structuredClone(raw), ['expectedRevision']);
    if (!Number.isSafeInteger(input.expectedRevision) || Number(input.expectedRevision) < 1) throw new MetadataError('OPERATION_REVISION_REQUIRED', 400);
    const revisions = await this.metadata.revisions(context); await recheck();
    return this.dispatch.authorized(context, revisions, async (c, { now }) => {
      await this.schema(c);
      const row = kind === 'reservation' ? await this.row(c, context, id) : await this.operation(c, context, id);
      if (row.state === 'cancelled') return kind === 'reservation' ? this.uploadStatus(row, now) : this.operationStatus(row, now);
      if (Number(row.revision) !== input.expectedRevision) throw new MetadataError('OPERATION_CONFLICT', 409);
      if (['completed', 'failed', 'expired'].includes(String(row.state))) throw new MetadataError('OPERATION_FINAL', 409);
      const operationId = kind === 'operation' ? id : row.operation_id ? String(row.operation_id) : undefined;
      const uploadId = kind === 'reservation' ? id : row.upload_id ? String(row.upload_id) : undefined;
      if (operationId) await c.query(`UPDATE sr_operation SET state = 'cancelled', revision = revision + 1, fence = CASE WHEN fence < ${maxFence} THEN fence + 1 ELSE fence END WHERE ${scoped} AND operation_id = ? AND state IN ('queued','running')`, [...this.scope(context), operationId]);
      if (uploadId) await c.query(`UPDATE sr_upload SET state = 'cancelled', revision = revision + 1 WHERE ${scoped} AND upload_id = ? AND state IN ('reserved','accepted')`, [...this.scope(context), uploadId]);
      // Existing cleanup obligations retain storage and admission until confirmed safe reclamation.
      return kind === 'reservation' ? this.uploadStatus(await this.row(c, context, id), now) : this.operationStatus(await this.operation(c, context, id), now);
    });
  }
}
