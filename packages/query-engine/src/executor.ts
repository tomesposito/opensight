import { evaluatePlan } from './evaluate.js';
import { realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { DuckDBInstance } from '@duckdb/node-api';
import { planVisual } from './planner.js';
import type { ColumnType, ExecuteOptions, PlanRequest, QueryResult, ResultValue } from './types.js';
import { fail, QueryEngineError, quoteIdentifier as q, quoteLiteral, string } from './validation.js';

const sqlTypes: Record<ColumnType, string> = {
  INTEGER: 'BIGINT', DECIMAL: 'DOUBLE', STRING: 'VARCHAR', DATETIME: 'TIMESTAMP',
};

function resultValue(value: unknown): ResultValue {
  if (value === null || typeof value === 'string') return value;
  if (typeof value === 'boolean') return Number(value);
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'bigint') {
    return value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= BigInt(Number.MIN_SAFE_INTEGER) ? Number(value) : value.toString();
  }
  return fail('EXECUTION_ERROR', '$.result', 'nonfinite or unsupported result scalar');
}

/** Plan and execute locally. Planning/security always happens before file or database access. */
export async function executeLocal(request: PlanRequest, options: ExecuteOptions): Promise<QueryResult> {
  const plan = planVisual(request);
  const rootInput = string(options?.dataRoot, '$.options.dataRoot');
  let csvPath: string;
  try {
    const root = await realpath(rootInput);
    csvPath = await realpath(resolve(root, plan.localData.csv));
    const child = relative(root, csvPath);
    if (!child || isAbsolute(child) || child === '..' || child.startsWith('../') || child.startsWith('..\\') || !(await stat(csvPath)).isFile()) {
      fail('LOCAL_DATA_ERROR', '$.localData.csv', 'CSV must be a regular file inside dataRoot');
    }
  } catch (error) {
    if (error instanceof QueryEngineError) throw error;
    fail('LOCAL_DATA_ERROR', '$.localData.csv', 'cannot resolve the local CSV file inside dataRoot');
  }

  // No extension download, remote source connection, or persisted database is required.
  const instance = await DuckDBInstance.create(':memory:', {
    autoinstall_known_extensions: 'false', autoload_known_extensions: 'false',
    threads: '1', memory_limit: '256MB', max_temp_directory_size: '0B',
  });
  try {
    const connection = await instance.connect();
    try {
      // ICU settings register after instance creation, so set the session timezone here.
      await connection.run("SET TimeZone = 'UTC'");
      const header = await connection.runAndReadAll(
        "SELECT * FROM read_csv($1, header = true, delim = ',', all_varchar = true, sample_size = -1) LIMIT 0", [csvPath]);
      if (JSON.stringify(header.columnNames()) !== JSON.stringify(plan.sourceColumns.map((c) => c.name))) {
        fail('LOCAL_DATA_ERROR', '$.localData.csv', 'CSV header must exactly match the declared column order and names');
      }
      const columns = plan.sourceColumns.map((c) => `${quoteLiteral(c.name)}: ${quoteLiteral(sqlTypes[c.type])}`).join(', ');
      await connection.run(`CREATE TABLE ${q(plan.tableName)} AS SELECT * FROM read_csv($1, header = true, auto_detect = false, delim = ',', columns = {${columns}}, nullstr = '', timestampformat = '%Y-%m-%d')`, [csvPath]);
      // A local DECIMAL is deliberately DOUBLE; do not let NaN/Infinity disappear into an aggregate.
      const finiteChecks = plan.sourceColumns.filter((c) => c.type === 'DECIMAL').map((c) => `NOT isfinite(${q(c.name)})`);
      if (finiteChecks.length) {
        const invalid = await connection.runAndReadAll(`SELECT COUNT(*) AS invalid FROM ${q(plan.tableName)} WHERE ${finiteChecks.join(' OR ')}`);
        if (invalid.getRows()[0]?.[0] !== 0n) fail('LOCAL_DATA_ERROR', '$.localData.csv', 'nonfinite numeric cells are unsupported');
      }
      // Only generated SQL runs after materialization; disable all further external reads.
      await connection.run('SET enable_external_access = false');
      const reader = await connection.runAndReadAll(plan.sql, [...plan.parameters]);
      const names = reader.columnNames();
      const rows = reader.getRows().map((values) => Object.fromEntries(names.map((name, i) => [name, resultValue(values[i])])));
      return { plan, rows: plan.postProcess ? evaluatePlan(plan, rows) : rows };
    } finally {
      connection.closeSync();
    }
  } catch (error) {
    if (error instanceof QueryEngineError) throw error;
    throw new QueryEngineError('EXECUTION_ERROR', '$.localData.csv', `DuckDB failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    instance.closeSync();
  }
}
