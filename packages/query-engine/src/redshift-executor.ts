import { Client } from 'pg';
import { validateConnectorConfig, ConnectorError } from './connectors.js';
import { planVisual } from './planner.js';
import { evaluateSqlPlan } from './evaluate.js';
import { QueryEngineError } from './validation.js';
import { redshiftResultValue, redshiftType } from './redshift-sql.js';
import type { PlanRequest, QueryResult } from './types.js';

export interface RedshiftExecuteOptions {
  config: unknown;
  /** Trusted server environment; never accept from HTTP. */
  environment?: Readonly<Record<string, string | undefined>>;
  /** Tests only: plaintext is permitted only for literal loopback addresses. */
  allowInsecureLoopback?: boolean;
}
/** Pin session SQL separately from Postgres: no backend PID, transaction or cursor assumptions. */
export const redshiftSessionSql = ["SET TIME ZONE 'UTC'", 'SET enable_case_sensitive_identifier TO true', 'SET statement_timeout TO 10000'] as const;
export async function executeRedshift(request: PlanRequest, options: RedshiftExecuteOptions): Promise<QueryResult> {
  const plan = planVisual(request, { dialect: 'redshift' });
  const config = validateConnectorConfig('redshift-manual', options?.config);
  const environment = options.environment ?? process.env;
  const env = Object.fromEntries(Object.entries(config).map(([key, name]) => {
    const value = environment[name];
    if (!value || value.includes('\0')) throw new ConnectorError('CONNECTOR_NOT_CONFIGURED', `$.config.${key}`, 'Environment value is missing or invalid');
    return [key, value];
  }));
  const port = Number(env.portEnv);
  if (!/^\d+$/.test(env.portEnv!) || !Number.isInteger(port) || port < 1 || port > 65535) throw new ConnectorError('INVALID_CONNECTOR_CONFIG', '$.config.portEnv', 'Expected port 1–65535');
  if (plan.tableDatabase !== env.databaseEnv) throw new ConnectorError('INVALID_CONNECTOR_CONFIG', '$.config.databaseEnv', 'Planned database must match configured database');
  const insecure = options.allowInsecureLoopback === true;
  if (insecure && !['127.0.0.1', '::1'].includes(env.hostEnv!)) throw new ConnectorError('INVALID_CONNECTOR_CONFIG', '$.config.hostEnv', 'Unencrypted connections are restricted to loopback');
  let client: Client | undefined;
  try {
    client = new Client({ host: env.hostEnv, port, database: env.databaseEnv, user: env.userEnv, password: env.passwordEnv,
      ssl: insecure ? false : { rejectUnauthorized: true, ...(env.caEnv ? { ca: env.caEnv } : {}) },
      connectionTimeoutMillis: 3000, query_timeout: 10000 });
    client.on('error', () => {}); // Driver errors are surfaced by connect/query and sanitized below.
    await client.connect();
    for (const statement of redshiftSessionSql) await client.query(statement);
    const result = await client.query<unknown[]>({ text: plan.sql, values: [...plan.parameters], rowMode: 'array', types: { getTypeParser: () => (value: string) => value } });
    result.fields.forEach(field => redshiftType(field.dataTypeID)); // Reject unsupported types even with no rows.
    const rows = result.rows.map(values => Object.fromEntries(result.fields.map((field, i) => [field.name, redshiftResultValue(values[i], field.dataTypeID)])));
    return { plan, rows: plan.postProcess ? evaluateSqlPlan(plan, rows) : rows, provenance: { source: 'live' } };
  } catch (error) {
    if (error instanceof QueryEngineError) throw error;
    throw new QueryEngineError('EXECUTION_ERROR', '$.redshift', 'Redshift connection or query failed');
  } finally { await client?.end().catch(() => {}); }
}
