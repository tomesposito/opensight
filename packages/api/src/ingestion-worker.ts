import { disabledAnalytics, rowCountBucket } from './analytics.js';
import { randomUUID } from 'node:crypto';
import { MetadataError, type Database, type SqlConnection, type SqlRow } from './metadata-db.js';
import { TenantMetadata, type TenantContext, type Revisions } from './metadata.js';
import { insertResource, object, resourceLinks } from './metadata-resources.js';
import { appendMetadataEvent } from './metadata-outbox.js';
import { HostedUsage, entitlementConfig } from './hosted-usage.js';
import { DurableCoordinator, type AttemptHandle } from './coordination.js';
import { coordinationNow, type CoordinationDialect } from './coordination-schema.js';
import { DurableDispatch, type DispatchEnvelope, type DurableEvent } from './dispatch.js';
import { ObjectLedger } from './object-ledger.js';
import { UploadObjects } from './upload-objects.js';
import { ArtifactTransfer, type LocalArtifact } from './artifact-transfer.js';
import { type ArtifactReference, type ArtifactDescriptor } from './artifact-schema.js';
import { manifestArtifactLimits } from './manifests.js';
import { TenantBudgets } from './budgets.js';
import { containedWork, type TableResult } from './contained-work.js';
import { BlazeTable } from './blaze.js';
import { sourceBody } from './source-schema.js';
import { directUploadRequest } from './upload-request.js';
import { InvocationScope } from './runtime-scope.js';

type InspectedEvent = DurableEvent & { scope: { tenantId: string; namespaceId: string; userId: string } };
interface Claimed { operation: SqlRow; upload: SqlRow; fence: string }
const maximumFence = '9223372036854775807';
const terminalStates = ['completed', 'failed', 'expired', 'cancelled'];

/** One durable ingest attempt. SQL publication rights never come from the SQS receipt. */
export class IngestionWorker {
  constructor(private readonly database: Database, private readonly metadata: TenantMetadata, private readonly coordinator: DurableCoordinator,
    private readonly dispatch: DurableDispatch, private readonly ledger: ObjectLedger, private readonly objects: UploadObjects,
    private readonly transfer: ArtifactTransfer, private readonly budgets: TenantBudgets, private readonly closeTransfers: () => Promise<void>,
    private readonly dialect: CoordinationDialect = 'postgres', private readonly analytics = disabledAnalytics) {}
  private async row(c: SqlConnection, event: InspectedEvent): Promise<SqlRow> {
    const row = (await c.query(`SELECT *, CAST(fence AS TEXT) AS fence FROM sr_operation WHERE deployment = ? AND tenant_id = ? AND namespace_id = ? AND owner_id = ? AND operation_id = ?${this.dialect === 'postgres' ? ' FOR UPDATE' : ''}`,
      [this.coordinator.deployment, event.scope.tenantId, event.scope.namespaceId, event.scope.userId, event.aggregateId]))[0];
    if (!row || row.kind !== 'ingest' || event.kind !== 'ingest' || event.aggregateRevision !== 1 || Number(row.control_epoch) !== event.epoch) throw new MetadataError('OPERATION_EVENT_INVALID', 409);
    return row;
  }
  private async live(c: SqlConnection, event: InspectedEvent, attempt: AttemptHandle, claim: Claimed): Promise<void> {
    const row = await this.row(c, event);
    if (row.state !== 'running' || row.attempt_id !== attempt.attemptId || row.fence !== claim.fence) throw new MetadataError('OPERATION_CLAIM_LOST', 409);
    if (Number(row.expires_at) <= await coordinationNow(c, this.dialect)) throw new MetadataError('UPLOAD_EXPIRED', 409);
    const upload = (await c.query('SELECT state, operation_id, source_expires_at FROM sr_upload WHERE deployment = ? AND upload_id = ?', [this.coordinator.deployment, row.upload_id!]))[0];
    if (upload?.state !== 'accepted' || upload.operation_id !== event.aggregateId || Number(upload.source_expires_at) <= await coordinationNow(c, this.dialect)) throw new MetadataError('UPLOAD_EXPIRED', 409);
  }
  private revisions(row: SqlRow): Revisions { return { authorization: Number(row.authorization_revision), policy: Number(row.policy_revision), configuration: Number(row.configuration_revision) }; }
  private async fail(event: InspectedEvent, code: string, attempt?: AttemptHandle, claim?: Claimed): Promise<void> {
    await this.database.transaction(async c => {
      const control = (await c.query(`SELECT epoch FROM sr_control WHERE deployment = ?${this.dialect === 'postgres' ? ' FOR UPDATE' : ''}`, [this.coordinator.deployment]))[0];
      if (Number(control?.epoch) !== event.epoch) throw new MetadataError('WORKSPACE_MAINTENANCE', 503);
      // Denial/cleanup also works after suspension, membership removal or authorization change.
      await c.query('UPDATE h1_tenants SET version = version WHERE tenant_id = ?', [event.scope.tenantId]);
      const row = await this.row(c, event);
      if (!terminalStates.includes(String(row.state))) {
        if (attempt && (row.attempt_id !== attempt.attemptId || row.fence !== claim?.fence)) throw new MetadataError('OPERATION_CLAIM_LOST', 409);
        await c.query("UPDATE sr_operation SET state = 'failed', revision = revision + 1, error_code = ? WHERE deployment = ? AND operation_id = ?", [code, this.coordinator.deployment, event.aggregateId]);
        await c.query("UPDATE sr_upload SET state = 'failed', revision = revision + 1 WHERE deployment = ? AND upload_id = ? AND state = 'accepted' AND operation_id = ?", [this.coordinator.deployment, row.upload_id!, event.aggregateId]);
      }
      await this.dispatch.terminal(c, event.eventId, event.epoch);
    });
  }
  async run(envelope: DispatchEnvelope, remainingMs: number): Promise<void> {
    const event = await this.dispatch.inspect(envelope); if (!event) return;
    if (event.kind !== 'ingest') throw new MetadataError('OPERATION_EVENT_INVALID', 409);
    let attempt: AttemptHandle | undefined, claim: Claimed | undefined, local: LocalArtifact | undefined, published = false;
    let renewal: Promise<unknown> | undefined, timer: ReturnType<typeof setInterval> | undefined;
    try {
      const original = await this.database.transaction(c => this.row(c, event));
      if (terminalStates.includes(String(original.state))) { await this.fail(event, 'OPERATION_FINAL'); return; }
      const context = await this.metadata.authenticate(null, async () => ({ namespaceId: event.scope.namespaceId, userId: event.scope.userId }));
      if (context.tenantId !== event.scope.tenantId) throw new MetadataError('UNKNOWN_PRINCIPAL', 403);
      const revisions = this.revisions(original);
      attempt = await this.coordinator.admit(context, { attemptId: randomUUID(), class: 'query', revisions, platformRemainingMs: Math.min(120000, remainingMs) }, async (c, admitted) => {
        const row = await this.row(c, event), now = await coordinationNow(c, this.dialect);
        if (terminalStates.includes(String(row.state))) throw new MetadataError('OPERATION_FINAL', 409);
        if (Number(row.expires_at) <= now) throw new MetadataError('UPLOAD_EXPIRED', 409);
        if (row.state === 'running' && row.attempt_id) {
          const previous = (await c.query('SELECT state, hold_until FROM sr_admission WHERE deployment = ? AND attempt_id = ?', [this.coordinator.deployment, row.attempt_id]))[0];
          if (previous?.state === 'held' && Number(previous.hold_until) > now) throw new MetadataError('OPERATION_BUSY', 409);
        }
        if (String(row.fence) === maximumFence) throw new MetadataError('CLAIM_FENCE_EXHAUSTED', 503);
        const upload = (await c.query('SELECT * FROM sr_upload WHERE deployment = ? AND tenant_id = ? AND namespace_id = ? AND owner_id = ? AND upload_id = ?',
          [this.coordinator.deployment, context.tenantId, context.namespaceId, context.userId, row.upload_id!]))[0];
        if (!upload || upload.state !== 'accepted' || upload.operation_id !== event.aggregateId || Number(upload.source_expires_at) <= now) throw new MetadataError('UPLOAD_EXPIRED', 409);
        // The admission callback runs after allocation, in its same transaction.
        await c.query("UPDATE sr_operation SET state = 'running', revision = revision + 1, fence = fence + 1, attempt_id = ? WHERE deployment = ? AND operation_id = ?", [admitted.input.attemptId, this.coordinator.deployment, event.aggregateId]);
        const updated = await this.row(c, event); claim = { operation: updated, upload, fence: String(updated.fence) };
      });
      const held = attempt, claimed = claim!, details = this.coordinator.describe(held), limits = manifestArtifactLimits(details);
      const request = directUploadRequest(JSON.parse(String(claimed.upload.request))), sourceId = String(claimed.upload.source_id), objectId = String(claimed.upload.output_object_id);
      const identity = { tenant: context.tenantId, namespace: context.namespaceId, owner: context.userId, kind: 'source' as const, resource: sourceId };
      await this.budgets.run(context, false, async () => {
        if (!published) await this.coordinator.publish(held, c => this.live(c, event, held, claimed));
      }, async () => {
        const scope = this.budgets.current(context);
        timer = setInterval(() => {
          if (renewal) return;
          renewal = this.coordinator.renew(held).catch(() => scope.cancel()).finally(() => { renewal = undefined; });
        }, 10000);
        const output = await this.coordinator.publish(held, async c => { await this.live(c, event, held, claimed); return this.ledger.read(c, context, objectId); });
        let reference: ArtifactReference | undefined;
        if (output.descriptor) reference = await this.transfer.inspect(scope, identity, output.key, JSON.parse(output.descriptor) as ArtifactDescriptor, limits);
        if (!reference) {
          const raw = await this.coordinator.publish(held, async c => { await this.live(c, event, held, claimed); return this.ledger.read(c, context, String(claimed.upload.raw_object_id)); });
          const bytes = await this.objects.bytes(scope, raw);
          const parsed = await containedWork<TableResult>(scope, { kind: 'upload', request: { config: request.config, data: bytes, ...(request.columns ? { columns: request.columns } : {}) } },
            { maxRows: limits.rows, cellChars: limits.cellChars, maxBytes: limits.decodedBytes, datasetBytes: limits.decodedBytes });
          scope.rows(parsed.rows.length);
          const table = new BlazeTable({ maxRows: limits.rows, cellChars: limits.cellChars, maxBytes: limits.decodedBytes, datasetBytes: limits.decodedBytes });
          table.start(parsed.columns); for (const row of parsed.rows) { scope.check(); table.row(row); } scope.memory(table.bytes);
          local = await this.transfer.encode(scope, table, limits);
          const planned = this.transfer.planWrite(scope, identity, local, output.key);
          await this.coordinator.publish(held, async c => {
            await this.live(c, event, held, claimed);
            await this.ledger.stage(c, context, objectId, { checksum: Buffer.from(planned.descriptor.sha256, 'hex').toString('base64'), descriptor: JSON.stringify(planned.descriptor) });
          });
          reference = await this.transfer.upload(scope, identity, local, planned);
        }
        scope.check();
        const body = sourceBody({ binding: { version: 4, connectorId: 'file', state: 'active', objectId, columns: reference.descriptor.columns,
          rowCount: reference.descriptor.rowCount, expiresAt: request.expiresAt }, policy: request.policy });
        // H1 follows and validates every policy principal in the publication transaction.
        resourceLinks({ kind: 'source', id: sourceId, ownerId: context.userId }, object(body));
        await this.coordinator.publish(held, async c => {
          await this.live(c, event, held, claimed);
          const configured = (await c.query('SELECT entitlements FROM sr_limits WHERE deployment = ?', [this.coordinator.deployment]))[0];
          const usage = new HostedUsage(this.database, entitlementConfig(configured ? String(configured.entitlements) : undefined), Date.now, this.coordinator.deployment);
          const before = await usage.storageBytes(c, context);
          await this.ledger.bind(c, context, objectId, { version: reference!.version, bytes: reference!.descriptor.encodedBytes,
            checksum: Buffer.from(reference!.descriptor.sha256, 'hex').toString('base64'), descriptor: JSON.stringify(reference!.descriptor) });
          await insertResource(c, context, { kind: 'source', id: sourceId, ownerId: context.userId }, object(body));
          await c.query('UPDATE h1_revisions SET policy = policy + 1, configuration = configuration + 1 WHERE tenant_id = ? AND namespace_id = ?', [context.tenantId, context.namespaceId]);
          await appendMetadataEvent(c, context, 'metadata.changed'); await usage.storage(c, context, before);
          await c.query("UPDATE sr_operation SET state = 'completed', revision = revision + 1, result = ? WHERE deployment = ? AND operation_id = ?", [JSON.stringify({ sourceId }), this.coordinator.deployment, event.aggregateId]);
          await c.query("UPDATE sr_upload SET state = 'completed', revision = revision + 1 WHERE deployment = ? AND upload_id = ?", [this.coordinator.deployment, claimed.upload.upload_id!]);
          await this.dispatch.terminal(c, event.eventId, event.epoch);
        });
        published = true;
        this.analytics.track(context, { name: 'dataset_uploaded', props: { sourceType: 'file', rowCountBucket: rowCountBucket(reference.descriptor.rowCount) } });
      }, InvocationScope.current()?.signal);
    } catch (error) {
      if (!published && error instanceof MetadataError && error.status < 500 && (attempt || !['TENANT_BUDGET_EXCEEDED', 'NODE_ADMISSION_REFUSED', 'OPERATION_BUSY'].includes(error.code))) {
        await this.fail(event, /^[A-Z][A-Z0-9_]{0,95}$/.test(error.code) ? error.code : 'UPLOAD_INGESTION_FAILED', attempt, claim); return;
      }
      throw error;
    } finally {
      clearInterval(timer); await renewal; await local?.close();
      if (attempt) {
        // No SQL release after invocation cancellation: retain the full containment deadline.
        await this.closeTransfers();
        try { InvocationScope.current()?.check(); await this.coordinator.release(attempt); }
        catch (error) { if (!(error instanceof MetadataError) || !['INVOCATION_DEADLINE_EXCEEDED', 'RUNTIME_QUARANTINED'].includes(error.code)) throw error; }
      }
    }
  }
}
