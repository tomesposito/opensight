import { MetadataError, type SqlConnection } from './metadata-db.js';
import type { InvocationDatabases } from './runtime-postgres.js';
import type { InvocationScope } from './runtime-scope.js';
import type { RuntimeRequest, RuntimeResponse } from './runtime-ingress.js';
import { runtimeError } from './runtime-ingress.js';

export const runtimeProtocol = 1;
export function deploymentId(env: NodeJS.ProcessEnv): string {
  const id = env.OPENSIGHT_DEPLOYMENT;
  if (!id || !/^[A-Za-z0-9_-]{1,80}$/.test(id)) throw new MetadataError('RUNTIME_CONFIG_INVALID', 503);
  return id;
}
export async function checkRuntimeControl(c: SqlConnection, deployment: string): Promise<void> {
  const row = (await c.query('SELECT state, schema_min, schema_max, protocol_min, protocol_max FROM sr_control WHERE deployment = ?', [deployment]))[0];
  if (!row || row.state !== 'open' || !['schema_min', 'schema_max', 'protocol_min', 'protocol_max'].every(k => Number.isSafeInteger(Number(row[k])) && Number(row[k]) > 0)
    || Number(row.schema_min) > runtimeProtocol || Number(row.schema_max) < runtimeProtocol
    || Number(row.protocol_min) > runtimeProtocol || Number(row.protocol_max) < runtimeProtocol) throw new MetadataError('WORKSPACE_MAINTENANCE', 503);
}
/** No DDL, keys, tenant enumeration, recovery or diagnostic payloads. */
export async function runtimeReadiness(db: InvocationDatabases, scope: InvocationScope, env: NodeJS.ProcessEnv): Promise<void> {
  await scope.stage(async () => {
    await db.membership.transaction(async c => {
      await c.query('SET TRANSACTION READ ONLY');
      await checkRuntimeControl(c, deploymentId(env));
      for (const table of ['h1_resources', 'h2_keys', 'h4_budget_config', 'h5_embedding_config', 'h6_sessions', 'h7_jobs']) await c.query(`SELECT 1 FROM ${table} WHERE 1 = 0`);
    });
    await db.tenant.transaction(async c => {
      await c.query('SET TRANSACTION READ ONLY');
      const rows = await c.query("SELECT relname FROM pg_class WHERE relname IN ('h1_resources','h1_links','h1_revisions') AND (NOT relrowsecurity OR NOT relforcerowsecurity)");
      if (rows.length) throw new MetadataError('WORKSPACE_UNAVAILABLE', 503);
      await c.query('SELECT resource_id FROM h1_resources WHERE 1 = 0');
    }, { tenantId: 'sr-readiness', namespaceId: 'sr-readiness' });
  }, 2000, () => scope.controller.abort(), 'SQL_STATEMENT_TIMEOUT');
}
export function validateStartup(request: RuntimeRequest): void {
  if (request.method !== 'POST' || request.body.length > 1024 || request.headers['content-type'] !== 'application/json' || request.headers.authorization || request.headers.cookie) throw new MetadataError('HOSTED_REQUEST_INVALID', 400);
  try {
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(request.body));
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length) throw Error();
  } catch { throw new MetadataError('HOSTED_REQUEST_INVALID', 400); }
}
export function startupFailure(error: unknown): RuntimeResponse {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  const starting = ['SQL_CONNECT_TIMEOUT', 'ETIMEDOUT', 'ECONNRESET', '57P03', '53300'].includes(code);
  const maintenance = ['WORKSPACE_MAINTENANCE', '42P01', '42703'].includes(code);
  const result = runtimeError(new MetadataError(starting ? 'WORKSPACE_STARTING' : maintenance ? 'WORKSPACE_MAINTENANCE' : 'WORKSPACE_UNAVAILABLE', 503));
  if (starting) result.headers['retry-after'] = '5';
  return result;
}
