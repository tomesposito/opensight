import { randomBytes, randomUUID } from 'node:crypto';
import { h8Fixture, referenceEnv } from './h8-helpers.mjs';
import { runtimeEnv } from './runtime-helpers.mjs';
import { budgetConfig } from './budget-helpers.mjs';
import { upload } from './source-helpers.mjs';
import { migrateRuntime } from '../dist/runtime-migration.js';
import { migrateCoordination } from '../dist/coordination-schema.js';
import { TenantMetadata } from '../dist/metadata.js';
import { HostedSources } from '../dist/hosted-sources.js';

export async function coordinationFixture(t, options = {}) {
  const f = await h8Fixture(t), budgets = structuredClone(options.budgets ?? budgetConfig);
  const entitlements = { defaults: { apiCalls: 1000, storageBytes: 1000000, computeAttempts: options.computeAttempts ?? 20 }, tenants: {} };
  const env = { ...f.env, ...referenceEnv, ...runtimeEnv(), OPENSIGHT_REFERENCE: undefined,
    OPENSIGHT_NODE_LIMITS: JSON.stringify(budgets.node), OPENSIGHT_TENANT_LIMIT_DEFAULTS: JSON.stringify(budgets.defaults), OPENSIGHT_TENANT_LIMIT_OVERRIDES: JSON.stringify(budgets.tenants) };
  await migrateRuntime(f.db, env, 'sqlite');
  const metadata = new TenantMetadata(f.db, f.db), sources = new HostedSources(metadata, randomBytes(32).toString('base64'), []);
  const contexts = [], uploaded = [];
  for (const namespaceId of ['one', 'two']) {
    const context = await metadata.authenticate(null, async () => ({ namespaceId, userId: 'admin' }));
    contexts.push(context); uploaded.push(await sources.upload(context, upload()));
  }
  if (options.migrate !== false) await migrateCoordination(f.db, 'test', entitlements, 'frozen', 'sqlite');
  return { ...f, env, metadata, sources, contexts, uploaded, budgets, entitlements,
    open: () => f.db.transaction(c => c.query("UPDATE sr_control SET state = 'open' WHERE deployment = 'test'")),
    async input(index = 0, refresh = false) {
      return { attemptId: randomUUID(), class: refresh ? 'refresh' : 'query', revisions: await metadata.revisions(contexts[index]), platformRemainingMs: 28000,
        ...(refresh ? { claim: { kind: 'source', id: uploaded[index].id, expectedVersion: 1 } } : {}) };
    },
  };
}
