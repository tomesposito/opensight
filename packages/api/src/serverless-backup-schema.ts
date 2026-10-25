import { MetadataError, type SqlConnection, type SqlRow } from './metadata-db.js';
import { serverlessTables } from './serverless-migration.js';
import { AUDIT_SCHEMA_VERSION, auditSchemaChecksum, OPERATOR_ACTOR } from './operator-audit.js';
import type { CoordinationDialect } from './coordination-schema.js';

type AuditVersion = 'legacy-audit-v0' | 'audit-v1';
type WorkspaceInventory = AuditVersion | `${AuditVersion}-workspace-v1`;
export type AuditInventory = WorkspaceInventory | `${WorkspaceInventory}-ai-warnings-v1`;
export const currentInventory: AuditInventory = 'audit-v1-workspace-v1-ai-warnings-v1';
const currentAudit = (inventory: AuditInventory) => inventory.startsWith('audit-v1');
export const namedWorkspaces = (inventory: AuditInventory) => inventory.includes('-workspace-v1');
export const aiWarnings = (inventory: AuditInventory) => inventory.endsWith('-ai-warnings-v1');
const inventoryName = (audit: boolean, names: boolean, warnings: boolean): AuditInventory => `${audit ? 'audit-v1' : 'legacy-audit-v0'}${names ? '-workspace-v1' : ''}${warnings ? '-ai-warnings-v1' : ''}`;
const markerTable = 'h8_audit_schema';
const legacyColumns = ['event_id', 'created_at', 'action'];
const currentColumns = [...legacyColumns, 'actor', 'tenant_id', 'subject', 'detail'];
const reject = (): never => { throw new MetadataError('BACKUP_SCHEMA_INVALID', 503); };
const sameKeys = (row: object, names: readonly string[]) => Object.keys(row).sort().join() === [...names].sort().join();
export const inventoryTables = (inventory: AuditInventory): string[] =>
  serverlessTables.filter(t => (t !== markerTable || currentAudit(inventory)) && (t !== 'h2_login_selections' || namedWorkspaces(inventory)) && (t !== 'h8_ai_warnings' || aiWarnings(inventory)));

function validMarker(rows: SqlRow[]): boolean {
  return rows.length === 1 && sameKeys(rows[0]!, ['id', 'version', 'checksum'])
    && Number(rows[0]!.id) === 1 && Number(rows[0]!.version) === AUDIT_SCHEMA_VERSION && rows[0]!.checksum === auditSchemaChecksum;
}

/** Version-1 snapshots recognize audit, workspace and AI warning upgrades explicitly. Their original bytes/checksum remain the registration authority. */
export function snapshotInventory(tables: Record<string, SqlRow[]>): AuditInventory {
  if (!tables || typeof tables !== 'object' || Array.isArray(tables)) reject();
  const inventory = inventoryName(Object.hasOwn(tables, markerTable), Object.hasOwn(tables, 'h2_login_selections'), Object.hasOwn(tables, 'h8_ai_warnings'));
  if (!sameKeys(tables, inventoryTables(inventory))) reject();
  if (Object.values(tables).some(rows => !Array.isArray(rows))) reject();
  if (tables.h1_tenants!.some(row => ['display_name', 'slug'].some(key => Object.hasOwn(row, key) !== namedWorkspaces(inventory)))) reject();
  const columns = currentAudit(inventory) ? currentColumns : legacyColumns;
  if (tables.h8_audit!.some(row => !row || !sameKeys(row, columns)
    || legacyColumns.some(k => typeof row[k] !== 'string')
    || currentAudit(inventory) && (typeof row.actor !== 'string'
      || ['tenant_id', 'subject', 'detail'].some(k => row[k] !== null && typeof row[k] !== 'string')))) reject();
  if (currentAudit(inventory) && !validMarker(tables[markerTable]!)) reject();
  return inventory;
}

/** Check physical shape even for empty audit tables. A missing marker on a
 * partially upgraded table, a view, a foreign owner or an altered default is
 * not the recognized legacy schema. All other required tables stay mandatory. */
export async function databaseInventory(c: SqlConnection, dialect: CoordinationDialect): Promise<AuditInventory> {
  const relations = await c.query(dialect === 'postgres'
    ? "SELECT relname AS name, relkind AS kind, CASE WHEN relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user) THEN 1 ELSE 0 END AS owned FROM pg_class WHERE relnamespace=current_schema()::regnamespace"
    : "SELECT name, CASE WHEN type='table' THEN 'r' ELSE type END AS kind, 1 AS owned FROM sqlite_master");
  const inventory = inventoryName(relations.some(r => r.name === markerTable), relations.some(r => r.name === 'h2_login_selections'), relations.some(r => r.name === 'h8_ai_warnings'));
  for (const table of inventoryTables(inventory)) {
    if (!relations.some(r => r.name === table && ['r', 'p'].includes(String(r.kind)) && Number(r.owned) === 1))
      throw new MetadataError('BACKUP_FOREIGN_DATABASE', 503);
  }
  const tenantColumns = await c.query(dialect === 'postgres'
    ? "SELECT column_name AS name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'h1_tenants'"
    : 'PRAGMA table_info(h1_tenants)');
  if (['display_name', 'slug'].some(name => tenantColumns.some(row => row.name === name) !== namedWorkspaces(inventory))) reject();
  const columns = async (table: 'h8_audit' | 'h8_audit_schema') => {
    if (dialect === 'postgres') return c.query(`SELECT a.attname AS name, format_type(a.atttypid,a.atttypmod) AS type,
      a.attidentity AS identity, a.attgenerated AS generated,
      CASE WHEN a.attnotnull THEN 1 ELSE 0 END AS not_null, pg_get_expr(d.adbin,d.adrelid) AS default_value,
      CASE WHEN EXISTS (SELECT 1 FROM pg_constraint p WHERE p.conrelid=a.attrelid AND p.contype='p'
        AND cardinality(p.conkey)=1 AND p.conkey[1]=a.attnum) THEN 1 ELSE 0 END AS pk
      FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
      WHERE a.attrelid=to_regclass(?) AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum`, [table]);
    return (await c.query(`PRAGMA table_xinfo(${table})`)).map(r => ({ name: r.name!, type: String(r.type).toLowerCase(),
      identity: '', generated: Number(r.hidden) ? 'generated' : '',
      not_null: Number(r.notnull) || Number(r.pk) ? 1 : 0, default_value: r.dflt_value!, pk: r.pk! }));
  };
  const audit = await columns('h8_audit'), expected = currentAudit(inventory) ? currentColumns : legacyColumns;
  if (audit.length !== expected.length || audit.some((r, i) => r.name !== expected[i] || r.type !== 'text' || r.identity !== '' || r.generated !== ''
    || Number(r.not_null) !== (i < 4 ? 1 : 0) || Number(r.pk) !== (i === 0 ? 1 : 0)
    || (i === 3 ? String(r.default_value).replace(/::text$/, '') !== `'${OPERATOR_ACTOR}'` : r.default_value !== null))) reject();
  if (currentAudit(inventory)) {
    const marker = await columns(markerTable);
    if (marker.length !== 3 || marker.some((r, i) => r.name !== ['id', 'version', 'checksum'][i]
      || r.type !== (i === 2 ? 'text' : 'integer') || r.identity !== '' || r.generated !== '' || Number(r.not_null) !== 1 || Number(r.pk) !== (i === 0 ? 1 : 0)
      || r.default_value !== null) || !validMarker(await c.query('SELECT * FROM h8_audit_schema'))) reject();
  }
  return inventory;
}

export function upgradedAudit(rows: SqlRow[], inventory: AuditInventory): SqlRow[] {
  return currentAudit(inventory) ? rows : rows.map(row => ({ ...row, actor: OPERATOR_ACTOR, tenant_id: null, subject: null, detail: null }));
}
