import { createConnection, type Connection, type RowDataPacket } from 'mysql2/promise';
import { validateConnectorConfig, ConnectorError, connectorDefinition, type ConnectorConfig } from './connectors.js';
import { planVisual } from './planner.js';
import { executePostgres } from './postgres-executor.js';
import { evaluateSqlPlan } from './evaluate.js';
import { fail, QueryEngineError } from './validation.js';
import type { PlanRequest, QueryResult, ResultValue } from './types.js';

export interface MySqlExecuteOptions {
  config: unknown;
  /** Trusted server environment injection; defaults to process.env. Never accept from HTTP. */
  environment?: Readonly<Record<string, string | undefined>>;
  /** Tests/local loopback only; other addresses always require verified TLS. */
  allowInsecureLoopback?: boolean;
}
function resolveEnvironment(config: ConnectorConfig, environment: Readonly<Record<string, string | undefined>>): Record<string, string> {
  return Object.fromEntries(Object.entries(config).map(([key, name]) => {
    const value = environment[name];
    if (!value || value.includes('\0')) throw new ConnectorError('CONNECTOR_NOT_CONFIGURED', `$.config.${key}`, 'Environment value is missing or invalid');
    return [key, value];
  }));
}
function value(raw: unknown, numeric: boolean): ResultValue {
  if (raw === null || typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string') {
    if (!numeric) return raw;
    if (/^[+-]?\d+$/.test(raw)) {
      const n = BigInt(raw); if (n > BigInt(Number.MAX_SAFE_INTEGER) || n < BigInt(Number.MIN_SAFE_INTEGER)) return raw;
    }
    const n = Number(raw); if (Number.isFinite(n)) return n;
  }
  return fail('EXECUTION_ERROR', '$.mysql.result', 'Unsupported or nonfinite MySQL result');
}
/** MySQL 8.0.22+: generated SELECT only, UTC, prepared parameters, verified TLS. */
export async function executeMySql(request: PlanRequest, options: MySqlExecuteOptions): Promise<QueryResult> {
  const plan = planVisual(request, { dialect: 'mysql' }); // Security and SQL validation precede any socket.
  const config = validateConnectorConfig('mysql', options?.config);
  const env = resolveEnvironment(config, options.environment ?? process.env);
  const port = Number(env.portEnv);
  if (!/^\d+$/.test(env.portEnv!) || !Number.isInteger(port) || port < 1 || port > 65535) throw new ConnectorError('INVALID_CONNECTOR_CONFIG', '$.config.portEnv', 'Expected port 1–65535');
  if (plan.tableSchema !== env.databaseEnv) throw new ConnectorError('INVALID_CONNECTOR_CONFIG', '$.config.databaseEnv', 'Planned database must match configured database');
  const insecure = options.allowInsecureLoopback === true;
  if (insecure && !['127.0.0.1', '::1'].includes(env.hostEnv!)) throw new ConnectorError('INVALID_CONNECTOR_CONFIG', '$.config.hostEnv', 'Unencrypted connections are restricted to loopback');
  let client: Connection | undefined;
  try {
    client = await createConnection({ host: env.hostEnv, port, database: env.databaseEnv, user: env.userEnv, password: env.passwordEnv,
      ...(insecure ? {} : { ssl: { rejectUnauthorized: true, ...(env.caEnv ? { ca: env.caEnv } : {}) } }),
      connectTimeout: 3000, timezone: 'Z', dateStrings: true, supportBigNumbers: true, bigNumberStrings: true, rowsAsArray: true,
      multipleStatements: false, enableKeepAlive: false,
    });
    await client.query({ sql: "SET SESSION time_zone = '+00:00', sql_mode = 'STRICT_TRANS_TABLES,NO_BACKSLASH_ESCAPES,ONLY_FULL_GROUP_BY', collation_connection = 'utf8mb4_0900_bin', max_execution_time = 10000", timeout: 10000 });
    const [rows, fields] = await client.execute<RowDataPacket[]>({ sql: plan.sql, values: [...plan.parameters], timeout: 10000 });
    const numericTypes = new Set([0, 1, 2, 3, 4, 5, 8, 9, 13, 246]);
    const converted = rows.map(row => Object.fromEntries(fields.map((f, i) => [f.name, value(row[i] as unknown, numericTypes.has(f.type ?? -1))])));
    return { plan, rows: plan.postProcess ? evaluateSqlPlan(plan, converted) : converted };
  } catch (error) {
    if (error instanceof QueryEngineError) throw error;
    throw new QueryEngineError('EXECUTION_ERROR', '$.mysql', 'MySQL connection or query failed');
  } finally { client?.destroy(); }
}
/** Trusted server-side entry point; stub connectors never open connections. */
export async function executeConnector(id: string, config: unknown, request: PlanRequest, environment: Readonly<Record<string, string | undefined>> = process.env): Promise<QueryResult> {
  const c = connectorDefinition(id), validated = validateConnectorConfig(id, config);
  if (id === 'mysql') return executeMySql(request, { config: validated, environment });
  if (id === 'postgresql') return executePostgres(request, { connectionString: resolveEnvironment(validated, environment).connectionEnv! });
  throw new ConnectorError(c.implementation === 'hosted' ? 'CONNECTOR_NOT_CONFIGURED' : 'CONNECTOR_NOT_IMPLEMENTED', '$.connector', c.implementation === 'hosted' ? 'Needs hosted API / not configured' : 'Query connection is not yet implemented; file uploads use DuckDB staging');
}
