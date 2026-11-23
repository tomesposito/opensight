import type { IncomingMessage, ServerResponse } from 'node:http';
import { TenantBudgets, type WorkScope } from './budgets.js';
import type { BlazeLimits } from './blaze.js';
import type { TenantContext } from './metadata.js';
import { MetadataError } from './metadata-db.js';
import type { Identity } from './security.js';

/** Local prep has no hosted scheduler. Reserve its full BLAZE memory envelope
 * for one download, including transmission, and refuse excess work before I/O. */
export class LocalTableDownloads {
  private readonly contexts = new WeakSet<TenantContext>();
  private readonly budgets: TenantBudgets;
  constructor(limits: BlazeLimits) {
    const defaults = { running: 1, queued: 0, executionMs: 30000, queueMs: 1,
      sourceRows: limits.maxRows, resultBytes: limits.maxBytes, workingBytes: limits.maxBytes, cacheBytes: limits.maxBytes,
      workerRssBytes: 512 * 1048576, workerHeapMb: 128, duckdbMemoryMb: 64, cellChars: limits.cellChars };
    this.budgets = new TenantBudgets({ defaults, tenants: {}, node: { ...defaults, running: 2, refreshSlots: 1 } }, context => {
      if (!this.contexts.has(context)) throw new MetadataError('TENANT_CONTEXT_REQUIRED', 403);
    });
  }
  async run(identity: Identity, request: IncomingMessage, response: ServerResponse, work: (scope: WorkScope) => Promise<void>): Promise<void> {
    const context: TenantContext = { tenantId: identity.namespaceId, namespaceId: identity.namespaceId, userId: identity.userId, authorizationRevision: 0 };
    this.contexts.add(context);
    const controller = new AbortController(), abort = () => controller.abort();
    const closed = () => { if (!response.writableFinished) abort(); };
    request.once('aborted', abort); response.once('close', closed);
    if (request.aborted || response.destroyed) abort();
    try { await this.budgets.run(context, false, async () => {}, () => work(this.budgets.current(context)), controller.signal); }
    finally { request.removeListener('aborted', abort); response.removeListener('close', closed); this.contexts.delete(context); }
  }
}
