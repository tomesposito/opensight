import type { DuckDBConnection } from '@duckdb/node-api';
import { withPrepMemory, type PrepMemoryTable, type PrepScalar } from './prep-stream.js';
import type { PrepColumn } from '@opensight/bundle-parser/prep';
import { quoteLiteral } from './validation.js';

/** Same execution deadline as prep and the MySQL live query executor. */
export const NOTEBOOK_EXECUTION_MS = 10_000;
/** Existing #159 cache-entry budget; notebook results cannot exceed it. */
export const NOTEBOOK_RESULT_BYTES = 8 * 1024 * 1024;
export class NotebookSqlError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'NotebookSqlError'; }
}
function fail(code: string, message: string): never { throw new NotebookSqlError(code, message); }
type JsonObject = Record<string, unknown>;
const object = (v: unknown): v is JsonObject => !!v && typeof v === 'object' && !Array.isArray(v);
// An allowlist prevents side-effecting, introspection, extension and dynamic-SQL functions.
const functions = new Set(['sum', 'avg', 'count', 'count_star', 'min', 'max', 'abs', 'round', 'floor', 'ceil', 'ceiling', 'lower', 'upper', 'length', 'char_length', 'trim', 'ltrim', 'rtrim', 'substring', 'substr', 'concat', 'concat_ws', 'replace', 'starts_with', 'ends_with', 'contains', 'date_part', 'date_trunc', 'date_diff', 'strftime', 'strptime', 'try_strptime', 'year', 'month', 'day', 'coalesce', 'nullif', '+', '-', '*', '/', '//', '%', '||', '~~', '!~~', '~~*', '!~~*']);
const expressionClasses = new Set(['COLUMN_REF', 'CONSTANT', 'PARAMETER', 'FUNCTION', 'STAR', 'COMPARISON', 'CONJUNCTION', 'OPERATOR', 'CAST', 'CASE', 'BETWEEN', 'SUBQUERY', 'WINDOW']);
const tableTypes = new Set(['BASE_TABLE', 'JOIN', 'SUBQUERY', 'EMPTY']);

/** Parse without preparing/binding user SQL: preparation can itself evaluate table functions. */
async function validateSql(connection: DuckDBConnection, sql: string, refs: readonly string[], bindings: Readonly<Record<string, string | number>>) {
  if (!sql.trim() || sql.length > 10_000 || sql.includes('\0')) fail('NOTEBOOK_SQL_INVALID', 'SQL must be 1–10000 characters without NUL.');
  let ast: unknown; let serialized = ''; 
  try {
    // DuckDB's serializer requires a constant VARCHAR. quoteLiteral is the existing
    // engine literal encoder; user bindings are separately passed to the driver.
    serialized = String((await connection.runAndReadAll(`SELECT json_serialize_sql(${quoteLiteral(sql)})`)).getRows()[0]?.[0]);
    ast = JSON.parse(serialized);
  } catch { fail('NOTEBOOK_SQL_INVALID', 'Unable to parse SQL.'); }
  if (!object(ast) || ast.error !== false || !Array.isArray(ast.statements)) fail('NOTEBOOK_SQL_READ_ONLY_REQUIRED', 'Only a SELECT or WITH … SELECT statement is supported.');
  if (ast.statements.length !== 1) fail('NOTEBOOK_SQL_SINGLE_STATEMENT_REQUIRED', 'Exactly one statement is required.');
  const declared = new Set(refs.map(r => r.toLowerCase()));
  const used = new Set<string>();
  let nodes = 0;
  const walk = (value: unknown, scope: ReadonlySet<string>, key = '', depth = 0): void => {
    if (++nodes > 20_000 || depth > 100) fail('NOTEBOOK_SQL_COMPLEXITY_LIMIT', 'SQL exceeds the parser complexity limit.');
    if (Array.isArray(value)) { for (const v of value) walk(v, scope, key, depth + 1); return; }
    if (!object(value)) return;
    let local = scope;
    if (key === 'node' || key === 'left' && String(value.type).endsWith('_NODE') || key === 'right' && String(value.type).endsWith('_NODE')) {
      if (!['SELECT_NODE', 'SET_OPERATION_NODE'].includes(String(value.type))) fail('NOTEBOOK_SQL_UNSUPPORTED', 'Only nonrecursive SELECT queries are supported.');
      const ctes = object(value.cte_map) && Array.isArray(value.cte_map.map) ? value.cte_map.map : [];
      local = new Set(scope);
      for (const entry of ctes) {
        if (!object(entry) || typeof entry.key !== 'string') fail('NOTEBOOK_SQL_UNSUPPORTED', 'Invalid CTE.');
        (local as Set<string>).add(entry.key.toLowerCase());
      }
    }
    if (value.class !== undefined && !expressionClasses.has(String(value.class))) fail('NOTEBOOK_SQL_UNSUPPORTED', 'Unsupported SQL expression.');
    if (value.class === 'FUNCTION' || value.class === 'WINDOW') {
      if (value.schema || value.catalog || !functions.has(String(value.function_name).toLowerCase())) fail('NOTEBOOK_SQL_FUNCTION_DENIED', 'This SQL function is not allowed in notebooks.');
    }
    if (value.class === 'PARAMETER') {
      const name = String(value.identifier);
      if (!/^[A-Za-z][A-Za-z0-9_]{0,127}$/.test(name) || !Object.hasOwn(bindings, name)) fail('NOTEBOOK_SQL_PARAMETER_UNDECLARED', 'SQL parameters must use declared $name bindings.');
      used.add(name);
    }
    // Every table-reference node has column_name_alias or sample, including
    // nested JOIN/SUBQUERY nodes. Unknown relation kinds are refused before bind.
    if (value.class === undefined && (Object.hasOwn(value, 'column_name_alias') || Object.hasOwn(value, 'sample') && value.type !== 'SELECT_NODE')) {
      if (!tableTypes.has(String(value.type))) fail('NOTEBOOK_SQL_TABLE_DENIED', 'Table functions and unsupported table references are forbidden.');
    }
    if (value.type === 'BASE_TABLE') {
      if (value.schema_name || value.catalog_name || value.at_clause || typeof value.table_name !== 'string' || !declared.has(value.table_name.toLowerCase()) && !local.has(value.table_name.toLowerCase())) fail('NOTEBOOK_SQL_UNDECLARED_TABLE', 'SQL may reference only declared datasetRefs or local CTEs.');
    }
    // CONSTANT/type metadata cannot contain executable AST nodes.
    if (value.class === 'CONSTANT') return;
    for (const [k, v] of Object.entries(value)) walk(v, local, k, depth + 1);
  };
  walk(ast.statements[0], new Set());
  const normalized = String((await connection.runAndReadAll(`SELECT json_deserialize_sql(${quoteLiteral(serialized)})`)).getRows()[0]?.[0]);
  return { sql: normalized.replace(/;\s*$/, ''), bindings: Object.fromEntries([...used].map(name => [name, bindings[name]!])) };
}
function columnType(type: string): PrepColumn['type'] {
  if (/^(U?BIGINT|U?INTEGER|U?SMALLINT|U?TINYINT|HUGEINT|UHUGEINT)$/.test(type)) return 'INTEGER';
  if (/^(DOUBLE|FLOAT|DECIMAL)/.test(type)) return 'DECIMAL';
  if (/^(DATE|TIMESTAMP)/.test(type)) return 'DATETIME';
  if (type === 'BOOLEAN') return 'BOOLEAN';
  if (type === 'VARCHAR') return 'STRING';
  return fail('NOTEBOOK_SQL_RESULT_TYPE_UNSUPPORTED', 'SQL results must contain scalar text, number, date or boolean columns.');
}
function scalar(raw: unknown, type: PrepColumn['type']): PrepScalar {
  if (raw === null || typeof raw === 'string' || typeof raw === 'boolean') return raw;
  if (typeof raw === 'bigint') return raw > BigInt(Number.MAX_SAFE_INTEGER) || raw < BigInt(Number.MIN_SAFE_INTEGER) ? raw.toString() : Number(raw);
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (object(raw) && type === 'DECIMAL' && 'toDouble' in raw && typeof raw.toDouble === 'function') { const n: unknown = raw.toDouble(); if (typeof n === 'number' && Number.isFinite(n)) return n; }
  if (object(raw) && type === 'DATETIME') return String(raw);
  return fail('NOTEBOOK_SQL_RESULT_TYPE_UNSUPPORTED', 'Unsupported or nonfinite result value.');
}
export async function executeNotebookSql(sql: string, refs: readonly string[], bindings: Readonly<Record<string, string | number>>, tables: readonly PrepMemoryTable[], maxRows: number) {
  if (!Number.isSafeInteger(maxRows) || maxRows < 1 || maxRows >= 100_001) fail('NOTEBOOK_SQL_LIMIT_INVALID', 'Invalid row bound.');
  return withPrepMemory(tables, async connection => {
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; connection.interrupt(); }, NOTEBOOK_EXECUTION_MS);
    try {
      await connection.run("SET TimeZone = 'UTC'");
      const validated = await validateSql(connection, sql, refs, bindings);
      await connection.run('BEGIN TRANSACTION READ ONLY');
      try {
        const result = await connection.stream(`SELECT * FROM (${validated.sql}) AS notebook_result LIMIT ${maxRows + 1}`, validated.bindings);
        const names = result.columnNames(), types = result.columnTypes().map(t => columnType(String(t)));
        if (!names.length || names.length > 256 || new Set(names).size !== names.length || names.some(n => !n.trim() || n.length > 128 || n.includes('\0'))) fail('NOTEBOOK_SQL_RESULT_COLUMNS_INVALID', 'Expected 1–256 unique named columns (max 128 characters).');
        const columns = names.map((name, i) => ({ name, type: types[i]! }));
        const rows: Record<string, PrepScalar>[] = []; let truncated = false, bytes = 0;
        for (;;) {
          const chunk = await result.fetchChunk(); if (!chunk || !chunk.rowCount) break;
          for (let r = 0; r < chunk.rowCount; r++) {
            if (rows.length === maxRows) { truncated = true; break; }
            const row = Object.fromEntries(chunk.getRowValues(r).map((v, i) => [names[i]!, scalar(v, types[i]!)]));
            if (Object.values(row).some(v => typeof v === 'string' && (v.length > 16384 || v.includes('\0')))) fail('NOTEBOOK_SQL_RESULT_TOO_LARGE', 'A result cell exceeds the prep text bound.');
            bytes += Buffer.byteLength(JSON.stringify(row));
            if (bytes > NOTEBOOK_RESULT_BYTES) fail('NOTEBOOK_SQL_RESULT_TOO_LARGE', 'Result exceeds the 8 MiB live-cache entry bound.');
            rows.push(row);
          }
          if (truncated) break;
        }
        return { columns, rows, rowCount: rows.length, truncated };
      } finally { await connection.run('ROLLBACK'); }
    } catch (e) {
      if (e instanceof NotebookSqlError) throw e;
      return fail(timedOut ? 'NOTEBOOK_SQL_TIMEOUT' : 'NOTEBOOK_SQL_EXECUTION_FAILED', timedOut ? 'SQL exceeded the 10-second execution limit.' : 'SQL could not execute within the allowed schema, types and memory bound.');
    } finally { clearTimeout(timer); }
  });
}
