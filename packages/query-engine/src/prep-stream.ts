import { DuckDBInstance, type DuckDBConnection } from '@duckdb/node-api';
import { Client, type ClientConfig } from 'pg';
import { PrepError, prepFail, type PrepColumn, type PrepType } from '@opensight/bundle-parser/prep';
import { compilePrep, type PrepSource, type PrepPlan } from './prep.js';
import { normalizePrepScalar, type PrepPreviewOptions } from './prep-executor.js';
import { validateConnectorConfig } from './connectors.js';
import { quoteIdentifier as q } from './validation.js';

export type PrepScalar = string | number | boolean | null;
export interface PrepSink {
  start(columns: PrepColumn[]): void;
  row(values: PrepScalar[]): void;
  oversized(): never;
}
export interface ExecutionControl { signal?: AbortSignal; memoryMb?: number; executionMs?: number }
export class ExecutionCancelledError extends Error { readonly code = 'EXECUTION_CANCELLED'; constructor() { super('EXECUTION_CANCELLED'); } }
function check(control?: ExecutionControl): void { if (control?.signal?.aborted) throw new ExecutionCancelledError(); }
export interface PrepReadLimits { maxRows: number; cellChars: number }
export interface PrepMemoryTable { source: PrepSource; rowCount: number; value(row: number, column: number): PrepScalar }
const types: Record<PrepType, string> = { INTEGER: 'BIGINT', DECIMAL: 'DOUBLE', STRING: 'VARCHAR', DATETIME: 'TIMESTAMP', BOOLEAN: 'BOOLEAN' };

/** Cache relations are host-owned and scoped to one serialized operation. */
export async function withPrepTables<T>(connection: DuckDBConnection, tables: readonly PrepMemoryTable[], run: () => Promise<T>): Promise<T> {
  const created: string[] = [];
  try {
    for (const table of tables) {
      const name = q(table.source.table);
      await connection.run(`CREATE TEMP TABLE ${name} (${table.source.columns.map(c => `${q(c.name)} ${types[c.type]}`).join(', ')})`);
      created.push(name);
      for (let offset = 0; offset < table.rowCount; offset += 32) {
        const count = Math.min(32, table.rowCount - offset), values: PrepScalar[] = [];
        const rows = Array.from({ length: count }, (_, r) => `(${table.source.columns.map((_, c) => { values.push(table.value(offset + r, c)); return '?'; }).join(',')})`);
        await connection.run(`INSERT INTO ${name} VALUES ${rows.join(',')}`, values);
      }
    }
    return await run();
  } finally { for (const name of created.reverse()) await connection.run(`DROP TABLE IF EXISTS ${name}`); }
}
export async function withPrepMemory<T>(tables: readonly PrepMemoryTable[], run: (connection: DuckDBConnection) => Promise<T>, control?: ExecutionControl): Promise<T> {
  check(control);
  const instance = await DuckDBInstance.create(':memory:', { enable_external_access: 'false', autoinstall_known_extensions: 'false', autoload_known_extensions: 'false', threads: '1', memory_limit: `${control?.memoryMb ?? 256}MB`, max_temp_directory_size: '0B' });
  try { const connection = await instance.connect(); try { return await withPrepTables(connection, tables, () => run(connection)); } finally { connection.closeSync(); } } finally { instance.closeSync(); }
}
/** A per-row guard bounds driver allocation even for unexpectedly large source text. */
export function boundedPrepSql(plan: Pick<PrepPlan, 'columns' | 'sql' | 'parameters'>, limits: PrepReadLimits): string {
  const checks = plan.columns.map(c => `COALESCE(LENGTH(CAST(${q(c.name)} AS VARCHAR)), 0)`);
  const oversized = `(${checks.join(' + ')}) > ${limits.cellChars}`;
  return `SELECT ${plan.columns.map((c, i) => `CASE WHEN ${oversized} THEN NULL ELSE ${q(c.name)} END AS ${q(`v${i}`)}`).join(', ')}, ${oversized} AS "oversized" FROM (${plan.sql}) AS "bounded_prep"`;
}
function intake(plan: Pick<PrepPlan, 'columns'>, raw: readonly unknown[], sink: PrepSink): void {
  if (raw[plan.columns.length] === true || raw[plan.columns.length] === 't') sink.oversized();
  sink.row(plan.columns.map((c, i) => normalizePrepScalar(raw[i], c)));
}
export async function streamPrepDuckDb(connection: DuckDBConnection, raw: unknown, sources: readonly PrepSource[], options: PrepPreviewOptions, limits: PrepReadLimits, sink: PrepSink): Promise<void> {
  const plan = compilePrep(raw, sources, { ...options, dialect: 'duckdb', executionLimit: limits.maxRows + 1 });
  return streamDuckDbPlan(connection, plan, limits, sink);
}
export async function streamDuckDbPlan(connection: DuckDBConnection, plan: Pick<PrepPlan, 'columns' | 'sql' | 'parameters'>, limits: PrepReadLimits, sink: PrepSink): Promise<void> {
  sink.start(plan.columns);
  let consumerError: unknown;
  const timer = setTimeout(() => connection.interrupt(), 10_000);
  try {
    await connection.run("SET TimeZone = 'UTC'");
    const result = await connection.stream(boundedPrepSql(plan, limits), plan.parameters);
    for (;;) {
      const chunk = await result.fetchChunk(); if (!chunk || !chunk.rowCount) break;
      for (let r = 0; r < chunk.rowCount; r++) {
        try { intake(plan, chunk.getRowValues(r), sink); } catch (e) { consumerError = e; connection.interrupt(); throw e; }
      }
    }
  } catch (e) {
    if (e === consumerError || e instanceof PrepError) throw e;
    prepFail('PREP_EXECUTION_FAILED', '$.materialize', 'DuckDB preparation failed or exceeded its memory/time limit');
  } finally { clearTimeout(timer); }
}
export async function streamPrepPostgres(raw: unknown, sources: readonly PrepSource[], config: unknown, options: PrepPreviewOptions, limits: PrepReadLimits, sink: PrepSink): Promise<void> {
  const plan = compilePrep(raw, sources, { ...options, dialect: 'postgres', executionLimit: limits.maxRows + 1 });
  const validated = validateConnectorConfig('postgresql', config), connectionString = process.env[validated.connectionEnv!];
  if (!connectionString) prepFail('PREP_SOURCE_NOT_FOUND', '$.source', 'Postgres connection environment variable is not configured');
  return streamPostgresPlan(plan, { connectionString }, limits, sink);
}
export async function streamPostgresPlan(plan: Pick<PrepPlan, 'columns' | 'sql' | 'parameters'>, config: ClientConfig, limits: PrepReadLimits, sink: PrepSink, control?: ExecutionControl): Promise<void> {
  check(control);
  sink.start(plan.columns);
  let consumerError: unknown;
  const duration = Math.min(control?.executionMs ?? 10_000, 10_000);
  const client = new Client({ ...config, connectionTimeoutMillis: Math.min(duration, 5000), query_timeout: duration });
  let pid: number | undefined, cancelling: Promise<void> | undefined;
  const cancel = () => {
    cancelling ??= (async () => {
      // Hold the original connection until cancellation finishes: its backend PID cannot be reused.
      if (pid !== undefined) {
        const canceller = new Client({ ...config, connectionTimeoutMillis: 500, query_timeout: 500 });
        canceller.on('error', () => {});
        try { await canceller.connect(); await canceller.query('SELECT pg_cancel_backend($1)', [pid]); }
        catch { /* Closing the dedicated socket and server statement_timeout remain the fallback. */ }
        finally { await canceller.end(); }
      }
      await client.end();
    })().catch(() => {});
  };
  client.on('error', () => {});
  control?.signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(cancel, duration);
  try {
    try {
      await client.connect(); check(control);
      pid = Number((await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid); check(control);
      await client.query('BEGIN READ ONLY');
      await client.query("SET LOCAL TIME ZONE 'UTC'"); await client.query(`SET LOCAL statement_timeout = '${duration}ms'`);
      await client.query({ text: `DECLARE blaze_cursor NO SCROLL CURSOR FOR ${boundedPrepSql(plan, limits)}`, values: plan.parameters });
      const deadline = Date.now() + duration;
      for (;;) {
        check(control); if (cancelling || Date.now() > deadline) throw new ExecutionCancelledError();
        const batch = await client.query({ text: 'FETCH FORWARD 32 FROM blaze_cursor', rowMode: 'array', types: { getTypeParser: () => (v: string) => v } });
        for (const row of batch.rows as unknown[][]) { try { check(control); intake(plan, row, sink); } catch (e) { consumerError = e; throw e; } }
        if (batch.rows.length < 32) break;
      }
      check(control); await client.query('COMMIT');
    } finally { await cancelling; await client.end(); }
  } catch (e) {
    if (control?.signal?.aborted || cancelling || e instanceof ExecutionCancelledError) throw new ExecutionCancelledError();
    if (e === consumerError || e instanceof PrepError) throw e;
    prepFail('PREP_EXECUTION_FAILED', '$.materialize', 'Postgres preparation failed or exceeded its memory/time limit');
  } finally { clearTimeout(timer); control?.signal?.removeEventListener('abort', cancel); await cancelling; }
}
