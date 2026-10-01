import { BlazeTable } from './blaze.js';
import { budgetError, type TenantBudgets, type WorkScope } from './budgets.js';
interface Entry { tenant: string; stamp: string; bytes: number; table?: BlazeTable; error: string; used: number }
/** Tenant-local LRU only. Another tenant's snapshots are never eviction victims. */
export class HostedCache {
  private readonly entries = new Map<string, Entry>();
  private sequence = 0;
  constructor(private readonly budgets: TenantBudgets) {}
  private size(tenant?: string): number { return [...this.entries.values()].reduce((n, e) => n + (tenant === undefined || e.tenant === tenant ? e.bytes : 0), 0); }
  private reserve(scope: WorkScope, key: string, bytes: number): void {
    const old = this.entries.get(key)?.bytes ?? 0;
    for (const [candidate, e] of [...this.entries].filter(([k, e]) => k !== key && e.tenant === scope.tenantId && e.error !== 'BLAZE_REFRESH_IN_PROGRESS').sort((a, b) => a[1].used - b[1].used)) {
      if (this.size(scope.tenantId) - old + bytes <= scope.limits.cacheBytes && this.size() - old + bytes <= this.budgets.config.node.cacheBytes) break;
      this.entries.delete(candidate);
    }
    if (this.size(scope.tenantId) - old + bytes > scope.limits.cacheBytes) budgetError('TENANT_BUDGET_EXCEEDED');
    if (this.size() - old + bytes > this.budgets.config.node.cacheBytes) budgetError('NODE_ADMISSION_REFUSED');
  }
  invalidate(key: string): void { this.entries.delete(key); }
  read(scope: WorkScope, key: string, stamp: string): BlazeTable {
    scope.check(); const e = this.entries.get(key);
    if (!e || e.tenant !== scope.tenantId || e.stamp !== stamp) { if (e?.tenant === scope.tenantId) this.entries.delete(key); budgetError('BLAZE_NOT_READY'); }
    if (!e.table) budgetError(e.error);
    e.used = ++this.sequence; return e.table;
  }
  async refresh(scope: WorkScope, key: string, stamp: string, load: () => Promise<BlazeTable>): Promise<void> {
    scope.check();
    if (this.entries.get(key)?.error === 'BLAZE_REFRESH_IN_PROGRESS') budgetError('BLAZE_BUSY');
    const overhead = 256 + 2 * (key.length + stamp.length);
    this.reserve(scope, key, overhead);
    const e: Entry = { tenant: scope.tenantId, stamp, bytes: overhead, error: 'BLAZE_REFRESH_IN_PROGRESS', used: ++this.sequence };
    this.entries.set(key, e); // Remove previous readability before the first source read.
    scope.onFailure(() => { if (this.entries.get(key) === e) { e.table = undefined; e.bytes = overhead; e.error = scope.signal.aborted ? 'EXECUTION_CANCELLED' : 'BLAZE_NOT_READY'; } });
    try {
      const result = await load(); scope.check();
      if (this.entries.get(key) !== e) budgetError('BLAZE_INVALIDATED');
      this.reserve(scope, key, result.bytes + overhead); scope.check();
      e.bytes = result.bytes + overhead; e.table = result; e.error = ''; e.used = ++this.sequence;
    } catch (error) {
      e.table = undefined; e.bytes = overhead;
      e.error = scope.signal.aborted ? 'EXECUTION_CANCELLED' : error && typeof error === 'object' && 'code' in error ? String(error.code) : 'BLAZE_REFRESH_FAILED';
      throw error;
    }
  }
  bytes(tenant?: string): number { return this.size(tenant); }
}
