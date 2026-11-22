import { Client, Query } from 'pg';
import { validateConnectorConfig, ConnectorError } from './connectors.js';
import { planVisual } from './planner.js';
import { evaluateSqlPlan } from './evaluate.js';
import { QueryEngineError } from './validation.js';
import { redshiftResultValue, redshiftType } from './redshift-sql.js';
import type { PlanRequest, QueryResult, ResultRow } from './types.js';
import { resultBudget, type ResultBudgetOptions } from './result-budget.js';

export interface RedshiftExecuteOptions extends ResultBudgetOptions {
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
  const intake = resultBudget(options, 'redshift');
  let client: Client | undefined;
  let closing: Promise<void> | undefined, timer: ReturnType<typeof setTimeout> | undefined;
  const close = () => closing ??= client?.end().catch(() => {});
  try {
    client = new Client({ host: env.hostEnv, port, database: env.databaseEnv, user: env.userEnv, password: env.passwordEnv,
      ssl: insecure ? false : { rejectUnauthorized: true, ...(env.caEnv ? { ca: env.caEnv } : {}) },
      // pg's query_timeout installs a callback that accumulates every row even
      // with a row listener. Bound streaming with our own 10-second timer instead.
      connectionTimeoutMillis: 3000, query_timeout: 0 });
    client.on('error', () => {}); // Driver errors are surfaced by connect/query and sanitized below.
    await client.connect();
    for (const statement of redshiftSessionSql) {
      const setup = { text: statement, query_timeout: 10000 };
      await client.query(setup);
    }
    const rows: ResultRow[] = [];
    await new Promise<void>((resolve, reject) => {
      let stopped = false;
      const stop = (error: unknown) => {
        if (stopped) return;
        stopped = true; reject(error); void close();
      };
      timer = setTimeout(() => stop(new QueryEngineError('EXECUTION_ERROR', '$.redshift', 'Redshift connection or query failed')), 10000);
      const queryConfig = { text: plan.sql, values: [...plan.parameters], rowMode: 'array' as const, types: { getTypeParser: () => (value: string) => value } };
      const query = new Query<unknown[]>(queryConfig);
      query.on('error', stop).on('row', (raw, result) => {
        if (stopped) return;
        try {
          const fields = result?.fields ?? [];
          fields.forEach(field => redshiftType(field.dataTypeID));
          intake(raw);
          rows.push(Object.fromEntries(fields.map((field, i) => [field.name, redshiftResultValue(raw[i], field.dataTypeID)])));
        } catch (error) { stop(error); }
      }).on('end', result => {
        if (stopped) return;
        try {
          result.fields.forEach(field => redshiftType(field.dataTypeID)); // Also reject unsupported zero-row results.
          stopped = true; resolve();
        } catch (error) { stop(error); }
      });
      client!.query(query);
    });
    return { plan, rows: plan.postProcess ? evaluateSqlPlan(plan, rows) : rows, provenance: { source: 'live' } };
  } catch (error) {
    if (error instanceof QueryEngineError) throw error;
    throw new QueryEngineError('EXECUTION_ERROR', '$.redshift', 'Redshift connection or query failed');
  } finally { clearTimeout(timer); await close(); }
}
