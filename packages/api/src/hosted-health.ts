import type { Database } from './metadata-db.js';
import { MetadataError } from './metadata-db.js';
import { readBudgets } from './budget-store.js';
import { assertHostedSourcesReady } from './source-maintenance.js';

/** Operator probes only. No tenant data or database diagnostics leave this boundary. */
export async function hostedReadiness(membership: Database, tenant: Database): Promise<void> {
  try { await membership.transaction(c => c.query('SELECT 1')); }
  catch { throw new MetadataError('DATABASE_UNAVAILABLE', 503); }
  try {
    await membership.transaction(async c => {
      await c.query('SELECT subject FROM h2_memberships WHERE 1 = 0');
      for (const table of ['h1_tenants', 'h1_namespaces', 'h1_revisions', 'h1_resources', 'h1_links', 'h1_operations', 'h1_outbox',
        'h2_control', 'h2_identities', 'h2_invitations', 'h2_keys', 'h2_sessions', 'h2_attempts', 'h2_onboarding', 'h2_requests',
        'h5_embedding_config', 'h6_keys', 'h6_sessions', 'h7_jobs', 'h7_occurrences', 'h7_deliveries', 'h7_migrations']) await c.query(`SELECT 1 FROM ${table} WHERE 1 = 0`);
      const migrations = await c.query("SELECT migration_id FROM h1_migrations WHERE state IN ('inventoried','committed')");
      const jobs = await c.query("SELECT resource_id FROM h1_resources j WHERE kind = 'job' AND NOT EXISTS (SELECT 1 FROM h7_migrations m WHERE m.tenant_id = j.tenant_id AND m.namespace_id = j.namespace_id)");
      if (migrations.length || jobs.length) throw new Error('pending');
    });
    await readBudgets(membership); await assertHostedSourcesReady(membership);
  } catch { throw new MetadataError('MIGRATIONS_REQUIRED', 503); }
  try {
    // A deliberately nonexistent scope also exercises role safety and RLS setup
    // before any tenants have been provisioned.
    await tenant.transaction(c => c.query('SELECT resource_id FROM h1_resources WHERE 1 = 0'), { tenantId: 'h8-readiness', namespaceId: 'h8-readiness' });
  } catch { throw new MetadataError('TENANT_STORE_UNAVAILABLE', 503); }
}
