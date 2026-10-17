import { createHash } from 'node:crypto';
import { MetadataError, type Database, type SqlConnection } from './metadata-db.js';
import { migrateServerless, serverlessTables } from './serverless-migration.js';
import { executionChecksum, executionTables } from './execution-schema.js';
import { objectProtection } from './object-protection.js';
import { coordinationNow, type CoordinationDialect } from './coordination-schema.js';
import { appendOperatorAudit } from './operator-audit.js';

export const pilotDigest = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export interface PilotPlan {
  version: 1; deployment: string; operationId: string; current: string; target: string;
  configuration: string; expectedEpoch: number; expiresAt: number;
}
export function pilotPlan(value: unknown, now = Date.now()): PilotPlan {
  const p = value as PilotPlan;
  if (!p || Object.keys(p).sort().join() !== 'configuration,current,deployment,expectedEpoch,expiresAt,operationId,target,version'
    || p.version !== 1 || !/^[a-z][a-z0-9-]{0,62}$/.test(p.deployment)
    || !/^[a-f0-9-]{36}$/.test(p.operationId) || ![p.current, p.target, p.configuration].every(s => /^[a-f0-9]{64}$/.test(s))
    || p.current === p.target || !Number.isSafeInteger(p.expectedEpoch) || p.expectedEpoch < 1
    || !Number.isSafeInteger(p.expiresAt) || p.expiresAt <= now || p.expiresAt > now + 24 * 3600000) throw new MetadataError('PILOT_PLAN_INVALID', 503);
  return p;
}
const preserved = serverlessTables.filter(t => !['sr_control', 'h2_requests', 'h8_audit', ...executionTables].includes(t));
async function evidence(c: SqlConnection) {
  const tables: Record<string, { rows: number; digest: string }> = {};
  for (const table of [...preserved, 'h2_requests', 'h8_audit']) {
    const rows = await c.query(`SELECT * FROM ${table} LIMIT 2049`);
    if (rows.length > 2048) throw new MetadataError('PILOT_INVENTORY_LIMIT', 503);
    const canonical = rows.map(row => JSON.stringify(Object.fromEntries(Object.entries(row).sort(([a], [b]) => a.localeCompare(b))))).sort();
    tables[table] = { rows: rows.length, digest: pilotDigest(canonical) };
  }
  return { tables, preserved: pilotDigest(preserved.map(t => [t, tables[t]])) };
}
async function preconditions(c: SqlConnection, p: PilotPlan, dialect: CoordinationDialect) {
  const now = await coordinationNow(c, dialect), blocked: Record<string, number> = {};
  const checks: [string, string, (string | number)[]][] = [
    ['admissions', "SELECT 1 FROM sr_admission WHERE deployment = ? AND state = 'held' AND hold_until > ?", [p.deployment, now]],
    ['operations', "SELECT 1 FROM sr_operation WHERE deployment = ? AND state IN ('queued','running')", [p.deployment]],
    ['uploads', "SELECT 1 FROM sr_upload WHERE deployment = ? AND state IN ('reserved','accepted') AND expires_at > ?", [p.deployment, now]],
    ['obligations', "SELECT 1 FROM sr_outbox WHERE deployment = ? AND state <> 'terminal' AND expires_at > ?", [p.deployment, now]],
    ['intents', "SELECT 1 FROM sr_dispatch_intent WHERE deployment = ? AND state = 'prepared' AND commit_until > ?", [p.deployment, now]],
    ['occurrences', "SELECT 1 FROM h7_occurrences WHERE state IN ('queued','running','delivering')", []],
    ['deliveries', "SELECT 1 FROM h7_deliveries WHERE state IN ('pending','sending')", []],
  ];
  for (const [key, query, values] of checks) blocked[key] = (await c.query(query + ' LIMIT 2049', values)).length;
  const jobs = await c.query('SELECT spec, stopped FROM h7_jobs LIMIT 2049');
  if (jobs.length > 2048) throw new MetadataError('PILOT_INVENTORY_LIMIT', 503);
  blocked.jobs = jobs.filter(j => Number(j.stopped) !== 1 && JSON.parse(String(j.spec)).enabled !== false).length;
  const objects = await c.query("SELECT * FROM sr_object WHERE deployment = ? AND state <> 'deleted' LIMIT 257", [p.deployment]);
  if (objects.length > 256) throw new MetadataError('PILOT_INVENTORY_LIMIT', 503);
  blocked.objects = 0;
  for (const row of objects) {
    const protection = await objectProtection(c, [p.deployment, row.tenant_id!, row.namespace_id!, row.owner_id!], row, now);
    if (protection.until === null || protection.until > now || protection.reasons.length) blocked.objects++;
  }
  return blocked;
}
function clear(blocked: Record<string, number>) {
  if (Object.values(blocked).some(n => n !== 0)) throw new MetadataError('PILOT_LIVE_WORK', 503);
}
export interface PilotAuthority { planDigest: string; epoch: number; phase: string; backup?: string; preserved?: string }
export type PilotCommand = 'inspect' | 'freeze' | 'migrate' | 'verify' | 'reopen';
export async function pilotRelease(db: Database, env: NodeJS.ProcessEnv, raw: PilotPlan, command: PilotCommand,
  authority?: PilotAuthority, dialect: CoordinationDialect = 'postgres') {
  const p = pilotPlan(raw), digest = pilotDigest(p);
  if (!['inspect', 'freeze', 'migrate', 'verify', 'reopen'].includes(command) || env.OPENSIGHT_DEPLOYMENT !== p.deployment) throw new MetadataError('PILOT_COMMAND_INVALID', 503);
  if (command !== 'inspect' && (!authority || authority.planDigest !== digest || authority.epoch !== p.expectedEpoch + 1)) throw new MetadataError('PILOT_AUTHORITY_MISMATCH', 503);
  return db.transaction(async c => {
    if (dialect === 'postgres') {
      if (command === 'inspect' || command === 'verify') await c.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      else if (!(await c.query("SELECT pg_try_advisory_xact_lock(hashtext(current_database()), hashtext(current_schema() || ':opensight-h8-reference')) AS acquired"))[0]?.acquired) throw new MetadataError('MIGRATION_BUSY', 503);
    }
    // Never let forced RLS silently turn a deployment-wide inventory into an empty one.
    if (dialect === 'postgres') await c.query('SET LOCAL row_security = off');
    const control = (await c.query(`SELECT * FROM sr_control WHERE deployment = ?${dialect === 'postgres' && !['inspect', 'verify'].includes(command) ? ' FOR UPDATE' : ''}`, [p.deployment]))[0];
    if (!control || !['schema_min', 'schema_max', 'protocol_min', 'protocol_max'].every(k => Number(control[k]) === 1)) throw new MetadataError('PILOT_CONTROL_INVALID', 503);
    const blocked = await preconditions(c, p, dialect), inventory = await evidence(c);
    if (command === 'inspect') return { control, blocked, ...inventory };
    const operation = pilotDigest(['pilot-release', p.operationId, command]), request = pilotDigest([digest, command, command === 'freeze' ? null : authority!.backup]);
    const prior = (await c.query('SELECT request_hash FROM h2_requests WHERE operation_id = ?', [operation]))[0];
    const expectedState = command === 'reopen' && prior ? 'open' : 'maintenance';
    if (prior && prior.request_hash !== request) throw new MetadataError('PILOT_RECEIPT_CONFLICT', 503);
    if (!(command === 'freeze' && !prior) && (Number(control.epoch) !== p.expectedEpoch + 1 || control.state !== expectedState)) throw new MetadataError('PILOT_EPOCH_MISMATCH', 503);
    // A committed reopen may be retried after traffic resumes; never repeat its writes.
    if (prior && command === 'reopen') return { state: 'replayed', epoch: Number(control.epoch) };
    if (command === 'verify' || command === 'migrate' || command === 'reopen') {
      if (!/^[a-f0-9]{64}$/.test(authority!.backup ?? '') || authority!.preserved !== inventory.preserved) throw new MetadataError('PILOT_BACKUP_MISMATCH', 503);
    }
    clear(blocked);
    if (command === 'freeze') {
      if (authority!.phase !== 'quiescent') throw new MetadataError('PILOT_PHASE_INVALID', 503);
      if (!prior) {
        if (Number(control.epoch) !== p.expectedEpoch || control.state !== 'open') throw new MetadataError('PILOT_EPOCH_MISMATCH', 503);
        await c.query("UPDATE sr_control SET state = 'maintenance', epoch = ? WHERE deployment = ? AND epoch = ? AND state = 'open'", [p.expectedEpoch + 1, p.deployment, p.expectedEpoch]);
      }
    } else if (command === 'migrate') {
      if (authority!.phase !== 'backed-up') throw new MetadataError('PILOT_PHASE_INVALID', 503);
      if (!prior) await migrateServerless({ durable: true, transaction: work => work(c), close: async () => {} }, { ...env, OPENSIGHT_MAINTENANCE: 'frozen' }, dialect);
    }
    if (['migrate', 'verify', 'reopen'].includes(command)) {
      const marker = (await c.query('SELECT version, checksum FROM sr_execution_schema WHERE deployment = ?', [p.deployment]))[0];
      if (Number(marker?.version) !== 1 || marker?.checksum !== executionChecksum) throw new MetadataError('EXECUTION_FOREIGN_SCHEMA', 503);
      if (dialect === 'postgres') for (const table of executionTables) {
        const roles = [env.OPENSIGHT_RUNTIME_OPERATOR_ROLE, env.OPENSIGHT_RUNTIME_TENANT_ROLE];
        if (roles.some(role => !role)) throw new MetadataError('RUNTIME_ROLE_INVALID', 503);
        for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
          const grants = (await c.query('SELECT has_table_privilege(?, ?, ?) AS operator, has_table_privilege(?, ?, ?) AS tenant', [roles[0]!, table, privilege, roles[1]!, table, privilege]))[0];
          if (Boolean(grants?.tenant) || Boolean(grants?.operator) !== (table !== 'sr_execution_schema' || privilege === 'SELECT')) throw new MetadataError('PILOT_GRANTS_INVALID', 503);
        }
      }
      if ((await evidence(c)).preserved !== authority!.preserved) throw new MetadataError('PILOT_PRESERVATION_FAILED', 503);
    }
    if (command === 'reopen') {
      if (authority!.phase !== 'promoted') throw new MetadataError('PILOT_PHASE_INVALID', 503);
      const migration = (await c.query('SELECT request_hash FROM h2_requests WHERE operation_id = ?', [pilotDigest(['pilot-release', p.operationId, 'migrate'])]))[0];
      if (migration?.request_hash !== pilotDigest([digest, 'migrate', authority!.backup])) throw new MetadataError('PILOT_MIGRATION_REQUIRED', 503);
      await c.query("UPDATE sr_control SET state = 'open' WHERE deployment = ? AND epoch = ? AND state = 'maintenance'", [p.deployment, p.expectedEpoch + 1]);
    }
    if (!prior && command !== 'verify') {
      await c.query('INSERT INTO h2_requests (operation_id, request_hash) VALUES (?,?)', [operation, request]);
      await appendOperatorAudit(c, { action: `pilot.${command}`, detail: { operationId: p.operationId, digest } });
    }
    return { state: prior ? 'replayed' : 'verified', epoch: p.expectedEpoch + 1, executionChecksum, ...inventory };
  });
}
