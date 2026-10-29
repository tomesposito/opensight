import { createHash } from 'node:crypto';
import { MetadataError, type Database } from './metadata-db.js';
import type { CoordinationDialect } from './coordination-schema.js';

export const v1DurableTables = ['sr_v1_schema', 'sr_v1_capacity', 'sr_v1_receipts', 'sr_v1_rates'] as const;
const schema = [
  `CREATE TABLE sr_v1_schema (deployment TEXT PRIMARY KEY REFERENCES sr_control(deployment), version INTEGER NOT NULL CHECK (version = 1), checksum TEXT NOT NULL)`,
  `CREATE TABLE sr_v1_capacity (deployment TEXT NOT NULL REFERENCES sr_control(deployment), tenant_id TEXT NOT NULL,
    entries INTEGER NOT NULL CHECK (entries >= 0), bytes BIGINT NOT NULL CHECK (bytes >= 0), PRIMARY KEY (deployment, tenant_id))`,
  `CREATE TABLE sr_v1_receipts (deployment TEXT NOT NULL REFERENCES sr_control(deployment), tenant_id TEXT NOT NULL, namespace_id TEXT NOT NULL,
    owner_id TEXT NOT NULL, receipt_key TEXT NOT NULL, token TEXT NOT NULL, state TEXT NOT NULL CHECK (state IN ('pending','complete')),
    expires_at BIGINT NOT NULL, bytes BIGINT NOT NULL CHECK (bytes >= 0), body TEXT,
    PRIMARY KEY (deployment, receipt_key), FOREIGN KEY (tenant_id, namespace_id) REFERENCES h1_namespaces(tenant_id, namespace_id),
    CHECK ((state = 'pending' AND body IS NULL AND bytes = 0) OR (state = 'complete' AND body IS NOT NULL AND bytes > 0)))`,
  `CREATE INDEX sr_v1_expiry ON sr_v1_receipts(deployment, expires_at)`,
  `CREATE TABLE sr_v1_rates (deployment TEXT NOT NULL REFERENCES sr_control(deployment), tenant_id TEXT NOT NULL, namespace_id TEXT NOT NULL,
    used INTEGER NOT NULL CHECK (used >= 0), reset_at BIGINT NOT NULL, PRIMARY KEY (deployment, tenant_id, namespace_id),
    FOREIGN KEY (tenant_id, namespace_id) REFERENCES h1_namespaces(tenant_id, namespace_id))`,
];
export const v1DurableChecksum = createHash('sha256').update(schema.join('\n') + erasure.toString()).digest('hex');
/** Tenant lifecycle revocation erases payloads and releases shared capacity atomically. */
async function erasure(c: import('./metadata-db.js').SqlConnection, dialect: CoordinationDialect): Promise<void> {
  if (dialect === 'postgres') {
    await c.query(`CREATE OR REPLACE FUNCTION sr_v1_erase_tenant() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        PERFORM 1 FROM sr_v1_capacity WHERE tenant_id = '' ORDER BY deployment FOR UPDATE;
        UPDATE sr_v1_capacity SET entries = entries - COALESCE((SELECT t.entries FROM sr_v1_capacity t WHERE t.deployment = sr_v1_capacity.deployment AND t.tenant_id = NEW.tenant_id), 0),
          bytes = bytes - COALESCE((SELECT t.bytes FROM sr_v1_capacity t WHERE t.deployment = sr_v1_capacity.deployment AND t.tenant_id = NEW.tenant_id), 0) WHERE tenant_id = '';
        DELETE FROM sr_v1_receipts WHERE tenant_id = NEW.tenant_id;
        DELETE FROM sr_v1_rates WHERE tenant_id = NEW.tenant_id;
        DELETE FROM sr_v1_capacity WHERE tenant_id = NEW.tenant_id;
        RETURN NEW;
      END $$`);
    await c.query(`CREATE TRIGGER sr_v1_erase AFTER UPDATE OF state ON h1_tenants FOR EACH ROW
      WHEN (NEW.state IN ('deleting','deleted')) EXECUTE FUNCTION sr_v1_erase_tenant()`);
  } else await c.query(`CREATE TRIGGER sr_v1_erase AFTER UPDATE OF state ON h1_tenants WHEN NEW.state IN ('deleting','deleted') BEGIN
    UPDATE sr_v1_capacity SET entries = entries - COALESCE((SELECT t.entries FROM sr_v1_capacity t WHERE t.deployment = sr_v1_capacity.deployment AND t.tenant_id = NEW.tenant_id), 0),
      bytes = bytes - COALESCE((SELECT t.bytes FROM sr_v1_capacity t WHERE t.deployment = sr_v1_capacity.deployment AND t.tenant_id = NEW.tenant_id), 0) WHERE tenant_id = '';
    DELETE FROM sr_v1_receipts WHERE tenant_id = NEW.tenant_id;
    DELETE FROM sr_v1_rates WHERE tenant_id = NEW.tenant_id;
    DELETE FROM sr_v1_capacity WHERE tenant_id = NEW.tenant_id;
  END`);
}
export async function migrateV1Durable(database: Database, deployment: string, dialect: CoordinationDialect): Promise<void> {
  await database.transaction(async c => {
    const control = (await c.query('SELECT state FROM sr_control WHERE deployment = ?', [deployment]))[0];
    if (control?.state !== 'maintenance') throw new MetadataError('WORKSPACE_MAINTENANCE_REQUIRED', 503);
    const tables = await c.query(dialect === 'postgres'
      ? "SELECT relname AS name, CASE WHEN relowner = (SELECT oid FROM pg_roles WHERE rolname = current_user) THEN 1 ELSE 0 END AS owned FROM pg_class WHERE relnamespace = current_schema()::regnamespace AND relkind IN ('r','p')"
      : "SELECT name, 1 AS owned FROM sqlite_master WHERE type = 'table'");
    const found = tables.filter(r => v1DurableTables.some(t => t === r.name));
    if (found.length) {
      if (found.length !== v1DurableTables.length || found.some(r => Number(r.owned) !== 1)) throw new MetadataError('V1_DURABLE_SCHEMA_INVALID', 503);
      const marker = (await c.query('SELECT version, checksum FROM sr_v1_schema WHERE deployment = ?', [deployment]))[0];
      if (Number(marker?.version) !== 1 || marker?.checksum !== v1DurableChecksum) throw new MetadataError('V1_DURABLE_SCHEMA_INVALID', 503);
      return;
    }
    for (const sql of schema) await c.query(sql);
    if (dialect === 'postgres') for (const table of ['sr_v1_receipts', 'sr_v1_rates', 'sr_v1_capacity']) {
      await c.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
      await c.query(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
      const scope = table === 'sr_v1_capacity' ? "(tenant_id = '' OR tenant_id = current_setting('opensight.tenant_id', true))"
        : "tenant_id = current_setting('opensight.tenant_id', true) AND namespace_id = current_setting('opensight.namespace_id', true)";
      await c.query(`CREATE POLICY sr_scope ON ${table} USING (${scope}) WITH CHECK (${scope})`);
    }
    await c.query('INSERT INTO sr_v1_schema VALUES (?, 1, ?)', [deployment, v1DurableChecksum]);
    await c.query("INSERT INTO sr_v1_capacity VALUES (?, '', 0, 0)", [deployment]);
    await erasure(c, dialect);
  });
}
