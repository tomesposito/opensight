import { MetadataError, type SqlConnection, type SqlValue } from './metadata-db.js';
import { identifier } from './metadata-resources.js';
import { entitlementConfig, resourceBytes } from './hosted-usage.js';
import { objectProtection, type StorageProtection } from './object-protection.js';

/** An object still charging the namespace quota: bound, reserved, or waiting on collector proof. */
export interface PendingObject {
  id: string; purpose: 'raw-upload' | 'source' | 'cache' | 'result';
  state: 'reserved' | 'live' | 'retiring'; capacityBytes: number; bytes?: number;
  /** Earliest ms epoch at which the collector may reclaim it; mirrors ObjectLedger.retire(). */
  nextReclamationAt: number | null;
  protections: StorageProtection[];
  /** A retiring object past its reclamation time: the collector owes an exact-version deletion proof. */
  overdue: boolean;
}

export interface StorageBreakdown {
  deployment: string; tenantId: string; namespaceId: string; at: string;
  limitBytes: number; metadataBytes: number; liveBytes: number; reservedBytes: number; totalBytes: number;
  pendingCleanupBytes: number;
  /** Next eligible reclamation time across all pending objects, null when nothing is pending. */
  nextReclamationAt: number | null;
  overdueCount: number;
  pendingCleanup: PendingObject[];
  protectedObjects: PendingObject[];
  protectedBytes: number;
}

/** Matches the retention gate in ObjectLedger.retire(): retention until, 24h minimum hold, signature grace. */
export function nextReclamationAt(createdAt: number, retentionUntil: number, signatureUntil: number): number {
  return Math.max(retentionUntil, createdAt + 86400000, signatureUntil + 600000);
}

const asCount = (raw: SqlValue | undefined): number => {
  const n = Number(raw); if (raw === undefined || !Number.isSafeInteger(n) || n < 0) throw new MetadataError('OBJECT_LEDGER_UNAVAILABLE', 503); return n;
};

export function formatBytes(bytes: number): string {
  const units = ['B', 'KiB', 'MiB', 'GiB'];
  let value = bytes, unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  return `${value >= 100 ? Math.round(value) : Math.round(value * 10) / 10} ${units[unit]}`;
}

/** Read-only: never inserts the sr_storage_usage row (a missing row reports 0/0). */
export async function describeStorage(c: SqlConnection, input: { deployment: string; tenantId: string; namespaceId: string; now?: number }): Promise<StorageBreakdown> {
  const deployment = identifier(input.deployment), tenantId = identifier(input.tenantId), namespaceId = identifier(input.namespaceId);
  const now = input.now ?? Date.now();
  if (!Number.isSafeInteger(now) || now <= 0) throw new MetadataError('OBJECT_INVALID', 400);
  const limits = entitlementConfig(String((await c.query('SELECT entitlements FROM sr_limits WHERE deployment = ?', [deployment]))[0]?.entitlements ?? undefined));
  const limit = Object.hasOwn(limits.tenants, tenantId) ? limits.tenants[tenantId] : limits.defaults;
  if (!limit) throw new MetadataError('ENTITLEMENT_UNRESOLVED', 503);
  const gauge = (await c.query('SELECT reserved_bytes, live_bytes FROM sr_storage_usage WHERE deployment = ? AND tenant_id = ? AND namespace_id = ?',
    [deployment, tenantId, namespaceId]))[0];
  const reservedBytes = gauge ? asCount(gauge.reserved_bytes) : 0, liveBytes = gauge ? asCount(gauge.live_bytes) : 0;
  const metadataBytes = await resourceBytes(c, { tenantId, namespaceId });
  const pendingCleanup: PendingObject[] = [], protectedObjects: PendingObject[] = [];
  const rows = await c.query(`SELECT * FROM sr_object WHERE deployment = ? AND tenant_id = ? AND namespace_id = ? AND state <> 'deleted' ORDER BY created_at LIMIT 257`, [deployment, tenantId, namespaceId]);
  if (rows.length > 256) throw new MetadataError('STORAGE_INSPECT_LIMIT', 503);
  for (const row of rows) {
    const state = String(row.state);
    if (!['reserved', 'live', 'retiring'].includes(state)) throw new MetadataError('OBJECT_LEDGER_UNAVAILABLE', 503);
    const protection = await objectProtection(c, [deployment, tenantId, namespaceId, String(row.owner_id)], row, now);
    const reclamation = protection.until;
    const capacityBytes = asCount(row.capacity_bytes), bytes = row.actual_bytes === null ? undefined : asCount(row.actual_bytes);
    (protection.reasons.length ? protectedObjects : pendingCleanup).push({ id: String(row.object_id), purpose: String(row.purpose) as PendingObject['purpose'],
      state: state as PendingObject['state'], capacityBytes, ...(bytes === undefined ? {} : { bytes }),
      protections: protection.reasons, nextReclamationAt: reclamation,
      overdue: reclamation !== null && reclamation <= now && protection.reasons.length === 0 });
  }
  const pendingCleanupBytes = pendingCleanup.reduce((n, o) => n + (o.bytes ?? o.capacityBytes), 0);
  const times = pendingCleanup.flatMap(o => o.nextReclamationAt === null ? [] : [o.nextReclamationAt]);
  const nextReclamation = times.length ? Math.min(...times) : null;
  return { deployment, tenantId, namespaceId, at: new Date(now).toISOString(), limitBytes: limit.storageBytes,
    metadataBytes, liveBytes, reservedBytes, totalBytes: metadataBytes + liveBytes + reservedBytes,
    pendingCleanupBytes, nextReclamationAt: nextReclamation, overdueCount: pendingCleanup.filter(o => o.overdue).length, pendingCleanup,
    protectedObjects, protectedBytes: protectedObjects.reduce((n, o) => n + (o.bytes ?? o.capacityBytes), 0) };
}

/** Human sentence carried on the USAGE_LIMIT_EXCEEDED error detail. */
export function quotaExceededSummary(breakdown: StorageBreakdown, requestedBytes: number): string {
  const reclaim = breakdown.nextReclamationAt === null ? 'no pending objects'
    : `next eligible reclamation ${new Date(breakdown.nextReclamationAt).toISOString()}`;
  return `Storage limit ${formatBytes(breakdown.limitBytes)} exceeded: ${formatBytes(breakdown.totalBytes)} in use ` +
    `(live ${formatBytes(breakdown.liveBytes)}, reserved ${formatBytes(breakdown.reservedBytes)}, metadata ${formatBytes(breakdown.metadataBytes)}), ` +
    `request needs ${formatBytes(requestedBytes)}. ${formatBytes(breakdown.pendingCleanupBytes)} is retained by ` +
    `${breakdown.pendingCleanup.length} object(s) awaiting collector cleanup; ${reclaim}. ` +
    (breakdown.overdueCount ? `${breakdown.overdueCount} object(s) are eligible and awaiting cleanup proof. ` : '') +
    `Eligible times are not a promise of deletion. ` +
    ` Failed or cancelled uploads keep their reservation until the collector proves exact-version absence after the minimum 24-hour window; counters are never hand-edited.`;
}

const publicQuotaErrors = new WeakMap<MetadataError, string>();
/** Only this factory may opt a quota message into the hosted public error response. */
export function storageQuotaError(breakdown: StorageBreakdown, requestedBytes: number): MetadataError {
  const summary = quotaExceededSummary(breakdown, requestedBytes);
  const error = new MetadataError('USAGE_LIMIT_EXCEEDED', 429, { summary,
    requestedBytes, breakdown: { limitBytes: breakdown.limitBytes, metadataBytes: breakdown.metadataBytes,
      liveBytes: breakdown.liveBytes, reservedBytes: breakdown.reservedBytes,
      pendingCleanupBytes: breakdown.pendingCleanupBytes, pendingCleanupCount: breakdown.pendingCleanup.length,
      overdueCount: breakdown.overdueCount, nextReclamationAt: breakdown.nextReclamationAt === null ? null : new Date(breakdown.nextReclamationAt).toISOString() } });
  if (summary.length <= 1200 && !/[\x00-\x1f\x7f]/.test(summary)) publicQuotaErrors.set(error, summary);
  return error;
}
export function publicQuotaMessage(error: unknown): string | undefined {
  return error instanceof MetadataError ? publicQuotaErrors.get(error) : undefined;
}

/** The audited bounded maintenance operation is specified and tested before any implementation ships. */
export interface MaintenancePlan {
  action: 'recompute-gauge';
  deployment: string; tenantId: string; namespaceId: string;
  /** Ledger-derived values the op would write; the operator reviews the plan before anything runs. */
  writes: { reservedBytes: number; liveBytes: number; auditEvent: string };
}
/** Pure validation: rejects any adjustment that is not an audited, single-scope, ledger-derived gauge recompute. */
export function validateMaintenanceAdjustment(input: { action?: string; deployment?: string; tenantId?: string; namespaceId?: string;
  ledgerReservedBytes?: number; ledgerLiveBytes?: number; currentReservedBytes?: number; currentLiveBytes?: number }): MaintenancePlan {
  if (input.action !== 'recompute-gauge') throw new MetadataError('MAINTENANCE_ACTION_INVALID', 400);
  const deployment = identifier(input.deployment ?? ''), tenantId = identifier(input.tenantId ?? ''), namespaceId = identifier(input.namespaceId ?? '');
  for (const [name, value] of [['ledgerReservedBytes', input.ledgerReservedBytes], ['ledgerLiveBytes', input.ledgerLiveBytes],
      ['currentReservedBytes', input.currentReservedBytes], ['currentLiveBytes', input.currentLiveBytes]] as const) {
    if (!Number.isSafeInteger(value) || (value as number) < 0) throw new MetadataError('MAINTENANCE_ADJUSTMENT_INVALID', 400, { field: name });
  }
  const ledgerReserved = input.ledgerReservedBytes!, ledgerLive = input.ledgerLiveBytes!;
  if (ledgerReserved === input.currentReservedBytes && ledgerLive === input.currentLiveBytes) throw new MetadataError('MAINTENANCE_NOOP', 409);
  return { action: 'recompute-gauge', deployment, tenantId, namespaceId,
    writes: { reservedBytes: ledgerReserved, liveBytes: ledgerLive,
      auditEvent: `storage.maintenance.recompute-gauge:${deployment}/${tenantId}/${namespaceId}:reserved=${ledgerReserved}:live=${ledgerLive}` } };
}
