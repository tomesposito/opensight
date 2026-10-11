import type { WorkScope } from './budgets.js';
import { BlazeTable, type CachedInput } from './blaze.js';
import { MetadataError } from './metadata-db.js';
import { object } from './metadata-resources.js';
import type { HostedCacheAdapter } from './hosted-cache.js';
import { ManifestStore, manifestArtifactLimits, type ManifestDefinition, type ManifestRead } from './manifests.js';
import { ArtifactTransfer, type LocalArtifact, type PlannedArtifactWrite } from './artifact-transfer.js';
import { artifactProvenance } from './artifact-schema.js';
import type { AttemptHandle } from './coordination.js';
import type { SqlConnection } from './metadata-db.js';
import type { ArtifactReference } from './artifact-schema.js';

export interface ArtifactWritePreparation {
  /** Must durably reserve storage and prearm recovery before resolving. */
  prepareWrite(write: PlannedArtifactWrite): Promise<void>;
  /** SQL-only conversion commits atomically with the fenced manifest. */
  publishWrite?(c: SqlConnection, write: PlannedArtifactWrite, reference: ArtifactReference): Promise<void>;
}
function invalid(): never { throw new MetadataError('ARTIFACT_CACHE_CONTEXT_INVALID', 403); }
/** One invocation/attempt. Byte handles never become authorization for another request. */
export class ArtifactCache implements HostedCacheAdapter {
  private readonly consumed: ManifestRead[] = [];
  constructor(private readonly manifests: ManifestStore, private readonly attempt: AttemptHandle, private readonly transfer: ArtifactTransfer,
    private readonly preparation?: ArtifactWritePreparation) { manifests.coordinator.describe(attempt); }
  private target(key: string, stamp?: string): ManifestDefinition {
    const details = this.manifests.coordinator.describe(this.attempt);
    let values: unknown, stamped: unknown;
    try { values = JSON.parse(key); if (stamp !== undefined) stamped = JSON.parse(stamp); } catch { return invalid(); }
    if (!Array.isArray(values) || values.length !== 5 || values[0] !== details.context.tenantId || values[1] !== details.context.namespaceId
      || values[2] !== details.context.userId || !['source', 'prep'].includes(String(values[3])) || typeof values[4] !== 'string') invalid();
    const target: ManifestDefinition = { kind: values[3] === 'source' ? 'source' : 'prepared-dataset', id: values[4], version: 1 };
    this.manifests.identity(details, target);
    if (stamp !== undefined) {
      if (!Array.isArray(stamped) || stamped.length !== 2 || !Number.isSafeInteger(stamped[0]) || stamped[0] < 1) invalid();
      const revisions = object(stamped[1], ['authorization', 'policy', 'configuration']);
      if ((['authorization', 'policy', 'configuration'] as const).some(k => revisions[k] !== details.input.revisions[k])) invalid();
      target.version = Number(stamped[0]);
    }
    return target;
  }
  private scope(scope: WorkScope): void {
    scope.check(); if (scope.tenantId !== this.manifests.coordinator.describe(this.attempt).context.tenantId) invalid();
  }
  async invalidate(key: string): Promise<void> { this.target(key); }
  async verify(): Promise<void> { await this.manifests.verify(this.attempt, this.consumed); }
  async read(scope: WorkScope, key: string, stamp: string): Promise<BlazeTable> {
    this.scope(scope); const target = this.target(key, stamp), details = this.manifests.coordinator.describe(this.attempt);
    const read = await this.manifests.read(this.attempt, target); scope.memory(read.metadataBytes);
    let local: LocalArtifact | undefined;
    try {
      local = await this.transfer.download(scope, this.manifests.identity(details, target), read.reference, manifestArtifactLimits(details));
      const table = await this.transfer.decode(scope, local, manifestArtifactLimits(details));
      await this.manifests.verify(this.attempt, [read]); this.scope(scope);
      this.consumed.push(read); return table;
    } finally { await local?.close(); }
  }
  private provenance(table: BlazeTable): CachedInput[] {
    const inputs = [...artifactProvenance(table.cachedInputs), ...this.consumed.flatMap(read => [
      ...read.reference.descriptor.cachedInputs, { datasetId: read.reference.identity.resource, refreshedAt: read.refreshedAt },
    ])], merged = new Map<string, CachedInput>();
    for (const input of inputs) {
      const previous = merged.get(input.datasetId);
      if (previous && previous.refreshedAt !== input.refreshedAt) throw new MetadataError('BLAZE_INVALIDATED', 409);
      merged.set(input.datasetId, input);
    }
    return artifactProvenance([...merged.values()]);
  }
  async refresh(scope: WorkScope, key: string, stamp: string, load: () => Promise<BlazeTable>): Promise<void> {
    this.scope(scope); const target = this.target(key, stamp), details = this.manifests.coordinator.describe(this.attempt), claim = details.input.claim;
    if (!claim || claim.kind !== target.kind || claim.id !== target.id || claim.expectedVersion !== target.version) invalid();
    if (!this.preparation) throw new MetadataError('ARTIFACT_RECOVERY_REQUIRED', 503);
    let local: LocalArtifact | undefined;
    try {
      await this.verify(); const table = await load(); this.scope(scope);
      const before = table.bytes; table.setCachedInputs(this.provenance(table)); scope.memory(table.bytes - before);
      local = await this.transfer.encode(scope, table, manifestArtifactLimits(details));
      const identity = this.manifests.identity(details, target);
      const write = this.transfer.planWrite(scope, identity, local);
      await this.preparation.prepareWrite(write);
      await this.verify(); this.scope(scope);
      const reference = await this.transfer.upload(scope, identity, local, write);
      await this.manifests.publish(this.attempt, reference, this.consumed, c => this.preparation!.publishWrite?.(c, write, reference) ?? Promise.resolve()); this.scope(scope);
    } catch (error) {
      const code = error instanceof MetadataError ? error.code : 'BLAZE_REFRESH_FAILED';
      try { await this.manifests.fail(this.attempt, /^[A-Z][A-Z0-9_]{0,95}$/.test(code) ? code : 'BLAZE_REFRESH_FAILED'); }
      catch { /* Lost authority cannot replace a newer terminal state. The original failure remains visible. */ }
      throw error;
    } finally { await local?.close(); }
  }
}
