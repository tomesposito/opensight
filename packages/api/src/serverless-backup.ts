import { randomUUID } from 'node:crypto';
import { MetadataError, type Database, type SqlConnection, type SqlRow } from './metadata-db.js';
import { checksum } from './metadata-operator.js';
import { coordinationNow, type CoordinationDialect } from './coordination-schema.js';
import { appendOperatorAudit } from './operator-audit.js';
import { databaseInventory, inventoryTables, snapshotInventory, upgradedAudit, currentInventory, namedWorkspaces, aiWarnings, usageTracking, monthlyBilling, durableAuthoring } from './serverless-backup-schema.js';

export interface CloudSnapshot {
  version: 1; id: string; deployment: string; epoch: number; createdAt: number; expiresAt: number;
  tables: Record<string, SqlRow[]>;
  objects: { key: string; version: string; checksum: string; bytes: number }[];
  keyVersions: string[]; fence: number;
}
export interface RecoveryRegistry {
  version: 1; revision: number; epoch: number; fence: number; completeThroughEpoch: number;
  backups: Record<string, string>; deletedTenants: string[]; retiredKeyVersions: string[];
}
const denied = (code: string): never => { throw new MetadataError(code, 503); };
const bounded = (n: unknown): n is number => Number.isSafeInteger(n) && Number(n) >= 0 && Number(n) < Number.MAX_SAFE_INTEGER - 1;
async function locked(c: SqlConnection, dialect: CoordinationDialect) {
  if (dialect === 'postgres') {
    if (!(await c.query("SELECT pg_try_advisory_xact_lock(hashtext(current_database()), hashtext(current_schema() || ':opensight-h8-reference')) AS acquired"))[0]?.acquired) denied('MIGRATION_BUSY');
    await c.query('SET LOCAL row_security = off');
  }
  return databaseInventory(c, dialect);
}
/** Called only after external admission/mapping drain and epoch fencing. Pins
 * are committed with the snapshot inventory; no unregistered backup is usable. */
export async function snapshotServerless(db: Database, deployment: string, id: string, expiresAt: number, keyVersions: string[], dialect: CoordinationDialect = 'postgres'): Promise<CloudSnapshot> {
  if (!/^[a-f0-9-]{36}$/.test(id) || !keyVersions.length || keyVersions.length > 32 || keyVersions.some(k => !/^[a-f0-9-]{32,64}$/.test(k))) denied('BACKUP_INPUT_INVALID');
  return db.transaction(async c => {
    const inventory = await locked(c, dialect);
    const now = await coordinationNow(c, dialect), control = (await c.query('SELECT * FROM sr_control WHERE deployment=?', [deployment]))[0];
    if (control?.state !== 'maintenance' || !bounded(expiresAt) || expiresAt <= now || expiresAt > now + 7 * 86400000) denied('BACKUP_MAINTENANCE_REQUIRED');
    if ((await c.query("SELECT 1 FROM sr_admission WHERE state='held' AND hold_until>? LIMIT 1", [now])).length) denied('WORKSPACE_DRAIN_REQUIRED');
    const rows = await c.query("SELECT * FROM sr_object WHERE deployment=? AND state<>'deleted' LIMIT 2049", [deployment]);
    if (rows.length > 2048) denied('BACKUP_LIMIT_EXCEEDED');
    const objects: CloudSnapshot['objects'] = [];
    for (const r of rows) {
      if (!['live', 'retiring'].includes(String(r.state)) || !r.object_version || !/^[A-Za-z0-9+/]{43}=$/.test(String(r.checksum)) || Buffer.from(String(r.checksum), 'base64').toString('base64') !== r.checksum || Number(r.actual_bytes) <= 0) denied('BACKUP_OBJECT_INCOMPLETE');
      objects.push({ key: String(r.object_key), version: String(r.object_version), checksum: String(r.checksum), bytes: Number(r.actual_bytes) });
      await c.query(`INSERT INTO sr_object_pin VALUES (?,?,?,?,?,?,?) ON CONFLICT (deployment,tenant_id,namespace_id,owner_id,object_id,pin_id) DO UPDATE SET expires_at=?`,
        [deployment, r.tenant_id!, r.namespace_id!, r.owner_id!, r.object_id!, `backup:${id}`, expiresAt, expiresAt]);
    }
    const tables: CloudSnapshot['tables'] = {}; let count = 0, bytes = 0, fence = 0;
    for (const table of inventoryTables(inventory)) {
      const records = await c.query(`SELECT * FROM ${table} LIMIT 100001`);
      count += records.length; bytes += Buffer.byteLength(JSON.stringify(records));
      if (count > 100000 || bytes > 64 * 1024 * 1024) denied('BACKUP_LIMIT_EXCEEDED');
      for (const row of records) for (const key of ['fence', 'generation']) if (key in row) {
        if (!bounded(Number(row[key]))) denied('BACKUP_FENCE_INVALID');
        fence = Math.max(fence, Number(row[key]));
      }
      tables[table] = records;
    }
    return { version: 1, id, deployment, epoch: Number(control!.epoch), createdAt: now, expiresAt, tables, objects, keyVersions: [...keyVersions], fence };
  });
}
function validateSnapshot(snapshot: CloudSnapshot): void {
  if (snapshot?.version !== 1 || !/^[a-f0-9-]{36}$/.test(snapshot.id) || !bounded(snapshot.epoch) || snapshot.epoch < 1
    || !bounded(snapshot.fence) || !bounded(snapshot.createdAt) || !bounded(snapshot.expiresAt)
    || snapshot.createdAt > Date.now() || snapshot.expiresAt <= snapshot.createdAt
    || snapshot.expiresAt - snapshot.createdAt > 7 * 86400000) denied('BACKUP_INVALID');
  snapshotInventory(snapshot.tables);
  let count = 0, bytes = 0;
  for (const records of Object.values(snapshot.tables)) {
    count += records.length; bytes += Buffer.byteLength(JSON.stringify(records));
    if (count > 100000 || bytes > 64 * 1024 * 1024) denied('BACKUP_LIMIT_EXCEEDED');
    for (const row of records) if (!row || Object.keys(row).some(k => !/^[a-z_]+$/.test(k))
      || Object.values(row).some(v => v !== null && typeof v !== 'string' && typeof v !== 'number')) denied('BACKUP_INVALID');
  }
}
/** The caller must fetch the newest independent registry, not the backup's copy. */
export function validateRecovery(snapshot: CloudSnapshot, registry: RecoveryRegistry, now = Date.now()): void {
  if (snapshot?.version !== 1 || registry?.version !== 1 || !bounded(registry.revision) || registry.revision < 1
    || !bounded(registry.epoch) || registry.epoch <= snapshot.epoch || !bounded(registry.fence) || registry.fence < snapshot.fence
    || !bounded(registry.completeThroughEpoch) || registry.completeThroughEpoch < snapshot.epoch) denied('RESTORE_AUTHORITY_UNAVAILABLE');
  if (!bounded(snapshot.createdAt) || !bounded(snapshot.expiresAt) || snapshot.createdAt > now || snapshot.expiresAt <= now
    || snapshot.expiresAt - snapshot.createdAt > 7 * 86400000 || registry.backups?.[snapshot.id] !== checksum(snapshot)) denied('BACKUP_UNREGISTERED');
  if (!Array.isArray(registry.deletedTenants) || !Array.isArray(registry.retiredKeyVersions) || !snapshot.keyVersions.length
    || snapshot.keyVersions.some(k => registry.retiredKeyVersions.includes(k))) denied('RESTORE_KEY_UNAVAILABLE');
  validateSnapshot(snapshot);
  if (snapshot.tables.h1_tenants!.some(t => registry.deletedTenants.includes(String(t.tenant_id)) && t.state !== 'deleted')) denied('BACKUP_DELETED_TENANT');
}
/** Restore only into a separately initialized, empty, isolated database. There
 * is deliberately no reopen/cutover/review-memberships operation here. */
export async function restoreServerless(db: Database, snapshot: CloudSnapshot, registry: RecoveryRegistry, dialect: CoordinationDialect = 'postgres'): Promise<{ state: 'held'; epoch: number; tenants: number }> {
  validateRecovery(snapshot, registry);
  const sourceTables = inventoryTables(snapshotInventory(snapshot.tables));
  return db.transaction(async c => {
    if (await locked(c, dialect) !== currentInventory) denied('BACKUP_SCHEMA_INVALID');
    if ((await c.query('SELECT 1 FROM h1_tenants LIMIT 1')).length || (await c.query('SELECT 1 FROM h8_ai_warnings LIMIT 1')).length) denied('RESTORE_TARGET_NOT_EMPTY');
    const control = await c.query('SELECT * FROM sr_control');
    if (control.length !== 1 || control[0]?.state !== 'maintenance' || control[0]?.deployment !== snapshot.deployment) denied('RESTORE_TARGET_INVALID');
    for (const table of sourceTables.filter(t => t.endsWith('_schema'))) {
      const current = await c.query(`SELECT * FROM ${table}`);
      if (checksum(current) !== checksum(snapshot.tables[table])) denied('BACKUP_SCHEMA_INVALID');
    }
    // A recognized legacy backup has no audit marker. Retain the independently
    // verified current target marker and let its audit column defaults apply.
    // New authoring tables reference sr_control; remove their empty target rows
    // before restoring a pre-authoring parent, then restore only those defaults.
    const addedAuthoring = ['sr_v1_schema', 'sr_v1_capacity', 'sr_v1_receipts', 'sr_v1_rates'].filter(t => !sourceTables.includes(t));
    const defaults = new Map<string, SqlRow[]>();
    for (const table of addedAuthoring) {
      const rows = await c.query(`SELECT * FROM ${table}`);
      if (table === 'sr_v1_capacity' ? rows.length !== 1 || rows[0]?.tenant_id !== '' || Number(rows[0]?.entries) !== 0 || Number(rows[0]?.bytes) !== 0
        : table !== 'sr_v1_schema' && rows.length) denied('RESTORE_TARGET_NOT_EMPTY');
      defaults.set(table, rows);
    }
    for (const table of [...addedAuthoring].reverse()) await c.query(`DELETE FROM ${table}`);
    for (const table of [...sourceTables].reverse()) await c.query(`DELETE FROM ${table}`);
    for (const table of sourceTables) for (const row of snapshot.tables[table]!) {
      const keys = Object.keys(row);
      await c.query(`INSERT INTO ${table} (${keys.map(k => `"${k}"`).join(',')}) VALUES (${keys.map(() => '?').join(',')})`, Object.values(row));
    }
    for (const [table, rows] of defaults) for (const row of rows) {
      const keys = Object.keys(row);
      await c.query(`INSERT INTO ${table} (${keys.map(k => `"${k}"`).join(',')}) VALUES (${keys.map(() => '?').join(',')})`, Object.values(row));
    }
    const fence = registry.fence + 1;
    await c.query("UPDATE sr_control SET state='maintenance', epoch=?", [registry.epoch]);
    await c.query("UPDATE sr_admission SET state='released', revoked=1");
    await c.query('UPDATE sr_claim SET fence=?, generation=?, attempt_id=NULL', [fence, fence]);
    await c.query("UPDATE sr_execution SET fence=?, token=?, lease_until=0, state='cancelled', error_code='RESTORE_REVIEW_REQUIRED'", [fence, randomUUID()]);
    await c.query("UPDATE sr_operation SET fence=?, revision=revision+1, state='cancelled', error_code='RESTORE_REVIEW_REQUIRED', result=NULL", [fence]);
    await c.query("UPDATE sr_upload SET state='cancelled', revision=revision+1 WHERE state IN ('reserved','accepted')");
    await c.query("UPDATE sr_dispatch_intent SET state='aborted', receipt=NULL WHERE state='prepared'");
    await c.query("UPDATE sr_outbox SET state='terminal'");
    await c.query("UPDATE h1_tenants SET state='suspended', version=version+1 WHERE state IN ('active','provisioning')");
    await c.query('UPDATE h1_revisions SET "authorization"="authorization"+1, policy=policy+1, configuration=configuration+1');
    await c.query("UPDATE h2_memberships SET status='removed', version=version+1");
    await c.query('UPDATE h2_login_selections SET consumed=1'); await c.query('UPDATE h2_sessions SET revoked=1'); await c.query('UPDATE h6_sessions SET revoked=1');
    await c.query('DELETE FROM h2_onboarding'); await c.query('DELETE FROM h2_invitations');
    await c.query('UPDATE h7_jobs SET stopped=1, next_run=NULL, version=version+1');
    await c.query("UPDATE h7_occurrences SET state='cancelled', error_code='RESTORE_REVIEW_REQUIRED' WHERE state IN ('queued','running','delivering')");
    await c.query("UPDATE h7_deliveries SET state='cancelled', message=NULL, error_code='RESTORE_REVIEW_REQUIRED' WHERE state IN ('pending','sending')");
    const period = new Date().toISOString().slice(0, 10);
    for (const ns of await c.query("SELECT n.* FROM h1_namespaces n JOIN h1_tenants t ON t.tenant_id=n.tenant_id WHERE t.state='suspended'")) {
      await c.query('INSERT INTO h8_recovery VALUES (?) ON CONFLICT (tenant_id) DO NOTHING', [ns.tenant_id!]);
      for (const metric of ['apiCalls', 'computeAttempts']) await c.query(`INSERT INTO h8_usage VALUES (?,?,?,?,9007199254740991,0) ON CONFLICT (tenant_id,namespace_id,period,metric) DO UPDATE SET admitted=9007199254740991`, [ns.tenant_id!, ns.namespace_id!, period, metric]);
    }
    await appendOperatorAudit(c, { action: 'serverless.restore-held' });
    return { state: 'held', epoch: registry.epoch, tenants: snapshot.tables.h1_tenants!.length };
  });
}

/** Registered backup is also the preservation contract for a migration. It
 * permits retained object data, while exact snapshot comparison rejects writes
 * between backup and DDL. The external controller owns drain/epoch/watchdog. */
export async function migrateRegistered(db: Database, env: NodeJS.ProcessEnv, snapshot: CloudSnapshot, registry: RecoveryRegistry, operationId: string,
  dialect: CoordinationDialect = 'postgres'): Promise<{ state: 'migrated'; epoch: number; replayed: boolean }> {
  validateSnapshot(snapshot);
  const sourceInventory = snapshotInventory(snapshot.tables);
  if (!/^[a-f0-9-]{36}$/.test(operationId) || snapshot.deployment !== env.OPENSIGHT_DEPLOYMENT || registry.epoch !== snapshot.epoch
    || registry.version !== 1 || !bounded(registry.revision) || registry.revision < 1 || !bounded(registry.fence) || registry.fence < snapshot.fence
    || !bounded(registry.completeThroughEpoch) || registry.completeThroughEpoch < snapshot.epoch
    || registry.backups[snapshot.id] !== checksum(snapshot) || snapshot.expiresAt <= Date.now()
    || snapshot.keyVersions.some(k => registry.retiredKeyVersions.includes(k)) || snapshot.tables.h1_tenants!.some(t => registry.deletedTenants.includes(String(t.tenant_id)) && t.state !== 'deleted')) denied('MIGRATION_BACKUP_REQUIRED');
  const { migrateServerless } = await import('./serverless-migration.js');
  return db.transaction(async c => {
    const liveInventory = await locked(c, dialect);
    const control = (await c.query('SELECT * FROM sr_control WHERE deployment=?', [snapshot.deployment]))[0];
    if (control?.state !== 'maintenance' || Number(control.epoch) !== snapshot.epoch) denied('WORKSPACE_MAINTENANCE_REQUIRED');
    const receipt = `cloud-migration:${operationId}`, request = checksum([snapshot.id, checksum(snapshot)]);
    const prior = (await c.query('SELECT request_hash FROM h2_requests WHERE operation_id=?', [receipt]))[0];
    if (prior && prior.request_hash !== request) denied('MIGRATION_RECEIPT_CONFLICT');
    if (liveInventory !== (prior ? currentInventory : sourceInventory)) denied('BACKUP_SCHEMA_INVALID');
    const preserved = inventoryTables(sourceInventory).filter(t => !['h8_audit', 'h2_requests'].includes(t) && !t.endsWith('_schema'));
    const fingerprint = (rows: SqlRow[]) => checksum(rows.map(checksum).sort());
    const verify = async (upgraded = !!prior) => {
      for (const table of preserved) {
        const baseline = table === 'h1_tenants' && upgraded && !namedWorkspaces(sourceInventory)
          ? snapshot.tables[table]!.map(row => ({ ...row, display_name: null, slug: null })) : snapshot.tables[table]!;
        if (fingerprint(await c.query(`SELECT * FROM ${table} LIMIT 100001`)) !== fingerprint(baseline)) denied('MIGRATION_PRESERVATION_FAILED');
      }
      if (upgraded && !namedWorkspaces(sourceInventory) && (await c.query('SELECT 1 FROM h2_login_selections LIMIT 1')).length) denied('MIGRATION_PRESERVATION_FAILED');
      if (upgraded && !monthlyBilling(sourceInventory) && (await c.query('SELECT 1 FROM h8_monthly_usage LIMIT 1')).length) denied('MIGRATION_PRESERVATION_FAILED');
      if (upgraded && !durableAuthoring(sourceInventory)) {
        for (const table of ['sr_v1_receipts', 'sr_v1_rates']) if ((await c.query(`SELECT 1 FROM ${table} LIMIT 1`)).length) denied('MIGRATION_PRESERVATION_FAILED');
        const capacity = await c.query('SELECT * FROM sr_v1_capacity');
        if (capacity.length !== 1 || capacity[0]?.tenant_id !== '' || Number(capacity[0]?.entries) !== 0 || Number(capacity[0]?.bytes) !== 0) denied('MIGRATION_PRESERVATION_FAILED');
      }
      if (upgraded && !aiWarnings(sourceInventory) && (await c.query('SELECT 1 FROM h8_ai_warnings LIMIT 1')).length) denied('MIGRATION_PRESERVATION_FAILED');
      if (upgraded && !usageTracking(sourceInventory)) for (const table of ['analytics_events', 'analytics_settings']) if ((await c.query(`SELECT 1 FROM ${table} LIMIT 1`)).length) denied('MIGRATION_PRESERVATION_FAILED');
      for (const table of inventoryTables(sourceInventory).filter(t => t.endsWith('_schema')))
        if (fingerprint(await c.query(`SELECT * FROM ${table}`)) !== fingerprint(snapshot.tables[table]!)) denied('MIGRATION_PRESERVATION_FAILED');
    };
    await verify();
    const requests = await c.query('SELECT * FROM h2_requests LIMIT 100001');
    const expectedRequests = prior ? [...snapshot.tables.h2_requests!, { operation_id: receipt, request_hash: request }] : snapshot.tables.h2_requests!;
    if (fingerprint(requests) !== fingerprint(expectedRequests)) denied('MIGRATION_PRESERVATION_FAILED');
    const audit = await c.query('SELECT * FROM h8_audit LIMIT 100001');
    const baseline = prior ? upgradedAudit(snapshot.tables.h8_audit!, sourceInventory) : snapshot.tables.h8_audit!;
    // Only the two owner migration entries bound to this operation may extend
    // the audit history. An unrelated append is a post-backup write, not a retry.
    const baselineIds = new Set(baseline.map(row => row.event_id));
    const additions = prior ? audit.filter(row => !baselineIds.has(row.event_id)) : [];
    if (fingerprint(audit.filter(row => !additions.includes(row))) !== fingerprint(baseline)
      || prior && (additions.length !== 2 || additions.filter(row => row.action === 'serverless.migrated').length !== 1
        || additions.filter(row => row.action === 'serverless.registered-migration' && row.detail === JSON.stringify({ operationId })).length !== 1)) denied('MIGRATION_PRESERVATION_FAILED');
    if (!prior) {
      await migrateServerless({ durable: true, transaction: work => work(c), close: async () => {} }, { ...env, OPENSIGHT_MAINTENANCE: 'frozen' }, dialect);
      await verify(true);
      if (await databaseInventory(c, dialect) !== currentInventory) denied('BACKUP_SCHEMA_INVALID');
      const afterAudit = await c.query('SELECT * FROM h8_audit LIMIT 100001');
      const expectedAudit = upgradedAudit(snapshot.tables.h8_audit!, sourceInventory);
      const expectedIds = new Set(expectedAudit.map(row => row.event_id));
      if (afterAudit.length !== expectedAudit.length + 1
        || fingerprint(afterAudit.filter(row => expectedIds.has(row.event_id))) !== fingerprint(expectedAudit)
        || afterAudit.filter(row => !expectedIds.has(row.event_id)).some(row => row.action !== 'serverless.migrated')
        || fingerprint(await c.query('SELECT * FROM h2_requests LIMIT 100001')) !== fingerprint(snapshot.tables.h2_requests!)) denied('MIGRATION_PRESERVATION_FAILED');
      await c.query('INSERT INTO h2_requests VALUES (?,?)', [receipt, request]);
      await appendOperatorAudit(c, { action: 'serverless.registered-migration', detail: { operationId } });
    }
    return { state: 'migrated', epoch: snapshot.epoch, replayed: !!prior };
  });
}
