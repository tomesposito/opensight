import { randomUUID } from 'node:crypto';
import { MetadataError } from './metadata-db.js';
import type { TenantContext, Revisions } from './metadata.js';
import type { Admission, HostedWorkAdapter, HostedWorkRequest } from './hosted-data.js';
import type { HostedCacheAdapter } from './hosted-cache.js';
import { DurableCoordinator, type AdmissionInput, type AttemptHandle } from './coordination.js';
import { ManifestStore } from './manifests.js';
import { ArtifactCache } from './artifact-cache.js';
import { DurableArtifactWrites } from './artifact-writes.js';
import { ArtifactTransfer } from './artifact-transfer.js';
import { ObjectLedger } from './object-ledger.js';
import { DurableDispatch } from './dispatch.js';
import { TenantBudgets } from './budgets.js';
import { InvocationScope } from './runtime-scope.js';

/** One HTTP invocation owns one durable admission until its response is checked. */
export class ServerlessWork implements HostedWorkAdapter {
  private handle?: AttemptHandle;
  private adapter?: ArtifactCache;
  private finished = false;
  private finishing?: Promise<void>;
  private expiresAt = Infinity;
  constructor(readonly coordinator: DurableCoordinator, readonly manifests: ManifestStore, private readonly dispatch: DurableDispatch,
    private readonly ledger: ObjectLedger, private readonly transfer: ArtifactTransfer, private readonly budgets: TenantBudgets,
    private readonly invocation: InvocationScope, private readonly closeTransfers: () => Promise<void>) {}
  private current(): ArtifactCache {
    if (this.finished || !this.adapter) throw new MetadataError('ATTEMPT_HANDLE_REQUIRED', 403);
    this.invocation.check(); return this.adapter;
  }
  readonly cache: HostedCacheAdapter = {
    invalidate: async () => { /* Metadata revisions invalidate durable read certificates. */ },
    read: (scope, key, stamp) => this.current().read(scope, key, stamp),
    refresh: (scope, key, stamp, load) => this.current().refresh(scope, key, stamp, load),
    verify: async () => { if (this.adapter) await this.current().verify(); },
  };
  attempt(context: TenantContext): AttemptHandle {
    if (this.finished || !this.handle || this.coordinator.describe(this.handle).context !== context) throw new MetadataError('ATTEMPT_HANDLE_REQUIRED', 403);
    this.invocation.check(); return this.handle;
  }
  sourceExpiry(): number { return this.expiresAt; }
  async run<T>(context: TenantContext, refresh: boolean, revisions: Revisions, admissions: readonly Admission[], request: HostedWorkRequest | undefined, work: () => Promise<T>): Promise<T> {
    if (this.finished) throw new MetadataError('EXECUTION_CANCELLED', 409);
    this.invocation.check();
    for (const admission of admissions) if (admission.source.binding.expiresAt) this.expiresAt = Math.min(this.expiresAt, Date.parse(admission.source.binding.expiresAt));
    if (!this.handle) {
      if (refresh && !request) throw new MetadataError('MANIFEST_REFRESH_REQUIRED', 403);
      const input: AdmissionInput = { attemptId: randomUUID(), class: refresh ? 'refresh' : 'query', revisions,
        platformRemainingMs: Math.min(28000, Math.floor(this.invocation.deadline - Date.now())),
        ...(refresh ? { claim: { kind: request!.claim.kind, id: request!.claim.id, expectedVersion: request!.claim.version } } : {}) };
      const preparation = refresh ? new DurableArtifactWrites(this.manifests, this.dispatch, this.ledger, context, input) : undefined;
      this.handle = preparation ? await preparation.admit(request!.definitions) : await this.manifests.admit(context, input);
      this.adapter = new ArtifactCache(this.manifests, this.handle, this.transfer, preparation);
    } else {
      const current = this.coordinator.describe(this.attempt(context));
      if (current.input.class !== (refresh ? 'refresh' : 'query') || JSON.stringify(current.input.revisions) !== JSON.stringify(revisions)
        || refresh && (!request || current.input.claim?.id !== request.claim.id || current.input.claim.kind !== request.claim.kind
          || current.input.claim.expectedVersion !== request.claim.version)) throw new MetadataError('ATTEMPT_CONTEXT_CHANGED', 403);
    }
    await this.current().verify();
    try { const result = await work(); await this.current().verify(); return result; }
    catch (error) {
      if (refresh) try { await this.manifests.fail(this.handle, error instanceof MetadataError ? error.code : 'BLAZE_REFRESH_FAILED'); }
      catch { /* A lost fence cannot overwrite the new owner. */ }
      throw error;
    }
  }
  /** Before InvocationScope.dispose closes SQL. Aborted invocations retain the full hold. */
  finish(): Promise<void> { return this.finishing ??= (async () => {
    this.finished = true;
    await this.budgets.shutdown();
    await this.closeTransfers();
    if (this.handle && !this.invocation.signal.aborted) await this.coordinator.release(this.handle);
  })(); }
}
