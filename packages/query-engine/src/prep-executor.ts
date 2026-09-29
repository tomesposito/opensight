import type { DuckDBConnection } from '@duckdb/node-api';
import { Client } from 'pg';
import { PrepError, prepFail, type PrepColumn } from '@opensight/bundle-parser/prep';
import { compilePrep, type PrepSource, type PrepCompileOptions, type PrepPlan } from './prep.js';
import { validateConnectorConfig } from './connectors.js';
export interface PrepPreview {
  columns: PrepColumn[]; rows: Record<string, string | number | boolean | null>[];
  through: string | null; limit: number; returnedRows: number; truncated: boolean;
  /** Exact only if the bounded query exhausted the output; otherwise unknown. */
  totalRows: number | null; rowCountLowerBound: number; dialect: PrepPlan['dialect'];
}
export type PrepPreviewOptions = Omit<PrepCompileOptions, 'dialect'>;
function normalize(value: unknown, column: PrepColumn): string | number | boolean | null {
  if (value === null) return null;
  if (column.type === 'BOOLEAN') { if (typeof value === 'boolean') return value; if (value === 't' || value === 'f') return value === 't'; }
  if (column.type === 'STRING' || column.type === 'DATETIME') { if (typeof value === 'string') return value; }
  if (column.type === 'INTEGER' || column.type === 'DECIMAL') {
    if (typeof value === 'bigint' || typeof value === 'string' && /^[+-]?\d+$/.test(value)) {
      const n = BigInt(value); if (n > BigInt(Number.MAX_SAFE_INTEGER) || n < BigInt(Number.MIN_SAFE_INTEGER)) return n.toString();
      return Number(n);
    }
    if ((typeof value === 'number' || typeof value === 'string' && value.trim()) && Number.isFinite(Number(value))) return Number(value);
  }
  return prepFail('PREP_EXECUTION_FAILED', '$.result', 'Unexpected or nonfinite result scalar');
}
export function prepPreviewResult(plan: PrepPlan, rows: readonly Record<string, unknown>[]): PrepPreview {
  const truncated = rows.length > plan.limit;
  const sample = rows.slice(0, plan.limit).map(row => Object.fromEntries(plan.columns.map(c => [c.name, normalize(row[c.name], c)])));
  return { columns: plan.columns, rows: sample, through: plan.through, limit: plan.limit, returnedRows: sample.length, truncated, totalRows: truncated ? null : sample.length, rowCountLowerBound: rows.length, dialect: plan.dialect };
}
/** Caller owns the private connection; requests provide metadata only, never SQL. */
export async function previewPrepDuckDb(connection: DuckDBConnection, raw: unknown, sources: readonly PrepSource[], options: PrepPreviewOptions = {}): Promise<PrepPreview> {
  const plan = compilePrep(raw, sources, { ...options, dialect: 'duckdb' });
  const timeout = setTimeout(() => connection.interrupt(), 10_000);
  try {
    await connection.run("SET TimeZone = 'UTC'");
    return prepPreviewResult(plan, (await connection.runAndReadAll(plan.sql, plan.parameters)).getRowObjects());
  } catch (e) {
    if (e instanceof PrepError) throw e;
    return prepFail('PREP_EXECUTION_FAILED', '$.preview', 'DuckDB preparation failed or exceeded the 10-second execution limit');
  } finally { clearTimeout(timeout); }
}
/** All source bindings must belong to this one caller-configured connection. */
export async function previewPrepPostgres(raw: unknown, sources: readonly PrepSource[], config: unknown, options: PrepPreviewOptions = {}): Promise<PrepPreview> {
  const plan = compilePrep(raw, sources, { ...options, dialect: 'postgres' });
  const validated = validateConnectorConfig('postgresql', config), connectionString = process.env[validated.connectionEnv!];
  if (!connectionString) prepFail('PREP_SOURCE_NOT_FOUND', '$.source', 'Postgres connection environment variable is not configured');
  try {
    const client = new Client({ connectionString, connectionTimeoutMillis: 5000 });
    try {
    await client.connect();
    await client.query('BEGIN READ ONLY');
    await client.query("SET LOCAL TIME ZONE 'UTC'");
    await client.query("SET LOCAL statement_timeout = '10s'");
    const result = await client.query<Record<string, unknown>>({ text: plan.sql, values: plan.parameters, types: { getTypeParser: () => (v: string) => v } });
    const preview = prepPreviewResult(plan, result.rows);
    await client.query('COMMIT'); return preview;
    } finally { await client.end(); }
  } catch (e) {
    if (e instanceof PrepError) throw e;
    return prepFail('PREP_EXECUTION_FAILED', '$.preview', 'Postgres preparation failed or exceeded the 10-second execution limit');
  }
}
