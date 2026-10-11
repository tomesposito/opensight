import { randomUUID } from 'node:crypto';
import { MetadataError, type SqlConnection } from './metadata-db.js';
import { type TenantContext } from './metadata.js';
import { object } from './metadata-resources.js';
import { ManifestStore, type ManifestDefinition } from './manifests.js';
import { type AdmissionInput, type AttemptHandle } from './coordination.js';
import { DurableDispatch, type DispatchPreparation, type EventInput } from './dispatch.js';
import { ObjectLedger } from './object-ledger.js';
import { type PlannedArtifactWrite } from './artifact-transfer.js';
import { type ArtifactReference } from './artifact-schema.js';
import { type ArtifactWritePreparation } from './artifact-cache.js';
import { requestDigest } from './upload-request.js';

/** Recovery covers both the superseded manifest and the newly allocated write. */
export class DurableArtifactWrites implements ArtifactWritePreparation {
  private attempt?: AttemptHandle;
  private readonly objects = new WeakMap<PlannedArtifactWrite, string>();
  constructor(private readonly manifests: ManifestStore, private readonly dispatch: DurableDispatch, private readonly ledger: ObjectLedger,
    private readonly context: TenantContext, private readonly input: AdmissionInput) {}
  private async flush(preparation: DispatchPreparation): Promise<void> {
    try { await this.dispatch.dispatch(preparation); }
    catch (error) {
      if (error instanceof MetadataError && ['INVOCATION_CLEANUP_FAILED', 'RUNTIME_QUARANTINED'].includes(error.code)) throw error;
      // Prearmed recovery owns a missing external receipt.
    }
  }
  async admit(definitions: readonly ManifestDefinition[]): Promise<AttemptHandle> {
    if (this.attempt) throw new MetadataError('ATTEMPT_ALREADY_ADMITTED', 409);
    if (this.input.class !== 'refresh' || !this.input.claim) throw new MetadataError('MANIFEST_REFRESH_REQUIRED', 403);
    const preparation = await this.dispatch.prepare(this.context, { kind: 'artifact-refresh', requestDigest: requestDigest({ input: this.input, definitions }),
      idempotencyKey: this.input.attemptId, revisions: this.input.revisions });
    const { context, input } = this, claim = input.claim!;
    this.attempt = await this.manifests.admit(context, input, definitions, c => this.dispatch.commitOn(c, preparation, async (c, now) => {
      const events: EventInput[] = [];
      const prior = (await c.query(`SELECT body FROM sr_manifest_versions WHERE deployment = ? AND tenant_id = ? AND namespace_id = ? AND owner_id = ? AND kind = ? AND resource_id = ? ORDER BY generation DESC LIMIT 1`,
        [this.dispatch.deployment, context.tenantId, context.namespaceId, context.userId, claim.kind, claim.id]))[0];
      if (prior) {
        const document = String(prior.body); if (Buffer.byteLength(document) > 1024 * 1024) throw new MetadataError('MANIFEST_LIMIT_EXCEEDED', 429);
        const reference = object(object(JSON.parse(document)).reference);
        if (typeof reference.key !== 'string' || typeof reference.version !== 'string') throw new MetadataError('ARTIFACT_RECOVERY_REQUIRED', 503);
        const old = (await c.query("SELECT object_id, state FROM sr_object WHERE deployment = ? AND tenant_id = ? AND namespace_id = ? AND owner_id = ? AND object_key = ? AND object_version = ? AND purpose = 'cache'",
          [this.dispatch.deployment, context.tenantId, context.namespaceId, context.userId, reference.key, reference.version]))[0];
        if (!old || old.state === 'reserved') throw new MetadataError('ARTIFACT_RECOVERY_REQUIRED', 503);
        if (old.state === 'live') {
          const id = randomUUID(), due = now + 86400000;
          await c.query('UPDATE sr_object SET retention_until = CASE WHEN retention_until < ? THEN ? ELSE retention_until END WHERE deployment = ? AND object_id = ?', [due, due, this.dispatch.deployment, old.object_id!]);
          await c.query('INSERT INTO sr_cleanup_target VALUES (?,?,?,?,?,?,?)', [this.dispatch.deployment, context.tenantId, context.namespaceId, context.userId, id, old.object_id!, preparation.intentId]);
          events.push({ aggregateId: id, aggregateRevision: 1, kind: 'artifact-cleanup', dueAt: due, expiresAt: due + 86400000 });
        }
      }
      return { receipt: { id: input.attemptId, revision: 1 }, events };
    }).then(() => {}));
    await this.flush(preparation); return this.attempt;
  }
  async prepareWrite(write: PlannedArtifactWrite): Promise<void> {
    if (!this.attempt) throw new MetadataError('ATTEMPT_HANDLE_REQUIRED', 403);
    await this.manifests.coordinator.publish(this.attempt, async () => {});
    const preparation = await this.dispatch.prepare(this.context, { kind: 'artifact-write', requestDigest: requestDigest(write), idempotencyKey: randomUUID(), revisions: this.input.revisions });
    const plan = this.ledger.plan(this.context, { purpose: 'cache', capacityBytes: write.descriptor.encodedBytes, mediaType: 'application/vnd.apache.parquet',
      checksum: Buffer.from(write.descriptor.sha256, 'hex').toString('base64'), artifact: write });
    const receipt = await this.dispatch.commit(preparation, async (c, now) => {
      await this.ledger.reserve(c, this.context, this.input.revisions, preparation.intentId, [plan], now, now + 86400000);
      await this.ledger.stage(c, this.context, plan.id, { checksum: Buffer.from(write.descriptor.sha256, 'hex').toString('base64'), descriptor: JSON.stringify(write.descriptor) });
      return { receipt: { id: plan.id, revision: 1 }, events: [{ aggregateId: plan.id, aggregateRevision: 1, kind: 'object-cleanup', dueAt: now + 86400000, expiresAt: now + 172800000 }] };
    });
    this.objects.set(write, receipt.id); await this.flush(preparation);
  }
  async publishWrite(c: SqlConnection, write: PlannedArtifactWrite, reference: ArtifactReference): Promise<void> {
    const id = this.objects.get(write);
    if (!id || write.key !== reference.key || JSON.stringify(write.descriptor) !== JSON.stringify(reference.descriptor)) throw new MetadataError('ARTIFACT_RECOVERY_REQUIRED', 503);
    await this.ledger.bind(c, this.context, id, { version: reference.version, bytes: reference.descriptor.encodedBytes,
      checksum: Buffer.from(reference.descriptor.sha256, 'hex').toString('base64'), descriptor: JSON.stringify(reference.descriptor) });
  }
}
