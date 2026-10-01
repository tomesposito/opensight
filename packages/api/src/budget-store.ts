import { MetadataError, type Database } from './metadata-db.js';
import { TenantBudgets, validateBudgets, type BudgetConfig } from './budgets.js';
import type { TenantMetadata } from './metadata.js';

/** Explicit maintenance transaction; the CLI holds the same lifetime lock as the node.
 * No runtime DDL, guessed legacy policies, or dual writer. A rollback leaves the old snapshot intact. */
export async function migrateBudgets(database: Database, raw: unknown, maintenance: string | undefined): Promise<void> {
  if (maintenance !== 'frozen') throw new MetadataError('BUDGET_MAINTENANCE_REQUIRED', 503);
  const config = validateBudgets(raw);
  await database.transaction(async c => {
    const tenants = await c.query('SELECT tenant_id, limit_policy FROM h1_tenants');
    for (const id of Object.keys(config.tenants)) if (!tenants.some(t => t.tenant_id === id)) throw new MetadataError('BUDGET_TENANT_UNRESOLVED');
    for (const t of tenants) if (t.limit_policy !== null) {
      // An operator must explicitly resolve every old policy before cutover.
      const policy = config.tenants[String(t.tenant_id)];
      if (!policy || JSON.stringify(policy) !== String(t.limit_policy)) throw new MetadataError('BUDGET_POLICY_REPAIR_REQUIRED');
    }
    await c.query('CREATE TABLE IF NOT EXISTS h4_budget_config (id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL, body TEXT NOT NULL)');
    const old = await c.query('SELECT version FROM h4_budget_config WHERE id = 1');
    if (old.length) await c.query('UPDATE h4_budget_config SET version = version + 1, body = ? WHERE id = 1', [JSON.stringify(config)]);
    else await c.query('INSERT INTO h4_budget_config VALUES (1, 1, ?)', [JSON.stringify(config)]);
    await c.query('UPDATE h1_tenants SET limit_policy = NULL WHERE limit_policy IS NOT NULL');
  });
}
export async function readBudgets(database: Database): Promise<BudgetConfig> {
  try {
    return await database.transaction(async c => {
      const rows = await c.query('SELECT body FROM h4_budget_config WHERE id = 1');
      if (rows.length !== 1) throw new MetadataError('BUDGET_MIGRATION_REQUIRED', 503);
      const config = validateBudgets(JSON.parse(String(rows[0]!.body)));
      const tenants = await c.query('SELECT tenant_id, limit_policy FROM h1_tenants');
      if (tenants.some(t => t.limit_policy !== null) || Object.keys(config.tenants).some(id => !tenants.some(t => t.tenant_id === id))) throw new MetadataError('BUDGET_POLICY_REPAIR_REQUIRED', 503);
      return config;
    });
  } catch (error) {
    if (error instanceof MetadataError) throw error;
    throw new MetadataError('BUDGET_MIGRATION_REQUIRED', 503);
  }
}
export async function loadBudgets(database: Database, metadata: TenantMetadata): Promise<TenantBudgets> {
  return new TenantBudgets(await readBudgets(database), context => metadata.assertContext(context));
}
export function budgetEnvironment(env: NodeJS.ProcessEnv = process.env): BudgetConfig {
  try { return validateBudgets({ node: JSON.parse(env.OPENSIGHT_NODE_LIMITS!), defaults: JSON.parse(env.OPENSIGHT_TENANT_LIMIT_DEFAULTS!), tenants: JSON.parse(env.OPENSIGHT_TENANT_LIMIT_OVERRIDES ?? '{}') }); }
  catch { throw new MetadataError('BUDGET_CONFIG_INVALID', 503); }
}
